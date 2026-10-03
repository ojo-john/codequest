#!/bin/bash
# Installs the pinned Java toolchain and trusted harness into /opt/codequest.
#
# Runs as root in a TRUSTED preparation stage only (the Vercel snapshot preparation or the local
# Docker image build) — never in a learner execution. Values come from runner/toolchain.json.
#
#   install-toolchain.sh <jdk_url> <jdk_sha256> <junit_url> <junit_sha256> <harness_run_sh>
#
# curl is installed only for the download and purged afterwards so it is absent at learner time.
set -euo pipefail

if [[ $# -ne 5 ]]; then
  echo "usage: install-toolchain.sh <jdk_url> <jdk_sha256> <junit_url> <junit_sha256> <harness_run_sh>" >&2
  exit 64
fi
jdk_url="$1"
jdk_sha256="$2"
junit_url="$3"
junit_sha256="$4"
harness_src="$5"

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q --no-install-recommends ca-certificates curl

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl -fsSL --retry 3 --connect-timeout 20 --max-time 600 -o "$work/jdk.tar.gz" "$jdk_url"
echo "$jdk_sha256  $work/jdk.tar.gz" | sha256sum -c -
curl -fsSL --retry 3 --connect-timeout 20 --max-time 120 -o "$work/junit.jar" "$junit_url"
echo "$junit_sha256  $work/junit.jar" | sha256sum -c -

install -d -o root -g root -m 0755 /opt/codequest /opt/codequest/jdk /opt/codequest/lib
tar -xzf "$work/jdk.tar.gz" -C /opt/codequest/jdk --strip-components=1 --no-same-owner
install -o root -g root -m 0644 "$work/junit.jar" /opt/codequest/lib/junit-platform-console-standalone.jar
install -o root -g root -m 0755 "$harness_src" /opt/codequest/run.sh

apt-get purge -y -q curl
apt-get autoremove -y -q
rm -rf /var/lib/apt/lists/*

/opt/codequest/jdk/bin/java -version
