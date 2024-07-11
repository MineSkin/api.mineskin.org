FROM node:18.20.3-alpine3.19 AS DEPS_IMAGE
RUN apk add --no-cache bash git

RUN mkdir -p /opt/app
WORKDIR /opt/app

# install
COPY package.json package-lock.json tsconfig.json .
RUN npm ci