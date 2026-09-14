# ---------- build stage ----------
FROM node:24-alpine AS build
LABEL org.opencontainers.image.title="sme-erp-api"

# argon2 compiles from source on musl (alpine) — provide the toolchain
RUN apk add --no-cache python3 make g++ libc6-compat

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

# ---------- runtime stage ----------
FROM node:24-alpine
ENV NODE_ENV=production
ENV PORT=3000

# argon2 native runtime deps
RUN apk add --no-cache libgcc libstdc++ tini

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma7.config.ts ./prisma7.config.ts
COPY --from=build /app/package.json ./package.json

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O - http://localhost:3000/api/v1/health || exit 1

USER node
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]