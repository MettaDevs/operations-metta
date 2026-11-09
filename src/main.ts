import { randomUUID } from 'node:crypto';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { RedisClient } from 'bun';
import { Elysia } from 'elysia';
import { assetManagementRoutes } from '../modules/asset-management/src/router.ts';
import { Workspace } from './platform/access/index.ts';
import { loadConfig, type Config } from './platform/config/index.ts';
import {
    createPool,
    Database,
    sqlErrorCode,
} from './platform/database/index.ts';
import {
    base,
    bodyInput,
    HttpFailure,
    ok,
    type Context,
} from './platform/http/index.ts';
import { Session, ValkeySessions } from './platform/identity/index.ts';

// Satu klien Valkey per proses Bun; ia tidak menyimpan apa pun milik request.
function valkeySessions(config: Config): ValkeySessions | null {
    switch (config.SESSION_BACKEND) {
        case 'database':
            return null;
        case 'valkey':
            return new ValkeySessions(
                new RedisClient(
                    `redis://${config.VALKEY_HOST}:${config.VALKEY_PORT}`,
                ),
                config.SESSION_KEY_PREFIX,
                config.SESSION_LIFETIME * 60,
            );
        default: {
            const unknown: never = config.SESSION_BACKEND;
            throw new Error(`SESSION_BACKEND tidak dikenal: ${unknown}`);
        }
    }
}

function createApplication(config: Config) {
    const pool = createPool(config);
    const valkey = valkeySessions(config);
    const router = {
        loginPage: base
            .route({
                method: 'GET',
                path: '/login',
                outputStructure: 'detailed',
            })
            .handler(() => ({
                status: 200,
                headers: { 'Content-Type': 'text/html; charset=UTF-8' },
                body: new Blob(
                    [
                        '<!doctype html><html lang="id"><head><title>Masuk</title></head><body></body></html>',
                    ],
                    { type: 'text/html; charset=UTF-8' },
                ),
            })),
        login: base
            .route({
                method: 'POST',
                path: '/login',
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(bodyInput)
            .handler(async ({ context, input }) =>
                ok(await context.session.login(input.body)),
            ),
        logout: base
            .route({
                method: 'POST',
                path: '/logout',
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(bodyInput)
            .handler(async ({ context, input }) => {
                await context.session.logout(input.body);
                return { status: 204, headers: {}, body: undefined };
            }),
        workspace: base
            .route({
                method: 'PUT',
                path: '/api/v1/workspace-context',
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(bodyInput)
            .handler(async ({ context, input }) => {
                context.session.csrf(input.body);
                return ok(
                    await Workspace.select(
                        context.db,
                        context.session,
                        input.body,
                    ),
                );
            }),
        ...assetManagementRoutes(),
    };
    const handler = new OpenAPIHandler(router, {
        customErrorResponseBodyEncoder: (error) =>
            error.data ?? { message: error.message },
    });
    return {
        async handle(
            request: Request,
            clientAddress: string,
        ): Promise<Response> {
            const connection = await pool.reserve();
            const db = new Database(
                connection,
                config.TRACE_FILE,
                randomUUID(),
            );
            let session: Session | undefined;
            let response: Response;
            try {
                session = await Session.open(
                    db,
                    config,
                    request,
                    clientAddress,
                    valkey,
                );
                const context: Context = {
                    db,
                    session,
                    request,
                    errorHeaders: {},
                };
                const result = await handler.handle(request, { context });
                response =
                    result.response ??
                    Response.json({ message: 'Not Found' }, { status: 404 });
                for (const [name, value] of Object.entries({
                    ...session.responseHeaders,
                    ...context.errorHeaders,
                }))
                    response.headers.set(name, value);
                for (const cookie of await session.save())
                    response.headers.append('Set-Cookie', cookie);
            } catch (error) {
                if (error instanceof HttpFailure) {
                    // Di luar handler hanya ValkeySessions yang melempar HttpFailure (503); lognya sudah ditulis di sana.
                    response = Response.json(error.body, {
                        status: error.status,
                        headers: error.headers,
                    });
                } else {
                    process.stderr.write(
                        JSON.stringify({
                            event: 'native-session-failed',
                            error:
                                error instanceof Error
                                    ? error.name
                                    : typeof error,
                            code: sqlErrorCode(error),
                            message:
                                error instanceof Error
                                    ? error.message
                                    : undefined,
                        }) + '\n',
                    );
                    response = Response.json(
                        { message: 'Server Error' },
                        { status: 500 },
                    );
                }
            } finally {
                await db.actor(null);
                connection.release();
            }
            response.headers.set('Cache-Control', 'no-cache, private');
            return response;
        },
        close: async () => {
            valkey?.close();
            await pool.end();
        },
    };
}

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
    port: config.PORT,
    reusePort: true,
    // Bawaan Bun memutus koneksi sesudah 10 detik, padahal CoreERP tetap menjawab request yang lebih lambat.
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
