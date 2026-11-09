FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY modules ./modules
COPY packages ./packages
RUN bun install --frozen-lockfile
COPY scripts ./scripts
COPY src ./src
# src/client.tsx dan kontrak API sudah di-commit dan diperiksa CI, jadi di sini hanya build server dan peramban.
RUN bun scripts/build.ts

FROM oven/bun:1.4.4-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
USER bun
ENV HOST=0.0.0.0 PORT=8000
EXPOSE 8000
CMD ["bun", "dist/main.js"]
