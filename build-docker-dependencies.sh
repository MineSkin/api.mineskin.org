#!/bin/bash

export GIT_BRANCH="${GIT_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
echo "GIT_BRANCH: $GIT_BRANCH"

docker build --ssh gh-mineskin="$HOME/.ssh/id_rsa.github.mineskin" -t "ghcr.io/mineskin/mineskin-api:$GIT_BRANCH-dependencies" -f dependencies.Dockerfile .