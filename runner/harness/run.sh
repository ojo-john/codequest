#!/bin/bash
# CodeQuest trusted execution harness.
#
# Installed root-owned (0755) at /opt/codequest/run.sh inside the execution snapshot and invoked
# by the server as the unprivileged `learner` user with positional arguments only — it is never
# passed through a shell string, and learner-controlled text never reaches this script's argv.
#
#   run.sh compile  <workdir> <wall_seconds> <output_bytes> <heap_mb>
#   run.sh test     <workdir> <wall_seconds> <output_bytes> <heap_mb>   # JUnit tests in the sources
#   run.sh contract <workdir> <wall_seconds> <output_bytes> <heap_mb>   # contract.json -> results.jsonl
#   run.sh overlays <workdir> <wall_seconds> <output_bytes> <heap_mb>   # test-quality variants (after compile)
#
# Privilege: the Vercel Sandbox exec agent starts commands as uid `learner` but with a FULL
# capability set (including ambient caps, which survive execve) — effectively root. Before any
# learner code runs, the compiler/JVM are therefore started through `setpriv` with no
# capabilities and no_new_privs, and the drop is verified; if it cannot be verified the harness
# refuses to run (fail closed, exit 65). Measured 2026-10-03, see docs/SECURITY.md.
#
# The server also enforces an outer SIGKILL deadline per command and a whole-sandbox lifetime;
# the inner `timeout` here is a second layer so the JVM dies even if the outer signal is late.
# Exit status is the JVM's, or 137 when killed by the deadline. Combined stdout/stderr is
# truncated to <output_bytes>.
set -u

readonly JAVA_HOME=/opt/codequest/jdk
readonly JUNIT_JAR=/opt/codequest/lib/junit-platform-console-standalone.jar
readonly CONTRACT_RUNNER_JAR=/opt/codequest/lib/contract-runner.jar
export JAVA_HOME
export PATH="$JAVA_HOME/bin:/usr/bin:/bin"

readonly EXIT_USAGE=64
readonly EXIT_PRIVILEGE_DROP_FAILED=65
readonly EXIT_KILLED=137
# `timeout` reports an expired deadline as 124 (both GNU coreutils and the uutils coreutils in
# Ubuntu 26.04, even with --signal=KILL); normalise so the server sees one deadline code.
readonly EXIT_TIMEOUT_EXPIRED=124

readonly EXIT_LEARNER_RESERVED_COLLISION=1

# Maps the compiler/JVM status to the harness's status. Codes reserved for harness failures are
# remapped so learner code (e.g. System.exit(64)) can never pass itself off as an infra error.
exit_with_status() {
  case "$1" in
    "$EXIT_TIMEOUT_EXPIRED") exit "$EXIT_KILLED" ;;
    "$EXIT_USAGE" | "$EXIT_PRIVILEGE_DROP_FAILED") exit "$EXIT_LEARNER_RESERVED_COLLISION" ;;
    *) exit "$1" ;;
  esac
}

if [[ $# -ne 5 ]]; then
  echo "usage: run.sh <compile|test|contract|overlays> <workdir> <wall_seconds> <output_bytes> <heap_mb>" >&2
  exit "$EXIT_USAGE"
fi

mode="$1"
workdir="$2"
wall_seconds="$3"
output_bytes="$4"
heap_mb="$5"

for value in "$wall_seconds" "$output_bytes" "$heap_mb"; do
  if [[ ! "$value" =~ ^[1-9][0-9]{0,8}$ ]]; then
    echo "run.sh: numeric argument expected, got '$value'" >&2
    exit "$EXIT_USAGE"
  fi
done
if [[ "$workdir" != /home/learner/* ]]; then
  echo "run.sh: workdir must be under /home/learner" >&2
  exit "$EXIT_USAGE"
fi

cd "$workdir" || exit "$EXIT_USAGE"

# Clear inheritable + ambient caps (so execve yields an empty permitted set for this non-root
# uid) and set no_new_privs (so setuid/file-capability binaries can't regain any). Clearing the
# bounding set needs CAP_SETPCAP, which only exists where caps were granted in the first place
# (Vercel); under Docker --cap-drop ALL the bounding set is already empty.
unprivileged=(setpriv --no-new-privs --inh-caps=-all --ambient-caps=-all)
if ! grep -qE '^CapBnd:[[:space:]]*0+$' /proc/self/status; then
  unprivileged+=(--bounding-set=-all)
fi
unprivileged+=(--)

effective_caps="$("${unprivileged[@]}" grep -E '^CapEff:' /proc/self/status | tr -d '[:space:]')"
bounding_caps="$("${unprivileged[@]}" grep -E '^CapBnd:' /proc/self/status | tr -d '[:space:]')"
if [[ ! "$effective_caps" =~ ^CapEff:0+$ || ! "$bounding_caps" =~ ^CapBnd:0+$ ]]; then
  echo "run.sh: could not drop capabilities ($effective_caps $bounding_caps); refusing to run" >&2
  exit "$EXIT_PRIVILEGE_DROP_FAILED"
fi

# Per-user process/thread cap (JVM threads count toward this), 50 MB max file size, no core dumps.
ulimit -u 256
ulimit -f 51200
ulimit -c 0

case "$mode" in
  compile)
    rm -rf classes
    mkdir -p classes
    # Paths were validated server-side to [A-Za-z0-9_/.-] before upload, so the argfile is safe.
    find src -type f -name '*.java' -print > sources.txt
    "${unprivileged[@]}" timeout --signal=KILL "${wall_seconds}s" \
      javac "-J-Xmx${heap_mb}m" -encoding UTF-8 -proc:none -d classes -cp "$JUNIT_JAR" @sources.txt \
      2>&1 | head -c "$output_bytes"
    exit_with_status "${PIPESTATUS[0]}"
    ;;
  test)
    rm -rf reports
    mkdir -p reports
    "${unprivileged[@]}" timeout --signal=KILL "${wall_seconds}s" \
      java "-Xmx${heap_mb}m" -Xss4m -XX:+UseSerialGC -XX:TieredStopAtLevel=1 \
        -XX:+ExitOnOutOfMemoryError \
        -jar "$JUNIT_JAR" execute \
        --class-path classes --scan-class-path --fail-if-no-tests \
        --disable-banner --details=tree --reports-dir reports \
      2>&1 | head -c "$output_bytes"
    exit_with_status "${PIPESTATUS[0]}"
    ;;
  contract)
    rm -f results.jsonl
    # The trusted runner jar comes first on the class path so learner classes can't shadow it.
    "${unprivileged[@]}" timeout --signal=KILL "${wall_seconds}s" \
      java "-Xmx${heap_mb}m" -Xss4m -XX:+UseSerialGC -XX:TieredStopAtLevel=1 \
        -XX:+ExitOnOutOfMemoryError \
        -cp "$CONTRACT_RUNNER_JAR:classes" codequest.contract.ContractRunner contract.json results.jsonl \
      2>&1 | head -c "$output_bytes"
    exit_with_status "${PIPESTATUS[0]}"
    ;;
  overlays)
    # Test-quality grading (spec §19). The project is already compiled into classes/ (learner
    # code + learner tests). Each overlays/o<N>/src holds ONE replacement source file (o0 = the
    # reference, o1.. = mutants); it is compiled against classes/ and the learner's tests then run
    # with the overlay first on the class path, so it shadows the learner's version.
    # One line per overlay in overlays/results.txt: "<N> <compile_status> <test_status|->".
    # Variant output is discarded (never shown to the learner). The server bounds the whole loop.
    results=overlays/results.txt
    : > "$results"
    for dir in overlays/o?; do
      [[ -d "$dir" ]] || continue
      name="${dir#overlays/o}"
      rm -rf "$dir/classes" "$dir/reports"
      mkdir -p "$dir/classes"
      find "$dir/src" -type f -name '*.java' -print > "$dir/sources.txt"
      "${unprivileged[@]}" timeout --signal=KILL "${wall_seconds}s" \
        javac "-J-Xmx${heap_mb}m" -encoding UTF-8 -proc:none -d "$dir/classes" -cp "classes:$JUNIT_JAR" "@$dir/sources.txt" \
        > /dev/null 2>&1
      compile_status=$?
      if [[ $compile_status -ne 0 ]]; then
        echo "$name $compile_status -" >> "$results"
        continue
      fi
      "${unprivileged[@]}" timeout --signal=KILL "${wall_seconds}s" \
        java "-Xmx${heap_mb}m" -Xss4m -XX:+UseSerialGC -XX:TieredStopAtLevel=1 \
          -XX:+ExitOnOutOfMemoryError \
          -jar "$JUNIT_JAR" execute \
          --class-path "$dir/classes:classes" --scan-class-path=classes --fail-if-no-tests \
          --disable-banner --details=none --reports-dir "$dir/reports" \
        > /dev/null 2>&1
      test_status=$?
      echo "$name $compile_status $test_status" >> "$results"
      # Tests that fail on the reference make every mutant verdict meaningless: stop early.
      if [[ "$name" == "0" && $test_status -ne 0 ]]; then
        break
      fi
    done
    exit 0
    ;;
  *)
    echo "run.sh: unknown mode '$mode'" >&2
    exit "$EXIT_USAGE"
    ;;
esac
