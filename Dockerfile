ARG GIT_BRANCH="master"
FROM ghcr.io/mineskin/mineskin-api:${GIT_BRANCH}-dependencies AS BUILD_IMAGE
RUN apk add --no-cache bash git

RUN mkdir -p /opt/app
WORKDIR /opt/app

# copy sources
COPY src/ src/
COPY openapi.yml .env.vault .

# build
RUN yarn build

######

FROM ghcr.io/mineskin/mineskin-api:${GIT_BRANCH}-dependencies AS APP_IMAGE

ARG SOURCE_COMMIT=0
ENV SOURCE_COMMIT=$SOURCE_COMMIT

RUN mkdir -p /opt/app
WORKDIR /opt/app

COPY --from=BUILD_IMAGE /opt/app/dist ./dist
#COPY --from=BUILD_IMAGE /opt/app/node_modules ./node_modules
COPY --from=BUILD_IMAGE /opt/app/package.json .
COPY --from=BUILD_IMAGE /opt/app/openapi.yml .
COPY --from=BUILD_IMAGE /opt/app/.env.vault .

EXPOSE 3017
CMD [ "yarn", "start"]





