#!/bin/bash
# Compiles the trusted contract runner, runs its unit tests, and installs it root-owned at
# /opt/codequest/lib/contract-runner.jar. Runs as root during the image build only; a failing
# test fails the build, so a broken runner can never be published.
#
#   build-contract-runner.sh <contract-runner-source-dir>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: build-contract-runner.sh <contract-runner-source-dir>" >&2
  exit 64
fi
source_dir="$1"
jdk_bin=/opt/codequest/jdk/bin
junit_jar=/opt/codequest/lib/junit-platform-console-standalone.jar

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

mapfile -t main_sources < <(find "$source_dir/src" -name '*.java')
mapfile -t test_sources < <(find "$source_dir/test" -name '*.java')

"$jdk_bin/javac" -Xlint:all -Werror -encoding UTF-8 -d "$work/main" "${main_sources[@]}"
"$jdk_bin/javac" -encoding UTF-8 -d "$work/test" -cp "$work/main:$junit_jar" "${test_sources[@]}"
"$jdk_bin/java" -jar "$junit_jar" execute \
  --class-path "$work/main:$work/test" --scan-class-path --fail-if-no-tests \
  --disable-banner --details=summary --disable-ansi-colors

"$jdk_bin/jar" --create --file "$work/contract-runner.jar" -C "$work/main" .
install -o root -g root -m 0644 "$work/contract-runner.jar" /opt/codequest/lib/contract-runner.jar
