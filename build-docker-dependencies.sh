#!/bin/bash

docker build --secret id=npmrc,src=./.npmrc --ssh gh-mineskin="$HOME/.ssh/id_rsa.github.mineskin" -t "ghcr.io/mineskin/mineskin-api:dependencies" -f dependencies.Dockerfile .