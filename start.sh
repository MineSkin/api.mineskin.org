#!/bin/bash

echo "[INFO] Starting app..."
yarn start &
pid=$!

# Forward signals
trap "echo '[SIGNAL] Caught SIGHUP'; kill -HUP $pid" HUP
trap "echo '[SIGNAL] Caught SIGTERM'; kill -TERM $pid" TERM
trap "echo '[SIGNAL] Caught SIGINT'; kill -INT $pid" INT

# Wait for the process and grab its exit code
wait $pid
exit_code=$?

echo "[INFO] Node exited with code $exit_code"
exit $exit_code