#!/bin/sh

set -e

echo "[INFO] Starting"
yarn start
status=$?
echo "[EXIT] Node process exited with status $status"
exit $status