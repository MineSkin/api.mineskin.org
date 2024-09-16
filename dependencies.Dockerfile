FROM node:18.20.3-alpine3.19 AS DEPS_IMAGE
RUN apk add --no-cache bash git openssh-client

RUN mkdir -p /opt/app
WORKDIR /opt/app

RUN mkdir -p -m 0600 ~/.ssh && ssh-keyscan github.com >> ~/.ssh/known_hosts

# install
COPY package.json yarn.lock .yarnrc.yml tsconfig.json .
RUN --mount=type=secret,id=npmrc,target=/opt/app/.npmrc --mount=type=ssh,id=gh-mineskin yarn install
RUN --mount=type=secret,id=npmrc,target=/opt/app/.npmrc --mount=type=ssh,id=gh-mineskin yarn add @mineskin/hash-rust-linux-x64-musl