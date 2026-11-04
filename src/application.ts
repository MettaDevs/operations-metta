import { randomUUID } from 'node:crypto';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { ORPCError, os } from '@orpc/server';
import { RedisClient } from 'bun';
import { z } from 'zod';
import type { Config } from './config.ts';
import { createPool, Database, sqlErrorCode } from './db.ts';
import { HttpFailure } from './errors.ts';
import { Receipts } from './receipts.ts';
import { Session, Workspace } from './security.ts';
import { ValkeySessions } from './valkey.ts';

type Context = {
    db: Database;
    session: Session;
    request: Request;
    errorHeaders: Record<string, string>;
};
const bodyInput = z.object({ body: z.unknown() });
const recordInput = z.object({ params: z.object({ id: z.string() }) });
const mutationInput = recordInput.extend({ body: z.unknown() });
const ok = (body: object) => ({ status: 200, headers: {}, body });

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

export function createApplication(config: Config) {
    const pool = createPool(config);
    const valkey = valkeySessions(config);
    const base = os.$context<Context>().use(async ({ context, next }) => {
        try {
            return await next();
        } catch (error) {
            if (error instanceof HttpFailure) {
                context.errorHeaders = error.headers;
                throw new ORPCError('PHP_HTTP', {
                    status: error.status,
                    data: error.body,
                    message: error.message,
                });
            }
            if (error instanceof z.ZodError) {
                process.stderr.write(
                    JSON.stringify({
                        event: 'native-row-validation-failed',
                        fields: error.issues.map((issue) =>
                            issue.path.join('.'),
                        ),
                        messages: error.issues.map((issue) => issue.message),
                    }) + '\n',
                );
            } else {
                process.stderr.write(
                    JSON.stringify({
                        event: 'native-request-failed',
                        error:
                            error instanceof Error ? error.name : typeof error,
                        code: sqlErrorCode(error),
                        message:
                            error instanceof Error ? error.message : undefined,
                    }) + '\n',
                );
            }
            throw new ORPCError('INTERNAL_SERVER_ERROR', {
                status: 500,
                data: { message: 'Server Error' },
            });
        }
    });
    async function domain(context: Context, body?: unknown) {
        context.session.csrf(body);
        const workspace = await Workspace.resolve(
            context.db,
            context.session,
            config.MODULE_ID,
        );
        return new Receipts(context.db, workspace);
    }
    const receiptPath: `/${string}` = `/api/modules/${config.MODULE_ID}/v1/penerimaan-aset`;
    const assetPath: `/${string}` = `/api/modules/${config.MODULE_ID}/v1/aset`;
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
        receiptList: base
            .route({
                method: 'GET',
                path: receiptPath,
                outputStructure: 'detailed',
            })
            .handler(async ({ context }) =>
                ok(
                    await (
                        await domain(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        receiptCreate: base
            .route({
                method: 'POST',
                path: receiptPath,
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(bodyInput)
            .handler(async ({ context, input }) =>
                (await domain(context, input.body)).create(
                    context.request,
                    input.body,
                ),
            ),
        receiptShow: base
            .route({
                method: 'GET',
                path: `${receiptPath}/{id}`,
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(recordInput)
            .handler(async ({ context, input }) =>
                (await domain(context)).show(input.params.id),
            ),
        receiptUpdate: base
            .route({
                method: 'PATCH',
                path: `${receiptPath}/{id}`,
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(mutationInput)
            .handler(async ({ context, input }) =>
                (await domain(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        receiptComplete: base
            .route({
                method: 'POST',
                path: `${receiptPath}/{id}/selesaikan`,
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(mutationInput)
            .handler(async ({ context, input }) =>
                (await domain(context, input.body)).complete(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        receiptPreview: base
            .route({
                method: 'GET',
                path: `${receiptPath}/{id}/pratinjau-posting`,
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(recordInput)
            .handler(async ({ context, input }) =>
                ok(await (await domain(context)).preview(input.params.id)),
            ),
        receiptAssets: base
            .route({
                method: 'GET',
                path: `${receiptPath}/{id}/aset`,
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(recordInput)
            .handler(async ({ context, input }) =>
                ok(await (await domain(context)).assets(input.params.id)),
            ),
        assetList: base
            .route({
                method: 'GET',
                path: assetPath,
                outputStructure: 'detailed',
            })
            .handler(async ({ context }) =>
                ok(
                    await (
                        await domain(context)
                    ).inventory.list(new URL(context.request.url).searchParams),
                ),
            ),
        assetShow: base
            .route({
                method: 'GET',
                path: `${assetPath}/{id}`,
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(recordInput)
            .handler(async ({ context, input }) =>
                (await domain(context)).inventory.show(input.params.id),
            ),
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
