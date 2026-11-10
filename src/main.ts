import { randomUUID } from 'node:crypto';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { RedisClient } from 'bun';
import { Elysia } from 'elysia';
import type { z } from 'zod';
import { assetManagementRoutes } from '../modules/asset-management/src/index.ts';
import { healthcareRoutes } from '../modules/healthcare/src/index.ts';
import type { workspaceSelectionSchema } from './platform/access/index.ts';
import {
    accessRoutes,
    shellRoutes,
    Workspace,
} from './platform/access/index.ts';
import { loadConfig, type Config } from './platform/config/index.ts';
import {
    flushErrorReporting,
    reportError,
    startErrorReporting,
} from './platform/error-reporting/index.ts';
import {
    createPool,
    Database,
    sqlErrorCode,
} from './platform/database/index.ts';
import {
    base,
    bodyInput,
    clientBuild,
    HttpFailure,
    ok,
    typedBody,
    type Context,
} from './platform/http/index.ts';
import {
    NumberSequences,
    numberSequenceRoutes,
} from './foundation/number-sequence/index.ts';
import { addressBookRoutes } from './platform/address-book/index.ts';
import {
    findRoute,
    parseAddress,
    type EnvironmentRoute,
} from './platform/environment/index.ts';
import { geographyRoutes } from './platform/geography/index.ts';
import type { loginInputSchema } from './platform/identity/index.ts';
import { Session, ValkeySessions } from './platform/identity/index.ts';
import {
    onOrganizationCreated,
    organizationRoutes,
} from './platform/organization/index.ts';

// Legal entity dan unit baru mendapat number sequence bawaan untuk setiap reference yang memintanya lewat
// app_number_sequence_references. Organization ada di Platform, jadi ia tidak meng-import Foundation sendiri.
onOrganizationCreated(async (db, organization) => {
    const sequences = new NumberSequences(
        db,
        organization.tenantId,
        organization.userId,
    );
    switch (organization.classification) {
        case 'legal_entity':
            return sequences.createLegalEntityDefaults(
                organization.organizationId,
            );
        case 'operating_unit':
            return sequences.createUnitDefaults(organization.organizationId);
        default: {
            const unknown: never = organization.classification;
            throw new Error(`Unknown classification: ${String(unknown)}`);
        }
    }
});

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

// Seluruh procedure aplikasi. Tipenya dipakai klien oRPC di layar (`src/platform/shell/api.ts`), dan bentuk route-nya
// ditulis scripts/generate-client.ts ke kontrak yang dibaca klien itu.
export const router = {
    login: base
        .route({
            method: 'POST',
            path: '/login',
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        })
        .input(typedBody<z.input<typeof loginInputSchema>>())
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
        .input(typedBody<z.input<typeof workspaceSelectionSchema>>())
        .handler(async ({ context, input }) => {
            context.session.csrf(input.body);
            return ok(
                await Workspace.select(context.db, context.session, input.body),
            );
        }),
    ...shellRoutes(),
    ...accessRoutes(),
    ...organizationRoutes(),
    ...geographyRoutes(),
    ...addressBookRoutes(),
    ...numberSequenceRoutes(),
    ...assetManagementRoutes(),
    ...healthcareRoutes(),
};
export type Router = typeof router;

export function createApplication(config: Config) {
    // Pool database runtime: peta alamat, dan data lingkungan yang memakai database bersama. Lingkungan dengan
    // database sendiri mendapat pool-nya saat pertama kali dibuka.
    const pool = createPool(config);
    const environmentPools = new Map<string, ReturnType<typeof createPool>>();
    function poolFor(route: EnvironmentRoute | null) {
        if (!route?.database_name) return pool;
        let environmentPool = environmentPools.get(route.database_name);
        if (!environmentPool) {
            environmentPool = createPool({
                ...config,
                DB_DATABASE: route.database_name,
            });
            environmentPools.set(route.database_name, environmentPool);
        }
        return environmentPool;
    }
    // Alamat di bawah domain dasar yang tidak menunjuk lingkungan tercatat dijawab 404, begitu pula alamat lain saat
    // domain dasar diisi, supaya tidak ada request yang jatuh ke database runtime tanpa tenant.
    async function resolve(
        request: Request,
    ): Promise<EnvironmentRoute | null | 'not-found'> {
        const address = parseAddress(
            request.headers.get('host') ?? new URL(request.url).host,
            config.BASE_DOMAIN,
        );
        switch (address.kind) {
            case 'unrouted':
                return config.BASE_DOMAIN ? 'not-found' : null;
            case 'unknown':
                return 'not-found';
            case 'environment':
                return (
                    (await findRoute(
                        pool,
                        address.tenantSlug,
                        address.environment,
                    )) ?? 'not-found'
                );
            default: {
                const unknown: never = address;
                throw new Error(`Alamat tidak dikenal: ${String(unknown)}`);
            }
        }
    }
    const valkey = valkeySessions(config);
    const client = clientBuild(config.CLIENT_DIR);
    const handler = new OpenAPIHandler(router, {
        customErrorResponseBodyEncoder: (error): unknown =>
            error.data ?? { message: error.message },
    });
    return {
        async handle(
            request: Request,
            clientAddress: string,
        ): Promise<Response> {
            // Berkas build dan dokumen layar tidak membuka sesi maupun koneksi database.
            const served = await client.serve(request);
            if (served) return served;
            let environment: EnvironmentRoute | null;
            try {
                const resolved = await resolve(request);
                if (resolved === 'not-found')
                    return Response.json(
                        { message: 'Not Found' },
                        {
                            status: 404,
                            headers: { 'Cache-Control': 'no-cache, private' },
                        },
                    );
                environment = resolved;
            } catch (error) {
                reportError(error, {
                    method: request.method,
                    path: new URL(request.url).pathname,
                });
                return Response.json(
                    { message: 'Server Error' },
                    {
                        status: 500,
                        headers: { 'Cache-Control': 'no-cache, private' },
                    },
                );
            }
            const connection = await poolFor(environment).reserve();
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
                    environment,
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
                    reportError(error, {
                        method: request.method,
                        path: new URL(request.url).pathname,
                    });
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
            await Promise.all([
                pool.end(),
                ...[...environmentPools.values()].map((environmentPool) =>
                    environmentPool.end(),
                ),
            ]);
        },
    };
}

if (import.meta.main) {
    const config = loadConfig();
    startErrorReporting(config, 'http');
    const application = createApplication(config);
    const app = new Elysia({ aot: true, precompile: true });
    app.all(
        '*',
        ({ request, server }) =>
            application.handle(
                request,
                server?.requestIP(request)?.address ?? '',
            ),
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
    const shutdown = async () => {
        await app.stop();
        await application.close();
        await flushErrorReporting();
    };
    process.on('SIGTERM', () => void shutdown());
    process.on('SIGINT', () => void shutdown());
}
