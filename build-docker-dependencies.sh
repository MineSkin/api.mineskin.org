#!/bin/bash

export GIT_BRANCH="${GIT_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
echo "GIT_BRANCH: $GIT_BRANCH"

docker build --secret id=npmrc,src=./.npmrc \
  --secret id=yarnrc,src=./.yarnrc.yml \
  --ssh gh-mineskin="$HOME/.ssh/id_rsa.github.mineskin" \
  -t "ghcr.io/mineskin/mineskin-api:$GIT_BRANCH-dependencies" \
  -f dependencies.Dockerfile .