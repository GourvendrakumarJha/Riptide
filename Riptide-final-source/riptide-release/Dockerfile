FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    RIPTIDE_DATA_DIR=/data \
    RIPTIDE_DEMO_MODE=false \
    RIPTIDE_PREVIEW_COOKIES=false \
    RIPTIDE_SECURE_COOKIES=true
WORKDIR /app
COPY --chown=node:node . .
RUN npm ci --omit=dev --ignore-scripts && mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
