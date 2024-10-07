FROM node:18.20.3-alpine3.19 AS DEPS_IMAGE
RUN apk update && apk add --no-cache bash git openssh-client && rm -rf /var/cache/apk/*

RUN mkdir -p /opt/app
WORKDIR /opt/app

RUN mkdir -p -m 0600 ~/.ssh && ssh-keyscan github.com >> ~/.ssh/known_hosts

# install
RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml tsconfig.json .
RUN --mount=type=secret,id=npmrc,target=/opt/app/.npmrc --mount=type=secret,id=yarnrc,target=/opt/app/.yarnrc.yml --mount=type=ssh,id=gh-mineskin --mount=type=cache,target=/root/.yarn yarn install
RUN --mount=type=secret,id=npmrc,target=/opt/app/.npmrc --mount=type=secret,id=yarnrc,target=/opt/app/.yarnrc.yml --mount=type=ssh,id=gh-mineskin --mount=type=cache,target=/root/.yarn yarn add @mineskin/hash-rust-linux-x64-musl