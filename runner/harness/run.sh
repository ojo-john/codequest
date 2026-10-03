#!/bin/bash
# CodeQuest trusted execution harness.
#
# Installed root-owned (0755) at /opt/codequest/run.sh inside the execution snapshot and invoked
# by the server as the unprivileged `learner` user with positional arguments only — it is never
# passed through a shell string, and learner-controlled text never reaches this script's argv.
#
#   run.sh compile <workdir> <wall_seconds> <output_bytes> <heap_mb>
#   run.sh test    <workdir> <wall_seconds> <output_bytes> <heap_mb>
#
# The server also enforces an outer SIGKILL deadline per command and a whole-sandbox lifetime;
# the inner `timeout` here is a second layer so the JVM dies even if the outer signal is late.
# Exit status is the JVM's, or 137 when killed by the deadline. Combined stdout/stderr is
# truncated to <output_bytes>.
set -u

readonly JAVA_HOME=/opt/codequest/jdk
readonly JUNIT_JAR=/opt/codequest/lib/junit-platform-console-standalone.jar
export JAVA_HOME
export PATH="$JAVA_HOME/bin:/usr/bin:/bin"

readonly EXIT_USAGE=64
readonly EXIT_KILLED=137
# `timeout` reports an expired deadline as 124 (both GNU coreutils and the uutils coreutils in
# Ubuntu 26.04, even with --signal=KILL); normalise so the server sees one deadline code.
readonly EXIT_TIMEOUT_EXPIRED=124

exit_with_status() {
  if [[ "$1" -eq "$EXIT_TIMEOUT_EXPIRED" ]]; then
    exit "$EXIT_KILLED"
  fi
  exit "$1"
}

if [[ $# -ne 5 ]]; then
  echo "usage: run.sh <compile|test> <workdir> <wall_seconds> <output_bytes> <heap_mb>" >&2
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
    timeout --signal=KILL "${wall_seconds}s" \
      javac "-J-Xmx${heap_mb}m" -encoding UTF-8 -proc:none -d classes -cp "$JUNIT_JAR" @sources.txt \
      2>&1 | head -c "$output_bytes"
    exit_with_status "${PIPESTATUS[0]}"
    ;;
  test)
    rm -rf reports
    mkdir -p reports
    timeout --signal=KILL "${wall_seconds}s" \
      java "-Xmx${heap_mb}m" -Xss4m -XX:+UseSerialGC -XX:TieredStopAtLevel=1 \
        -XX:+ExitOnOutOfMemoryError \
        -jar "$JUNIT_JAR" execute \
        --class-path classes --scan-class-path --fail-if-no-tests \
        --disable-banner --details=tree --reports-dir reports \
      2>&1 | head -c "$output_bytes"
    exit_with_status "${PIPESTATUS[0]}"
    ;;
  *)
    echo "run.sh: unknown mode '$mode'" >&2
    exit "$EXIT_USAGE"
    ;;
esac
