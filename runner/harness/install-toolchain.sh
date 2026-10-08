#!/bin/bash
# Installs the pinned Java toolchain and trusted harness into /opt/codequest.
#
# Runs as root in a TRUSTED preparation stage only (the Vercel snapshot preparation or the local
# Docker image build) — never in a learner execution. Artifacts are downloaded and verified on
# the host by runner/fetch-toolchain.ts, uploaded, and verified again here, so this stage needs
# no network access at all.
#
#   install-toolchain.sh <jdk_tarball> <jdk_sha256> <junit_jar> <junit_sha256> <harness_run_sh>
set -euo pipefail

if [[ $# -ne 5 ]]; then
  echo "usage: install-toolchain.sh <jdk_tarball> <jdk_sha256> <junit_jar> <junit_sha256> <harness_run_sh>" >&2
  exit 64
fi
jdk_tarball="$1"
jdk_sha256="$2"
junit_jar="$3"
junit_sha256="$4"
harness_src="$5"

echo "$jdk_sha256  $jdk_tarball" | sha256sum -c -
echo "$junit_sha256  $junit_jar" | sha256sum -c -

install -d -o root -g root -m 0755 /opt/codequest /opt/codequest/jdk /opt/codequest/lib
tar -xzf "$jdk_tarball" -C /opt/codequest/jdk --strip-components=1 --no-same-owner
chown -R root:root /opt/codequest/jdk
chmod -R go-w /opt/codequest/jdk
install -o root -g root -m 0644 "$junit_jar" /opt/codequest/lib/junit-platform-console-standalone.jar
install -o root -g root -m 0755 "$harness_src" /opt/codequest/run.sh

/opt/codequest/jdk/bin/java -version
