#!/bin/bash

echo "SOURCE_COMMIT: $SOURCE_COMMIT"

if [[ -z "$SOURCE_COMMIT" ]]; then
	export SOURCE_COMMIT="${SOURCE_COMMIT:-$(git rev-parse --short HEAD)}"
	echo "Updating SOURCE_COMMIT from git rev-parse HEAD"
	echo "SOURCE_COMMIT: $SOURCE_COMMIT"
fi

export GIT_BRANCH="${GIT_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
echo "GIT_BRANCH: $GIT_BRANCH"

IMAGE_BASE="ghcr.io/mineskin/mineskin-api"

docker build --build-arg="SOURCE_COMMIT=$SOURCE_COMMIT" --build-arg="GIT_BRANCH=$GIT_BRANCH" -t "$IMAGE_BASE:$GIT_BRANCH" -t "$IMAGE_BASE:latest" -t "$IMAGE_BASE:$SOURCE_COMMIT" .