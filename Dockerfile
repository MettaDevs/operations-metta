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
# Worker menjalankan migration Core di database lingkungan baru, jadi image membawa berkas migration dengan susunan
# folder yang sama dengan repo: database/migrations dan modules/<module>/database/migrations.
COPY database ./database
RUN mkdir -p /migrations/modules && cp -r database /migrations/ \
    && for module in modules/*/; do \
        if [ -d "$module/database/migrations" ]; then \
            mkdir -p "/migrations/$module/database" && cp -r "$module/database/migrations" "/migrations/$module/database/"; \
        fi; \
    done

FROM oven/bun:1.4.4-slim
# Rilis yang dilaporkan worker ke control plane. Alur rilis mengisinya; build lokal tetap `unreleased`.
ARG RELEASE=unreleased
ENV OPERATIONS_RELEASE=$RELEASE
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /migrations ./
USER bun
ENV HOST=0.0.0.0 PORT=8000
EXPOSE 8000
# Dari image yang sama: worker lingkungan `bun dist/worker.js`, dan migration database runtime `bun dist/migrate.js` yang
# dijalankan sekali sebelum proses HTTP dan worker versi baru dinyalakan.
CMD ["bun", "dist/main.js"]
