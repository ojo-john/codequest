# Local execution image: the spec §65 fallback runner, and a cheap way to exercise the harness
# before spending Vercel Sandbox quota. Mirrors the Vercel snapshot: same Ubuntu base, same
# pinned toolchain (build args come from runner/toolchain.json via runner/docker/build.ts),
# same harness, same unprivileged `learner` user. Built for linux/amd64 to match Vercel.
FROM ubuntu:26.04

ARG JDK_URL
ARG JDK_SHA256
ARG JUNIT_URL
ARG JUNIT_SHA256

COPY harness/install-toolchain.sh harness/run.sh /tmp/codequest/
RUN bash /tmp/codequest/install-toolchain.sh "$JDK_URL" "$JDK_SHA256" "$JUNIT_URL" "$JUNIT_SHA256" /tmp/codequest/run.sh \
  && rm -rf /tmp/codequest \
  && useradd --create-home --shell /bin/bash learner

USER learner
WORKDIR /home/learner
