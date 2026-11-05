#!/bin/sh
# Disposable Docker VM container only. No credentials, host mounts, ports or daemon startup.
set -eu
docker build -f test/linux/Dockerfile -t eumenes-pursuit-verify:local .
# Unmask Docker's proc restrictions so bwrap can create its own PID namespace/proc.
docker run --rm --cap-add SYS_ADMIN --security-opt seccomp=unconfined --security-opt systempaths=unconfined --memory 4g --pids-limit 512 eumenes-pursuit-verify:local
