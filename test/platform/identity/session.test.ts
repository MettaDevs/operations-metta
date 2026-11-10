import { afterAll, describe, expect, test } from 'bun:test';
import { RedisClient } from 'bun';
import { Database } from '../../../src/platform/database/index.ts';
import {
    CookieCipher,
    randomToken,
    Session,
} from '../../../src/platform/identity/session.ts';
import { ValkeySessions } from '../../../src/platform/identity/valkey-sessions.ts';
import {
    operationsTestApp,
    type Browser,
} from '../../support/operations-app.ts';
import { createUser } from '../../support/tenant-fixtures.ts';

test('encrypted cookies validate both the envelope MAC and the cookie-name prefix', () => {
    const cipher = new CookieCipher(Buffer.alloc(32, 19));
    const session = randomToken();
    const encrypted = cipher.encrypt('laravel-session', session);
    expect(cipher.decrypt('laravel-session', encrypted)).toBe(session);
    expect(cipher.decrypt('XSRF-TOKEN', encrypted)).toBeNull();
    const data = JSON.parse(Buffer.from(encrypted, 'base64').toString()) as {
        value: string;
    };
    data.value = data.value.slice(0, -2) + 'AA';
    expect(
        cipher.decrypt(
            'laravel-session',
            Buffer.from(JSON.stringify(data)).toString('base64'),
        ),
    ).toBeNull();
    expect(cipher.decrypt('laravel-session', 'broken')).toBeNull();
});

// Sesi di penyimpanan sungguhan untuk kedua backend: PostgreSQL, dan Valkey bila VALKEY_HOST diisi. Permintaan latar
// dijalankan seperti src/main.ts menjalankannya, Session.open lalu save, dengan permintaan lain di antara keduanya.
// Di peramban urutan ini mudah terjadi, karena SPA mengirim permintaan latar, misalnya refetch saat jendela fokus.
const backends = [
    { backend: 'database', enabled: Boolean(process.env.DB_HOST) },
    {
        backend: 'valkey',
        enabled: Boolean(process.env.DB_HOST && process.env.VALKEY_HOST),
    },
];

for (const { backend, enabled } of backends)
    describe.skipIf(!enabled)(`sessions stored in ${backend}`, () => {
        if (!enabled) return;
        const app = operationsTestApp({
            SESSION_BACKEND: backend,
            // Namespace sendiri, supaya kunci Valkey putaran ini tidak bertemu kunci putaran lain.
            SESSION_KEY_PREFIX: `ops-test-session:${Bun.randomUUIDv7()}:`,
        });
        const { config, pool } = app;
        const cipher = new CookieCipher(config.key);
        const client =
            backend === 'valkey'
                ? new RedisClient(
                      `redis://${config.VALKEY_HOST}:${config.VALKEY_PORT}`,
                  )
                : null;
        const valkey = client
            ? new ValkeySessions(
                  client,
                  config.SESSION_KEY_PREFIX,
                  config.SESSION_LIFETIME * 60,
              )
            : null;
        afterAll(async () => {
            valkey?.close();
            await app.close();
        });

        // Cookie yang dipasang response, dalam bentuk header Cookie yang dikirim peramban sesudahnya.
        function cookieOf(response: Response): string {
            return response.headers
                .getSetCookie()
                .map((cookie) => cookie.split(';')[0])
                .join('; ');
        }

        function sessionIdOf(cookie: string): string {
            const name = config.SESSION_COOKIE + '=';
            const value = cookie
                .split('; ')
                .find((pair) => pair.startsWith(name))
                ?.slice(name.length);
            const id = value
                ? cipher.decrypt(
                      config.SESSION_COOKIE,
                      decodeURIComponent(value),
                  )
                : null;
            if (!id) throw new Error('The cookie carries no session.');
            return id;
        }

        async function stored(id: string): Promise<boolean> {
            if (client) return client.exists(config.SESSION_KEY_PREFIX + id);
            const rows = await pool.unsafe(
                'select 1 from sessions where id=$1',
                [id],
            );
            return rows.length > 0;
        }

        async function login(browser: Browser) {
            const user = await createUser(pool);
            const response = await browser.request('POST', '/login', {
                body: { email: user.email, password: user.password },
                headers: { 'sec-fetch-site': 'same-origin' },
            });
            expect(response.status).toBe(200);
            return { userId: user.userId, cookie: cookieOf(response) };
        }

        // Status data Shell untuk permintaan baru dengan cookie itu: 200 berarti login, 401 berarti tidak.
        async function shellStatus(cookie: string): Promise<number> {
            const response = await app
                .browser()
                .request('GET', '/api/v1/shell', { headers: { cookie } });
            return response.status;
        }

        // Permintaan latar yang sudah membuka sesinya dan belum menyimpannya.
        async function openBackgroundRequest(cookie: string) {
            const connection = await pool.reserve();
            const db = new Database(connection, undefined, 'test');
            const session = await Session.open(
                db,
                config,
                new Request('http://localhost/api/v1/shell', {
                    headers: { cookie },
                }),
                '203.0.113.9',
                valkey,
            );
            return {
                session,
                async save(): Promise<string[]> {
                    try {
                        return await session.save();
                    } finally {
                        await db.actor(null);
                        connection.release();
                    }
                },
            };
        }

        test('a request on a live session updates it, keeps its lifetime, and sends its cookies again', async () => {
            const { userId, cookie } = await login(app.browser());
            const id = sessionIdOf(cookie);
            const request = await openBackgroundRequest(cookie);
            request.session.data.workspace = { work_date: '2026-11-09' };
            expect(await request.save()).toHaveLength(2);

            const next = await openBackgroundRequest(cookie);
            expect(next.session.id).toBe(id);
            expect(next.session.user?.id).toBe(userId);
            expect(next.session.data.workspace).toEqual({
                work_date: '2026-11-09',
            });
            await next.save();
            if (client) {
                const ttl = await client.ttl(config.SESSION_KEY_PREFIX + id);
                expect(ttl).toBeGreaterThan(0);
                expect(ttl).toBeLessThanOrEqual(config.SESSION_LIFETIME * 60);
            }
        });

        test('a request opened before logout does not log the user back in when it saves', async () => {
            const browser = app.browser();
            const { userId, cookie } = await login(browser);
            const id = sessionIdOf(cookie);
            const background = await openBackgroundRequest(cookie);
            expect(background.session.user?.id).toBe(userId);

            expect((await browser.post('/logout')).status).toBe(204);
            const cookies = await background.save();

            expect(await shellStatus(cookie)).toBe(401);
            expect(await stored(id)).toBe(false);
            // Cookie sesi yang sudah dihapus tidak dikirim ulang, jadi peramban tetap memegang cookie dari logout.
            expect(cookies).toEqual([]);
        });

        test('a request that arrives after logout with the old cookie does not give the session back to an earlier request', async () => {
            const browser = app.browser();
            const { cookie } = await login(browser);
            const id = sessionIdOf(cookie);
            const background = await openBackgroundRequest(cookie);

            expect((await browser.post('/logout')).status).toBe(204);
            expect(await shellStatus(cookie)).toBe(401);
            await background.save();

            expect(await shellStatus(cookie)).toBe(401);
            expect(await stored(id)).toBe(false);
        });

        test('login replaces the session id, and the cookie from before login stays logged out', async () => {
            const browser = app.browser();
            const guest = await browser.get('/api/v1/shell');
            expect(guest.status).toBe(401);
            const before = cookieOf(guest);

            const { cookie } = await login(browser);

            expect(sessionIdOf(cookie)).not.toBe(sessionIdOf(before));
            expect(await stored(sessionIdOf(before))).toBe(false);
            expect(await shellStatus(before)).toBe(401);
            expect(await shellStatus(cookie)).toBe(200);
        });
    });

// Pesan login yang dibaca pengguna di layar Masuk: form memakai noValidate, jadi pesan field kosong datang dari server.
describe.skipIf(!process.env.DB_HOST)('login messages', () => {
    if (!process.env.DB_HOST) return;
    const app = operationsTestApp();
    afterAll(() => app.close());

    async function attempt(body: Record<string, string>) {
        const response = await app.browser().request('POST', '/login', {
            body,
            headers: { 'sec-fetch-site': 'same-origin' },
        });
        return {
            status: response.status,
            body: (await response.json()) as {
                message: string;
                errors: Record<string, string[]>;
            },
        };
    }

    test('a wrong password says the email or password is wrong', async () => {
        const user = await createUser(app.pool);
        const result = await attempt({
            email: user.email,
            password: user.password + '-salah',
        });
        expect(result.status).toBe(422);
        expect(result.body.errors).toEqual({
            email: ['Email atau kata sandi salah.'],
        });
        expect(result.body.message).toBe('Email atau kata sandi salah.');
    });

    test('empty fields ask for the email and the password', async () => {
        const result = await attempt({ email: '', password: '' });
        expect(result.status).toBe(422);
        expect(result.body.errors).toEqual({
            email: ['Isi email.'],
            password: ['Isi kata sandi.'],
        });
    });
});
