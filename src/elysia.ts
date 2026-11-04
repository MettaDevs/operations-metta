import { Elysia } from 'elysia';
import { createApplication } from './application.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const application = createApplication(config);
const app = new Elysia({ aot: true, precompile: true });
app.all(
    '*',
    ({ request, server }) =>
        application.handle(request, server?.requestIP(request)?.address ?? ''),
    { parse: 'none' },
);
app.listen({
    hostname: config.HOST,
    port: config.PORT ?? 18645,
    reusePort: true,
    // Bawaan Bun memutus koneksi sesudah 10 detik; PHP, Go, dan Rust tetap menjawab request lambat.
    idleTimeout: 255,
});
process.stderr.write(
    JSON.stringify({
        event: 'listening',
        adapter: 'elysia-orpc',
        host: config.HOST,
        port: app.server?.port,
    }) + '\n',
);
process.on('SIGTERM', async () => {
    await app.stop();
    await application.close();
});
process.on('SIGINT', async () => {
    await app.stop();
    await application.close();
});
