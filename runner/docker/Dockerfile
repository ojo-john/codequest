# The CodeQuest runner image — one image for both providers: published to Vercel Container
# Registry for Vercel Sandbox (`npm run runner:publish`) and built locally for the spec §65
# Docker fallback (`npm run runner:docker-build`). Base image digest and toolchain checksums come
# from runner/toolchain.json; artifacts are pre-verified in runner/.cache by
# runner/fetch-toolchain.ts. The default user is the unprivileged `learner` and there is no
# sudo, so nothing executed in the sandbox runs with privilege. linux/amd64 to match Vercel.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}

ARG JDK_SHA256
ARG JUNIT_SHA256

COPY .cache/jdk.tar.gz .cache/junit-platform-console-standalone.jar harness/install-toolchain.sh harness/run.sh harness/build-contract-runner.sh /tmp/codequest/
COPY harness/contract-runner /tmp/codequest/contract-runner
RUN bash /tmp/codequest/install-toolchain.sh \
      /tmp/codequest/jdk.tar.gz "$JDK_SHA256" \
      /tmp/codequest/junit-platform-console-standalone.jar "$JUNIT_SHA256" \
      /tmp/codequest/run.sh \
  && bash /tmp/codequest/build-contract-runner.sh /tmp/codequest/contract-runner \
  && rm -rf /tmp/codequest \
  && useradd --create-home --shell /bin/bash learner

USER learner
WORKDIR /home/learner
