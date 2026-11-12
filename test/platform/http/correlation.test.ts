import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    correlationHeader,
    requestCorrelationId,
} from '../../../src/platform/http/index.ts';
import { operationsTestApp } from '../../support/operations-app.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('request correlation id', () => {
    test('a UUID sent by the caller is kept, in lower case', () => {
        const sent = Bun.randomUUIDv7();

        expect(
            requestCorrelationId(
                new Request('http://localhost/', {
                    headers: { [correlationHeader]: sent.toUpperCase() },
                }),
            ),
        ).toBe(sent);
    });

    test('a missing or malformed header gets a new id per request', () => {
        const missing = requestCorrelationId(new Request('http://localhost/'));
        const malformed = requestCorrelationId(
            new Request('http://localhost/', {
                headers: { [correlationHeader]: 'resep-123' },
            }),
        );

        expect(missing).toMatch(uuid);
        expect(malformed).toMatch(uuid);
        expect(malformed).not.toBe(missing);
    });
});

// Jawaban mengembalikan correlation id database request, yaitu nilai yang dibawa event yang diterbitkannya.
describe.skipIf(!process.env.DB_HOST)(
    'the correlation id travels with the request',
    () => {
        let app: ReturnType<typeof operationsTestApp>;

        beforeAll(() => {
            app = operationsTestApp();
        });
        afterAll(async () => {
            await app.close();
        });

        test('the caller id comes back on the response', async () => {
            const sent = Bun.randomUUIDv7();

            const response = await app
                .browser()
                .request('GET', '/api/v1/shell', {
                    headers: { [correlationHeader]: sent },
                });

            expect(response.headers.get(correlationHeader)).toBe(sent);
        });

        test('each request without one gets its own', async () => {
            const browser = app.browser();

            const first = await browser.get('/api/v1/shell');
            const second = await browser.get('/api/v1/shell');

            expect(first.headers.get(correlationHeader)).toMatch(uuid);
            expect(second.headers.get(correlationHeader)).toMatch(uuid);
            expect(second.headers.get(correlationHeader)).not.toBe(
                first.headers.get(correlationHeader),
            );
        });
    },
);
