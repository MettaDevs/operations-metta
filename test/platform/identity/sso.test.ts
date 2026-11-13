import {
    afterAll,
    beforeAll,
    describe,
    expect,
    setSystemTime,
    test,
} from 'bun:test';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { databaseSettingsSchema } from '../../../src/platform/config/index.ts';
import {
    provisionEnvironment,
    provisionRequestSchema,
    syncIdentities,
} from '../../../src/platform/environment/index.ts';
import { readMigrationSource } from '../../../src/platform/migration/index.ts';
import { createMigratedEnvironmentDatabase } from '../../support/environment-database.ts';
import { OidcStub } from '../../support/oidc-provider.ts';
import {
    type Browser,
    operationsTestApp,
} from '../../support/operations-app.ts';

const base = 'uji.test';
const password = 'kata-sandi-admin-sso';

describe.skipIf(!process.env.DB_HOST)('masuk lewat SSO', () => {
    if (!process.env.DB_HOST) return;
    const settings = databaseSettingsSchema.parse(process.env);
    const source = readMigrationSource(resolve(import.meta.dir, '../../..'));
    const connection = (database: string) =>
        postgres({
            host: settings.DB_HOST,
            port: settings.DB_PORT,
            database,
            username: settings.DB_USERNAME,
            password: settings.DB_PASSWORD,
            max: 1,
            onnotice: () => {},
        });
    const runtime = connection(settings.DB_DATABASE);
    const suffix = Bun.randomUUIDv7().slice(-8);
    const database = `${settings.DB_DATABASE.slice(0, 40)}_sso_${suffix}`;
    let environment: postgres.Sql;
    let stub: OidcStub;
    let app: ReturnType<typeof operationsTestApp>;
    let tenant: ReturnType<typeof provisionRequestSchema.parse>;
    let host: string;

    beforeAll(async () => {
        stub = await OidcStub.start(`https://${base}/sso/callback`);
        app = operationsTestApp({
            BASE_DOMAIN: base,
            SSO_ISSUER: stub.issuer,
            SSO_CLIENT_ID: stub.clientId,
            SSO_CLIENT_SECRET: stub.clientSecret,
        });
        const id = Bun.randomUUIDv7();
        tenant = provisionRequestSchema.parse({
            environment: { kind: 'production', name: 'Produksi' },
            database,
            client: {
                id: Bun.randomUUIDv7(),
                legal_name: 'PT Uji SSO',
                slug: `sso-${id.slice(-12)}`,
            },
            tenant: {
                id,
                name: 'Klinik Uji SSO',
                slug: `sso-${id.slice(-12)}`,
            },
            admin: {
                id: Bun.randomUUIDv7(),
                name: 'Admin Uji SSO',
                email: `sso-${id}@example.com`,
                password_hash: await Bun.password.hash(password, {
                    algorithm: 'bcrypt',
                    cost: 4,
                }),
            },
        });
        await createMigratedEnvironmentDatabase(settings, source, database);
        await provisionEnvironment(settings, source, tenant);
        environment = connection(database);
        host = `${tenant.tenant.slug}.${base}`;
    }, 120_000);
    afterAll(async () => {
        await app.close();
        stub.stop();
        await environment.end();
        await runtime.unsafe(
            `drop database if exists "${database}" with (force)`,
        );
        await runtime.end();
    }, 120_000);

    const link = async (userId: string, subject: string) =>
        environment.unsafe(
            'insert into external_identities (id, user_id, issuer, subject, created_at, updated_at) values ($1, $2, $3, $4, now(), now())',
            [Bun.randomUUIDv7(), userId, stub.issuer, subject],
        );

    // Kaki pertama dan kedua: peramban memulai di alamat lingkungan, penyedia memberi kode, lalu penyedia membawa
    // peramban ke alamat balik di domain dasar. Mengembalikan jawaban alamat balik.
    async function untilCallback(
        browser: Browser,
        subject: string,
        begin: () => Promise<Response> = () => browser.get('/sso/start'),
        claims: Record<string, unknown> = {},
    ): Promise<Response> {
        const started = await begin();
        let authorize: string;
        if (started.status === 302)
            authorize = started.headers.get('location')!;
        else {
            expect(started.status).toBe(200);
            authorize = (
                (await started.json()) as { authorization_url: string }
            ).authorization_url;
        }
        expect(authorize.startsWith(`${stub.issuer}/authorize?`)).toBe(true);
        const url = new URL(authorize);
        expect(url.searchParams.get('redirect_uri')).toBe(
            `https://${base}/sso/callback`,
        );
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        const code = stub.grant(
            authorize,
            stub.idClaims({ sub: subject, ...claims }),
        );
        // Alamat balik dibuka peramban yang sama, tetapi cookie lingkungan tidak berlaku di domain dasar.
        return app
            .browser(base)
            .get(
                `/sso/callback?code=${code}&state=${url.searchParams.get('state')}`,
            );
    }

    function handoffPath(callback: Response): string {
        expect(callback.status).toBe(302);
        const location = new URL(callback.headers.get('location')!);
        expect(location.origin).toBe(`https://${host}`);
        expect(location.pathname).toBe('/sso/handoff');
        return location.pathname + location.search;
    }

    test('pengguna tertaut masuk lewat tiga kaki dan bekerja di tenant pemilik alamat', async () => {
        const subject = `admin-${suffix}`;
        await link(tenant.admin.id, subject);
        const browser = app.browser(host);
        const started = await browser.get('/sso/start?redirect=/profile');
        const ceremony = started.headers
            .getSetCookie()
            .find((cookie) => cookie.startsWith('__Host-sso-ceremony='));
        expect(ceremony).toContain('; HttpOnly');
        expect(ceremony).toContain('; Secure');
        expect(ceremony?.toLowerCase()).not.toContain('domain=');
        const callback = await untilCallback(
            browser,
            subject,
            () => Promise.resolve(started),
            // Nonce yang dikirim kembali harus sama dengan yang dibuat di kaki pertama.
            {
                nonce: new URL(
                    started.headers.get('location')!,
                ).searchParams.get('nonce'),
            },
        );
        const done = await browser.get(handoffPath(callback));
        expect(done.status).toBe(302);
        expect(done.headers.get('location')).toBe('/profile');
        expect(
            done.headers
                .getSetCookie()
                .some((cookie) => cookie.startsWith('__Host-session=')),
        ).toBe(true);
        const shell = await browser.get('/api/v1/shell');
        expect(shell.status).toBe(200);
        const body = (await shell.json()) as {
            auth: {
                user: { email: string };
                membership: { tenant_id: string };
            };
        };
        expect(body.auth.user.email).toBe(tenant.admin.email);
        expect(body.auth.membership.tenant_id).toBe(tenant.tenant.id);
    });

    test('nonce yang berbeda ditolak', async () => {
        const subject = `nonce-${suffix}`;
        const browser = app.browser(host);
        const callback = await untilCallback(browser, subject, undefined, {
            nonce: 'bukan-nonce-upacara-ini',
        });
        expect(callback.status).toBe(302);
        expect(callback.headers.get('location')).toBe(
            `https://${host}/login?sso_error=failed`,
        );
    });

    test('identitas yang belum tertaut ditolak tanpa sesi, walau emailnya sama dengan pengguna', async () => {
        const browser = app.browser(host);
        const callback = await untilCallback(
            browser,
            `asing-${suffix}`,
            undefined,
            { email: tenant.admin.email },
        );
        expect(callback.status).toBe(302);
        expect(callback.headers.get('location')).toBe(
            `https://${host}/login?sso_error=unlinked`,
        );
        expect((await browser.get('/api/v1/shell')).status).toBe(401);
        const [linked] = await environment.unsafe(
            'select count(*)::int as count from external_identities where subject = $1',
            [`asing-${suffix}`],
        );
        expect(linked?.count).toBe(0);
    });

    test('state yang tidak dikenal ditolak sebelum kode ditukar', async () => {
        const response = await app
            .browser(base)
            .get('/sso/callback?code=apa-saja&state=tidak-dikenal');
        expect(response.status).toBe(400);
    });

    test('token serah hanya berlaku sekali dan hanya dari peramban yang memulai', async () => {
        const subject = `serah-${suffix}`;
        const member = await memberWithPassword('serah');
        await link(member.id, subject);
        const browser = app.browser(host);
        const path = handoffPath(await untilCallback(browser, subject));

        // Tautan yang bocor dibuka peramban lain: ditolak, dan tokennya tetap milik peramban asal.
        const thief = app.browser(host);
        const stolen = await thief.get(path);
        expect(stolen.headers.get('location')).toBe('/login?sso_error=expired');
        expect((await thief.get('/api/v1/shell')).status).toBe(401);

        const secret = browser.cookies.get('__Host-sso-ceremony')!;
        const first = await browser.get(path);
        expect(first.headers.get('location')).toBe('/');
        expect((await browser.get('/api/v1/shell')).status).toBe(200);

        // Token yang sudah dipakai ditolak, walau dibawa bersama rahasia peramban yang benar.
        const again = app.browser(host);
        again.cookies.set('__Host-sso-ceremony', secret);
        const replayed = await again.get(path);
        expect(replayed.headers.get('location')).toBe(
            '/login?sso_error=expired',
        );
        expect((await again.get('/api/v1/shell')).status).toBe(401);
    });

    test('menautkan akun dari profil menuntut kata sandi, lalu akun itu bisa masuk lewat SSO', async () => {
        const member = await memberWithPassword('tautkan');
        const subject = `tautkan-${suffix}`;
        const browser = app.browser(host);
        await browser.login(member.email, member.password);

        const wrong = await browser.post('/api/v1/profile/sso-link', {
            password: 'bukan-kata-sandinya',
        });
        expect(wrong.status).toBe(422);
        const missing = await browser.post('/api/v1/profile/sso-link', {});
        expect(missing.status).toBe(422);

        const callback = await untilCallback(browser, subject, () =>
            browser.post('/api/v1/profile/sso-link', {
                password: member.password,
            }),
        );
        const linked = await browser.get(handoffPath(callback));
        expect(linked.headers.get('location')).toBe('/profile?sso=linked');
        const [row] = await environment.unsafe(
            'select user_id from external_identities where issuer = $1 and subject = $2 and deleted_at is null',
            [stub.issuer, subject],
        );
        expect(row?.user_id).toBe(member.id);

        const profile = (await (
            await browser.get('/api/v1/profile')
        ).json()) as {
            has_password: boolean;
            sso_enabled: boolean;
            identities: { id: string; issuer: string }[];
        };
        expect(profile.has_password).toBe(true);
        expect(profile.sso_enabled).toBe(true);
        expect(profile.identities.map((identity) => identity.issuer)).toEqual([
            stub.issuer,
        ]);

        // Akun yang sudah tertaut tidak memulai tautan kedua.
        const second = await browser.post('/api/v1/profile/sso-link', {
            password: member.password,
        });
        expect(second.status).toBe(409);

        const fresh = app.browser(host);
        const login = await fresh.get(
            handoffPath(await untilCallback(fresh, subject)),
        );
        expect(login.headers.get('location')).toBe('/');
        expect((await fresh.get('/api/v1/shell')).status).toBe(200);

        // Tautan dilepas (penghapusan lunak), dan identitas itu tidak lagi bisa masuk.
        const unlinked = await browser.delete(
            `/api/v1/profile/sso-identities/${profile.identities[0]!.id}`,
        );
        expect(unlinked.status).toBe(204);
        const [removed] = await environment.unsafe(
            'select deleted_at is not null as removed from external_identities where id = $1',
            [profile.identities[0]!.id],
        );
        expect(removed?.removed).toBe(true);
        const after = await untilCallback(app.browser(host), subject);
        expect(after.headers.get('location')).toBe(
            `https://${host}/login?sso_error=unlinked`,
        );
    });

    test('identitas yang sudah tertaut ke pengguna lain tidak bisa ditautkan lagi', async () => {
        const owner = await memberWithPassword('pemilik');
        const other = await memberWithPassword('lain');
        const subject = `rebutan-${suffix}`;
        await link(owner.id, subject);
        const browser = app.browser(host);
        await browser.login(other.email, other.password);
        const callback = await untilCallback(browser, subject, () =>
            browser.post('/api/v1/profile/sso-link', {
                password: other.password,
            }),
        );
        expect(callback.headers.get('location')).toBe(
            `https://${host}/profile?sso_error=already-linked`,
        );
    });

    test('back-channel logout mengakhiri setiap sesi pengguna yang tertaut, dan jti tidak diterima dua kali', async () => {
        const member = await memberWithPassword('keluar');
        const subject = `keluar-${suffix}`;
        await link(member.id, subject);
        const viaSso = app.browser(host);
        await viaSso.get(handoffPath(await untilCallback(viaSso, subject)));
        const viaPassword = app.browser(host);
        await viaPassword.login(member.email, member.password);
        const bystander = app.browser(host);
        await bystander.login(tenant.admin.email, password);
        for (const browser of [viaSso, viaPassword, bystander])
            expect((await browser.get('/api/v1/shell')).status).toBe(200);

        const token = await stub.sign(stub.logoutClaims(subject));
        const logout = await app
            .browser(base)
            .request('POST', '/sso/backchannel-logout', {
                form: { logout_token: token },
            });
        expect(logout.status).toBe(200);
        expect((await viaSso.get('/api/v1/shell')).status).toBe(401);
        expect((await viaPassword.get('/api/v1/shell')).status).toBe(401);
        expect((await bystander.get('/api/v1/shell')).status).toBe(200);

        const replayed = await app
            .browser(base)
            .request('POST', '/sso/backchannel-logout', {
                form: { logout_token: token },
            });
        expect(replayed.status).toBe(400);

        // Login sesudah logout tetap bisa.
        const again = app.browser(host);
        await again.login(member.email, member.password);
        expect((await again.get('/api/v1/shell')).status).toBe(200);
    });

    test('login sesudah back-channel logout tetap berlaku walau jam proses ini tertinggal dari jam database', async () => {
        const member = await memberWithPassword('jam');
        const subject = `jam-${suffix}`;
        await link(member.id, subject);
        const logout = await app
            .browser(base)
            .request('POST', '/sso/backchannel-logout', {
                form: {
                    logout_token: await stub.sign(stub.logoutClaims(subject)),
                },
            });
        expect(logout.status).toBe(200);
        // Jam proses aplikasi dua detik di belakang jam database, seperti dua mesin yang jamnya bergeser.
        setSystemTime(new Date(Date.now() - 2000));
        try {
            const again = app.browser(host);
            await again.login(member.email, member.password);
            expect((await again.get('/api/v1/shell')).status).toBe(200);
        } finally {
            setSystemTime();
        }
    });

    test('logout token tanpa event logout atau dengan nonce ditolak', async () => {
        for (const claims of [
            stub.logoutClaims(`x-${suffix}`, { events: {} }),
            stub.logoutClaims(`x-${suffix}`, { nonce: 'n' }),
            stub.logoutClaims(`x-${suffix}`, { aud: 'klien-lain' }),
        ]) {
            const response = await app
                .browser(base)
                .request('POST', '/sso/backchannel-logout', {
                    form: { logout_token: await stub.sign(claims) },
                });
            expect(response.status).toBe(400);
        }
    });

    test('pengguna dari sync_identities masuk lewat SSO, tetapi tidak dengan kata sandi apa pun', async () => {
        const subject = `tanpa-sandi-${suffix}`;
        const email = `tanpa-sandi-${suffix}@example.com`;
        await syncIdentities(
            settings,
            {
                tenant_id: tenant.tenant.id,
                database,
                identities: [
                    {
                        issuer: stub.issuer,
                        subject,
                        email,
                        name: 'Pengguna Tanpa Sandi',
                        user_id: null,
                    },
                ],
            },
            () => Promise.resolve(),
        );
        for (const attempt of ['', 'apa-saja', password]) {
            const response = await app.browser(host).request('POST', '/login', {
                body: { email, password: attempt },
                headers: { 'sec-fetch-site': 'same-origin' },
            });
            expect(response.status).toBe(422);
        }
        const browser = app.browser(host);
        const done = await browser.get(
            handoffPath(await untilCallback(browser, subject)),
        );
        expect(done.headers.get('location')).toBe('/');
        expect((await browser.get('/api/v1/shell')).status).toBe(200);
        const profile = (await (
            await browser.get('/api/v1/profile')
        ).json()) as {
            has_password: boolean;
        };
        expect(profile.has_password).toBe(false);
    });

    test('domain dasar hanya melayani alamat balik dan back-channel logout', async () => {
        const browser = app.browser(base);
        expect((await browser.get('/api/v1/shell')).status).toBe(404);
        expect((await browser.get('/sso/start')).status).toBe(404);
        expect((await browser.get('/sso/handoff?token=x')).status).toBe(404);
        expect((await browser.get('/sso/backchannel-logout')).status).toBe(404);
        const login = await browser.request('POST', '/login', {
            body: { email: tenant.admin.email, password },
            headers: { 'sec-fetch-site': 'same-origin' },
        });
        expect(login.status).toBe(404);
        // Alamat balik tidak dilayani di alamat lingkungan.
        expect(
            (await app.browser(host).get('/sso/callback?state=x')).status,
        ).toBe(404);
        const options = (await (
            await app.browser(host).get('/api/v1/sso')
        ).json()) as { enabled: boolean };
        expect(options.enabled).toBe(true);
    });

    test('tanpa setelan SSO, /sso/* dijawab 404 dan halaman masuk tidak menawarkannya', async () => {
        const plain = operationsTestApp({ BASE_DOMAIN: base });
        try {
            expect((await plain.browser(host).get('/sso/start')).status).toBe(
                404,
            );
            expect(
                (await plain.browser(base).get('/sso/callback?state=x')).status,
            ).toBe(404);
            expect(
                (
                    await plain
                        .browser(base)
                        .request('POST', '/sso/backchannel-logout', {
                            form: { logout_token: 'x' },
                        })
                ).status,
            ).toBe(404);
            const options = (await (
                await plain.browser(host).get('/api/v1/sso')
            ).json()) as { enabled: boolean };
            expect(options.enabled).toBe(false);
        } finally {
            await plain.close();
        }
    });

    // Anggota tenant dengan kata sandi sendiri, ditulis langsung ke database lingkungan.
    async function memberWithPassword(label: string) {
        const id = Bun.randomUUIDv7();
        const member = {
            id,
            email: `${label}-${id}@example.com`,
            password: `kata-sandi-${label}`,
        };
        await environment.unsafe(
            "insert into users (id, name, email, password, account_type, created_at, updated_at) values ($1, $2, $3, $4, 'person', now(), now())",
            [
                id,
                `Anggota ${label}`,
                member.email,
                await Bun.password.hash(member.password, {
                    algorithm: 'bcrypt',
                    cost: 4,
                }),
            ],
        );
        await environment.unsafe(
            "insert into tenant_memberships (id, tenant_id, user_id, status, created_at, updated_at) values ($1, $2, $3, 'active', now(), now())",
            [Bun.randomUUIDv7(), tenant.tenant.id, id],
        );
        return member;
    }
});
