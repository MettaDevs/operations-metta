import { afterAll, expect, test } from 'bun:test';
import { createHash, createVerify, generateKeyPairSync } from 'node:crypto';
import {
    controlPlaneClient,
    OperationLost,
} from '../../../src/platform/control-plane/index.ts';

// Server tiruan yang memeriksa tanda tangan seperti control plane memeriksanya (parseSignature di
// control-plane-metta). Bukti dengan control plane sungguhan dijalankan di lab, karena batas yang hanya diuji lewat
// tiruan bisa tidak pernah berhasil sekali pun.
const keys = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const hostId = crypto.randomUUID();
const seen: { path: string; body: unknown; verified: boolean }[] = [];
let answer: (path: string) => Response = () =>
    new Response(null, { status: 204 });
const server = Bun.serve({
    port: 0,
    async fetch(request) {
        const url = new URL(request.url);
        const body = await request.text();
        const digest = `sha-256=:${createHash('sha256').update(body).digest('base64')}:`;
        const input =
            /^sig1=(\("@method" "@path" "content-digest"\);created=(\d+);keyid="([^"]+)";alg="rsa-v1_5-sha256")$/.exec(
                request.headers.get('signature-input') ?? '',
            );
        const value = /^sig1=:([A-Za-z0-9+/]+={0,2}):$/.exec(
            request.headers.get('signature') ?? '',
        );
        const verified =
            !!input &&
            !!value &&
            input[3] === hostId &&
            Math.abs(Date.now() / 1000 - Number(input[2])) < 300 &&
            request.headers.get('content-digest') === digest &&
            createVerify('sha256')
                .update(
                    [
                        `"@method": ${request.method}`,
                        `"@path": ${url.pathname}`,
                        `"content-digest": ${digest}`,
                        `"@signature-params": ${input[1]}`,
                    ].join('\n'),
                )
                .verify(keys.publicKey, Buffer.from(value[1]!, 'base64'));
        seen.push({ path: url.pathname, body: JSON.parse(body), verified });
        return answer(url.pathname);
    },
});
afterAll(() => server.stop(true));
const client = controlPlaneClient({
    url: `http://127.0.0.1:${server.port}`,
    hostId,
    privateKey: keys.privateKey,
});

test('claim dan laporan langkah ditandatangani sesuai kontrak worker', async () => {
    answer = () => new Response(null, { status: 204 });
    expect(await client.claim()).toBeNull();
    const operationId = crypto.randomUUID();
    answer = () => Response.json({ lease_until: null });
    await client.report(operationId, { status: 'succeeded', step: 'done' });
    expect(seen.slice(-2)).toEqual([
        { path: '/api/worker/v1/operations/claim', body: {}, verified: true },
        {
            path: `/api/worker/v1/operations/${operationId}/steps`,
            body: { status: 'succeeded', step: 'done' },
            verified: true,
        },
    ]);
});

test('operasi yang diambil dibaca, dan 409 berarti operasi hilang', async () => {
    const operation = {
        id: crypto.randomUUID(),
        operation: 'provision',
        environment_id: crypto.randomUUID(),
        parameters: { database: 'env_x' },
        lease_until: '2026-11-10T10:00:00+00:00',
    };
    answer = () => Response.json({ operation });
    expect(await client.claim()).toEqual(operation);
    answer = () =>
        Response.json({ error: 'operation_not_held' }, { status: 409 });
    expect(
        client.report(operation.id, { status: 'running', step: 'migrate' }),
    ).rejects.toBeInstanceOf(OperationLost);
});
