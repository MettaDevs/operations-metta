import { Hono } from 'hono';
import type { Server } from 'bun';
import { createApplication } from './application.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const application = createApplication(config);
const app = new Hono<{ Bindings: { server: Server<unknown> } }>();
app.all('*', (context) =>
    application.handle(
        context.req.raw,
        context.env.server.requestIP(context.req.raw)?.address ?? '',
    ),
);

const server = Bun.serve({
    hostname: config.HOST,
    port: config.PORT ?? 18644,
    reusePort: true,
    // Bawaan Bun memutus koneksi sesudah 10 detik; PHP, Go, dan Rust tetap menjawab request lambat.
    idleTimeout: 255,
    fetch: (request, server) => app.fetch(request, { server }),
});
process.stderr.write(
    JSON.stringify({
        event: 'listening',
        adapter: 'hono-orpc',
        host: config.HOST,
        port: server.port,
    }) + '\n',
);
process.on('SIGTERM', async () => {
    await server.stop();
    await application.close();
});
process.on('SIGINT', async () => {
    await server.stop();
    await application.close();
});
