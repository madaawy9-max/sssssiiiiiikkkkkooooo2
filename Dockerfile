FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends lua5.4 git unzip zip ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

ARG HERCULES_REF=main
RUN git clone --depth 1 --branch "${HERCULES_REF}" \
    https://github.com/zeusssz/hercules-obfuscator.git /app/vendor/hercules

COPY . .

ENV OBFUSCATOR_PROVIDER=hercules \
    LUA_BIN=lua5.4 \
    HERCULES_ROOT=/app/vendor/hercules \
    HERCULES_PRESET=heavy \
    HERCULES_TIMEOUT_MS=600000

EXPOSE 3000
CMD ["npm", "start"]
