FROM node:16-alpine

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm ci --only=production

COPY ./dist .
COPY ./res ./res

EXPOSE 5572
CMD [ "node", "server.js" ]