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
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /migrations ./
USER bun
ENV HOST=0.0.0.0 PORT=8000
EXPOSE 8000
# Worker lingkungan dari image yang sama: bun dist/worker.js
CMD ["bun", "dist/main.js"]
