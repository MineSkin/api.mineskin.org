#!/bin/bash

docker build --ssh gh-mineskin="$HOME/.ssh/id_rsa.github.mineskin" -t "ghcr.io/mineskin/mineskin-api:dependencies" -f dependencies.Dockerfile .