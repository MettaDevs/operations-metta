import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { operationsTestApp } from '../../support/operations-app.ts';

// URL layar milik aplikasi peramban, data hanya di bawah /api/. Build peramban di sini manifest buatan dengan berkas
// kecil, karena yang diuji cara server menyajikannya; build sungguhan diuji test/scripts/build.test.ts.
describe.skipIf(!process.env.DB_HOST)(
    'screens and the API share one server',
    () => {
        if (!process.env.DB_HOST) return;
        let directory: string;
        let app: ReturnType<typeof operationsTestApp>;
        const html = { accept: 'text/html' };

        beforeAll(async () => {
            directory = await mkdtemp(join(tmpdir(), 'ops-client-'));
            await Bun.write(
                join(directory, 'client-abc12345.js'),
                'export {};',
            );
            await Bun.write(join(directory, 'client-def67890.css'), 'body{}');
            await Bun.write(
                join(directory, 'secret.txt'),
                'bukan untuk peramban',
            );
            await Bun.write(
                join(directory, 'manifest.json'),
                JSON.stringify({
                    script: 'client-abc12345.js',
                    styles: ['client-def67890.css'],
                    files: ['client-abc12345.js', 'client-def67890.css'],
                }),
            );
            app = operationsTestApp({ CLIENT_DIR: directory });
        });
        afterAll(async () => {
            await app.close();
            await rm(directory, { recursive: true, force: true });
        });

        test('a screen URL answers with the document that loads the build, without a session', async () => {
            const browser = app.browser();
            for (const path of [
                '/',
                '/login',
                '/dashboard',
                '/settings/legal-entities',
                '/halaman/yang/tidak/ada?q=1',
            ]) {
                const response = await browser.request('GET', path, {
                    headers: html,
                });
                expect(response.status).toBe(200);
                expect(response.headers.get('content-type')).toBe(
                    'text/html; charset=utf-8',
                );
                expect(response.headers.getSetCookie()).toEqual([]);
                const body = await response.text();
                expect(body).toContain(
                    '<script type="module" src="/build/client-abc12345.js"></script>',
                );
                expect(body).toContain(
                    '<link rel="stylesheet" href="/build/client-def67890.css">',
                );
                expect(body).toContain('<div id="app"></div>');
            }
        });

        test('built files are served immutable, and only those the manifest lists', async () => {
            const browser = app.browser();
            const script = await browser.get('/build/client-abc12345.js');
            expect(script.status).toBe(200);
            expect(script.headers.get('cache-control')).toBe(
                'public, max-age=31536000, immutable',
            );
            expect(await script.text()).toBe('export {};');
            for (const path of [
                '/build/secret.txt',
                '/build/manifest.json',
                '/build/client-zzz.js',
                '/build/..%2Fmanifest.json',
            ])
                expect((await browser.get(path)).status).toBe(404);
        });

        test('a path under /api/ never falls back to the document, and its 404 stays JSON', async () => {
            const browser = app.browser();
            const missing = await browser.request('GET', '/api/v1/tidak-ada', {
                headers: html,
            });
            expect(missing.status).toBe(404);
            expect(await missing.json()).toEqual({ message: 'Not Found' });
            const bare = await browser.request('GET', '/api', {
                headers: html,
            });
            expect(bare.status).toBe(404);
            expect(bare.headers.get('content-type')).toContain(
                'application/json',
            );
            const shell = await browser.request('GET', '/api/v1/shell', {
                headers: html,
            });
            expect(shell.status).toBe(401);
            expect(await shell.json()).toEqual({ message: 'Unauthenticated.' });
        });

        test('POST /login stays with the API while GET /login is the screen', async () => {
            const response = await app.browser().request('POST', '/login', {
                body: { email: '', password: '' },
                headers: { 'sec-fetch-site': 'same-origin' },
            });
            expect(response.status).toBe(422);
        });

        test('a rebuilt manifest is served without restarting the server', async () => {
            const browser = app.browser();
            await browser.request('GET', '/dashboard', { headers: html });
            await Bun.write(
                join(directory, 'client-new00000.js'),
                'export {};',
            );
            await Bun.write(
                join(directory, 'manifest.json'),
                JSON.stringify({
                    script: 'client-new00000.js',
                    styles: [],
                    files: ['client-new00000.js'],
                }),
            );
            const body = await (
                await browser.request('GET', '/dashboard', { headers: html })
            ).text();
            expect(body).toContain('/build/client-new00000.js');
            expect(body).not.toContain('client-abc12345.js');
            expect(
                (await browser.get('/build/client-abc12345.js')).status,
            ).toBe(404);
        });

        test('without a build the screens say so instead of failing silently', async () => {
            const empty = await mkdtemp(join(tmpdir(), 'ops-client-'));
            const bare = operationsTestApp({ CLIENT_DIR: empty });
            try {
                const response = await bare
                    .browser()
                    .request('GET', '/dashboard', { headers: html });
                expect(response.status).toBe(503);
                expect(await response.text()).toContain('bun run build');
            } finally {
                await bare.close();
                await rm(empty, { recursive: true, force: true });
            }
        });
    },
);
