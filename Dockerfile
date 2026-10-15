# alpine + nodejs from the distro repos rather than node:*-alpine: the official
# Node images do not publish every architecture this needs -- a Raspberry Pi 3B on
# 32-bit Raspberry Pi OS wants linux/arm/v7, a Pi Zero linux/arm/v6, and an old
# 32-bit laptop linux/386. Alpine packages nodejs for all of them.
# 3.22 for Node 22: its built-in node:sqlite carries the measurements database, so there is
# nothing extra to install. 3.22 has nodejs for all five architectures.
FROM alpine:3.22

RUN apk add --no-cache nodejs openssl tzdata

WORKDIR /app
COPY server.cjs web.cjs auth.cjs devices.cjs history.cjs updates.cjs ping.cjs uptime.cjs db.cjs keydefs.cjs notify.cjs mqtt.cjs support.cjs logbuf.cjs store.cjs uptime-history.cjs webupdate.cjs supervisor.cjs webproc.cjs web-version.json webupdate.pub /app/
COPY web /app/web
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

VOLUME ["/data", "/certs"]
EXPOSE 443 80 8883 8443

# the version the page shows and the update check compares; the workflow sets it (vX.Y.Z for a release, dev+<commit> otherwise)
ARG APP_VERSION=dev
ENV LOG_DIR=/data CERT_DIR=/certs APP_VERSION=$APP_VERSION
# node:sqlite is still flagged experimental and says so on first use; the rest of the log stays readable
ENV NODE_OPTIONS=--disable-warning=ExperimentalWarning

LABEL org.opencontainers.image.title="Marstek Offline Endpoint" \
      org.opencontainers.image.description="Answers the telemetry upload a Marstek Venus expects, so the firmware stops resetting its network chip and the data stays in your LAN." \
      org.opencontainers.image.source="https://github.com/sphings79/Marstek-offline-endpoint" \
      org.opencontainers.image.licenses="MIT"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
