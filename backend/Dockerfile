FROM node:22-slim
WORKDIR /code
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src
COPY scripts ./scripts
ENV IN_DOCKER=1
CMD ["node", "src/server.js"]