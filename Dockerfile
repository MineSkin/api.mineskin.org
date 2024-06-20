FROM node:18.20.3-alpine3.19
RUN apk add --no-cache bash git

ARG SOURCE_COMMIT=0
ENV SOURCE_COMMIT=$SOURCE_COMMIT

RUN mkdir -p /opt/app
WORKDIR /opt/app
COPY package.json package-lock.json tsconfig.json .
RUN npm install
COPY src/ .
COPY openapi.yml .env.vault .
RUN npm run build
EXPOSE 3017
CMD [ "npm", "start"]