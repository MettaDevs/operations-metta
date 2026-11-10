import { afterAll, describe, expect, test } from 'bun:test';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { loadConfig } from '../../../src/platform/config/index.ts';
import {
    flushErrorReporting,
    reportError,
    startErrorReporting,
} from '../../../src/platform/error-reporting/index.ts';
import {
    base,
    type Context,
    HttpFailure,
} from '../../../src/platform/http/index.ts';

// Sentry tiruan: server HTTP sungguhan yang menyimpan setiap envelope yang diterimanya, jadi yang diperiksa adalah
// byte yang benar-benar dikirim SDK, bukan pemanggilan fungsinya.
const envelopes: string[] = [];
const ingest = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
        envelopes.push(await request.text());
        return Response.json({ id: crypto.randomUUID() });
    },
});
const sent = () => envelopes.join('\n');
const environment = {
    DB_HOST: '127.0.0.1',
    DB_PORT: '1',
    DB_DATABASE: 'unused',
    DB_USERNAME: 'unused',
    DB_PASSWORD: 'unused',
    APP_KEY: 'base64:' + Buffer.alloc(32, 11).toString('base64'),
    SENTRY_DSN: `http://public@127.0.0.1:${ingest.port}/42`,
    SENTRY_ENVIRONMENT: 'test',
};
const previous = Object.fromEntries(
    Object.keys(environment).map((name) => [name, process.env[name]]),
);
Object.assign(process.env, environment);
const config = loadConfig();
for (const [name, value] of Object.entries(previous))
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
const unique = crypto.randomUUID();
const handler = new OpenAPIHandler(
    {
        explode: base
            .route({ method: 'POST', path: '/explode' })
            .handler(() => {
                throw new Error(`boom ${unique}`);
            }),
        refuse: base.route({ method: 'POST', path: '/refuse' }).handler(() => {
            throw new HttpFailure(422, { message: `refused ${unique}` });
        }),
    },
    {
        customErrorResponseBodyEncoder: (error): unknown =>
            error.data ?? { message: error.message },
    },
);

afterAll(() => ingest.stop(true));

// Middleware base hanya memakai request dan errorHeaders dari context; database dan sesi tidak disentuh route ini.
async function call(path: string): Promise<Response> {
    const request = new Request(`http://localhost${path}?token=SECRET_QUERY`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            cookie: 'laravel-session=SECRET_COOKIE',
            authorization: 'Bearer SECRET_TOKEN',
        },
        body: JSON.stringify({ password: 'SECRET_BODY' }),
    });
    const context = { request, errorHeaders: {} } as unknown as Context;
    const result = await handler.handle(request, { context });
    return result.response ?? new Response(null, { status: 404 });
}

describe('error reporting', () => {
    test('sends nothing without a DSN, which is the default', async () => {
        startErrorReporting({ ...config, SENTRY_DSN: undefined }, 'test');
        reportError(new Error(`before start ${unique}`));
        await flushErrorReporting(500);
        expect(envelopes).toHaveLength(0);
    });

    test('sends a 500 with its route and without request data', async () => {
        startErrorReporting(config, 'test');
        expect((await call('/refuse')).status).toBe(422);
        const response = await call('/explode');
        expect(response.status).toBe(500);
        await flushErrorReporting(5000);

        expect(sent()).toContain(`boom ${unique}`);
        expect(sent()).toContain('"http.route":"/explode"');
        expect(sent()).toContain('"process":"test"');
        expect(sent()).not.toContain(`refused ${unique}`);
        for (const secret of [
            'SECRET_QUERY',
            'SECRET_COOKIE',
            'SECRET_TOKEN',
            'SECRET_BODY',
        ])
            expect(sent()).not.toContain(secret);
    });
});
