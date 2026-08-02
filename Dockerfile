FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/meals.db

VOLUME ["/data"]
EXPOSE 3000

CMD ["npm", "start"]
