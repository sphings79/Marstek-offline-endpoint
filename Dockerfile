# alpine + nodejs from the distro repos rather than node:*-alpine: the official
# Node images do not publish every architecture this needs -- a Raspberry Pi 3B on
# 32-bit Raspberry Pi OS wants linux/arm/v7, a Pi Zero linux/arm/v6, and an old
# 32-bit laptop linux/386. Alpine packages nodejs for all of them.
FROM alpine:3.20

RUN apk add --no-cache nodejs openssl tzdata

WORKDIR /app
COPY server.cjs /app/server.cjs
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

VOLUME ["/data", "/certs"]
EXPOSE 443 80 8883

ENV LOG_DIR=/data CERT_DIR=/certs

LABEL org.opencontainers.image.title="Marstek Offline Endpoint" \
      org.opencontainers.image.description="Answers the telemetry upload a Marstek Venus expects, so the firmware stops resetting its network chip and the data stays in your LAN." \
      org.opencontainers.image.source="https://github.com/sphings79/Marstek-offline-endpoint" \
      org.opencontainers.image.licenses="MIT"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
