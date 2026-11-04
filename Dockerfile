FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY src ./src
RUN bun run build

FROM oven/bun:1.4.4-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
USER bun
ENV HOST=0.0.0.0 PORT=8000
EXPOSE 8000
CMD ["bun", "dist/elysia.js"]
