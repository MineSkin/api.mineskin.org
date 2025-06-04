#!/bin/bash

echo "[INFO] Starting app..."
yarn start &
pid=$!


# Forward signals to the child process

hup() {
  echo "[SIGNAL] Caught SIGHUP. Forwarding to child ($pid)..."
  kill -HUP "$pid"
  wait "$pid"
  exit_code=$?
  echo "[INFO] Node exited with code $exit_code"
  exit $exit_code
}

terminate() {
  echo "[SIGNAL] Caught SIGTERM. Forwarding to child ($pid)..."
  kill -TERM "$pid"
  wait "$pid"
  exit_code=$?
  echo "[INFO] Node exited with code $exit_code"
  exit $exit_code
}

interrupt() {
  echo "[SIGNAL] Caught SIGINT. Forwarding to child ($pid)..."
  kill -INT "$pid"
  wait "$pid"
  exit_code=$?
  echo "[INFO] Node exited with code $exit_code"
  exit $exit_code
}

# Trap signals
trap hup HUP
trap terminate TERM
trap interrupt INT

# Wait for the child normally (if no signal is caught)
wait "$pid"
exit_code=$?
echo "[INFO] Node exited with code $exit_code"
exit $exit_code