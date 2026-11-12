import { createHash, timingSafeEqual } from 'node:crypto';
import type postgres from 'postgres';
import { z } from 'zod';
import type { Config, SsoSettings } from '../config/index.ts';
import type { Database } from '../database/index.ts';
import {
    environmentHost,
    findRoute,
    type EnvironmentRoute,
} from '../environment/index.ts';
import { reportError } from '../error-reporting/index.ts';
import {
    type Claims,
    logoutMaxAgeSeconds,
    OidcProvider,
    randomUrlToken,
    SsoFailure,
} from './oidc.ts';
import { CookieCipher, type Session } from './session.ts';

// Masuk lewat SSO, alur tiga kaki CoreERP (docs/dev/32-sso.md di repo CoreERP):
//   1. GET /sso/start di alamat lingkungan membuat state, nonce, code_verifier, dan rahasia peramban, menyimpan
//      upacaranya di database runtime, memasang cookie upacara, lalu mengarahkan ke penyedia.
//   2. Penyedia kembali ke https://<BASE_DOMAIN>/sso/callback, satu alamat balik untuk semua lingkungan di host ini.
//      Kode ditukar, ID token diverifikasi, identitas (iss + sub) dicari di database lingkungan, lalu peramban dibawa
//      kembali ke alamat lingkungan dengan token serah sekali pakai.
//   3. GET /sso/handoff di alamat lingkungan mencocokkan cookie upacara, mengklaim token dengan satu UPDATE bersyarat,
//      lalu membuka sesi biasa.
// Identitas tidak pernah ditautkan atau dibuat karena emailnya sama. Mode link memakai upacara yang sama dari halaman
// profil, dan kaki ketiganya menulis external_identities untuk pengguna yang sedang masuk.

export type SsoMode = 'login' | 'link';

// Kode tetap untuk halaman masuk dan profil. Halaman itu menerjemahkannya ke kalimat sendiri dan tidak pernah
// mencetak teks dari alamat.
export type SsoErrorCode =
    | 'unlinked'
    | 'no-access'
    | 'expired'
    | 'failed'
    | 'unavailable'
    | 'cancelled'
    | 'already-linked';

const ceremonyCookie = '__Host-sso-ceremony';
const ceremonyMinutes = 10;
const verifierCipherName = 'sso-code-verifier';
const callbackPath = '/sso/callback';

const hash = (value: string) =>
    createHash('sha256').update(value).digest('hex');

function equalText(left: string, right: string): boolean {
    const first = Buffer.from(left);
    const second = Buffer.from(right);
    return first.length === second.length && timingSafeEqual(first, second);
}

function cookieValue(request: Request, name: string): string | null {
    for (const part of (request.headers.get('cookie') ?? '').split(';')) {
        const position = part.indexOf('=');
        if (position > 0 && part.slice(0, position).trim() === name)
            return part.slice(position + 1).trim();
    }
    return null;
}

// Hanya alamat di aplikasi ini, supaya tautan masuk tidak bisa dipakai untuk membawa pengguna ke situs lain.
function safeReturnPath(path: string | null): string | null {
    return path?.startsWith('/') &&
        !path.startsWith('//') &&
        !path.startsWith('/\\') &&
        path.length <= 500
        ? path
        : null;
}

const redirect = (location: string, cookies: string[] = []) => {
    const headers = new Headers({ location });
    for (const cookie of cookies) headers.append('set-cookie', cookie);
    return new Response(null, { status: 302, headers });
};

const plainText = (status: number, text: string) =>
    new Response(text, {
        status,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
    });

const callbackRowSchema = z.object({
    id: z.string(),
    mode: z.enum(['login', 'link']),
    tenant_slug: z.string(),
    environment_kind: z.enum(['production', 'sandbox', 'demo']),
    tenant_id: z.string(),
    nonce_hash: z.string(),
    code_verifier: z.string(),
    redirect_uri: z.string(),
    link_user_id: z.string().nullable(),
});

const handoffRowSchema = z.object({
    mode: z.enum(['login', 'link']),
    user_id: z.string().nullable(),
    link_user_id: z.string().nullable(),
    issuer: z.string().nullable(),
    subject: z.string().nullable(),
    subject_email: z.string().nullable(),
    return_path: z.string().nullable(),
});

export class Sso {
    readonly provider: OidcProvider;
    private readonly cipher: CookieCipher;

    constructor(
        settings: SsoSettings,
        private readonly config: Config,
        // Database runtime: upacara, peta alamat, dan jti logout token.
        private readonly runtime: postgres.Sql,
        // Pool database sebuah lingkungan; null berarti database bersama (runtime).
        private readonly environmentPool: (
            databaseName: string | null,
        ) => postgres.Sql,
    ) {
        this.provider = new OidcProvider(settings);
        this.cipher = new CookieCipher(config.key);
    }

    // Di laptop (BASE_DOMAIN localhost atau *.localhost) skema dan port mengikuti request, supaya
    // http://localhost:<port> bekerja. Di server selalu https tanpa port.
    private origin(host: string, request: Request): string {
        const base = this.config.BASE_DOMAIN;
        if (base !== 'localhost' && !base.endsWith('.localhost'))
            return `https://${host}`;
        const url = new URL(request.url);
        return `${url.protocol}//${host}${url.port ? `:${url.port}` : ''}`;
    }

    private environmentOrigin(
        route: { tenant_slug: string; kind: EnvironmentRoute['kind'] },
        request: Request,
    ): string {
        return this.origin(
            environmentHost(
                route.tenant_slug,
                route.kind,
                this.config.BASE_DOMAIN,
            ),
            request,
        );
    }

    private ceremonyCookie(value: string, maxAge: number): string {
        return `${ceremonyCookie}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
    }

    private log(event: string, details: Record<string, unknown>): void {
        process.stderr.write(JSON.stringify({ event, ...details }) + '\n');
    }

    // Kaki pertama, untuk kedua mode: mencatat upacara dan mengembalikan alamat penyedia beserta cookie upacara.
    async begin(input: {
        mode: SsoMode;
        route: EnvironmentRoute;
        request: Request;
        linkUserId?: string;
        returnPath?: string | null;
    }): Promise<{ location: string; cookie: string }> {
        const state = randomUrlToken();
        const nonce = randomUrlToken();
        const verifier = randomUrlToken();
        const browserSecret = randomUrlToken();
        const redirectUri =
            this.origin(this.config.BASE_DOMAIN, input.request) + callbackPath;
        const location = await this.provider.authorizationUrl({
            redirectUri,
            state,
            nonce,
            verifier,
        });
        await this.runtime.unsafe(
            "delete from sso_attempts where expires_at < now() - interval '1 day'",
            [],
            { prepare: true },
        );
        await this.runtime.unsafe(
            `insert into sso_attempts (id, mode, tenant_slug, environment_kind, tenant_id, state_hash, browser_secret_hash,
                nonce_hash, code_verifier, redirect_uri, return_path, link_user_id, expires_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now() + interval '${ceremonyMinutes} minutes')`,
            [
                Bun.randomUUIDv7(),
                input.mode,
                input.route.tenant_slug,
                input.route.kind,
                input.route.tenant_id,
                hash(state),
                hash(browserSecret),
                hash(nonce),
                this.cipher.encrypt(verifierCipherName, verifier),
                redirectUri,
                safeReturnPath(input.returnPath ?? null),
                input.linkUserId ?? null,
            ],
            { prepare: true },
        );
        return {
            location,
            cookie: this.ceremonyCookie(browserSecret, ceremonyMinutes * 60),
        };
    }

    // GET /sso/start dan GET /sso/handoff di alamat lingkungan. null bila path ini bukan milik SSO.
    async handleEnvironment(
        db: Database,
        session: Session,
        request: Request,
    ): Promise<Response | null> {
        const url = new URL(request.url);
        const route = session.environment;
        if (request.method !== 'GET' || !route) return null;
        switch (url.pathname) {
            case '/sso/start':
                return this.start(route, request, url);
            case '/sso/handoff':
                return this.handoff(db, session, route, request);
            default:
                return null;
        }
    }

    private async start(
        route: EnvironmentRoute,
        request: Request,
        url: URL,
    ): Promise<Response> {
        try {
            const { location, cookie } = await this.begin({
                mode: 'login',
                route,
                request,
                returnPath: url.searchParams.get('redirect'),
            });
            return redirect(location, [cookie]);
        } catch (error) {
            if (!(error instanceof SsoFailure)) throw error;
            this.log('sso-start-failed', {
                reason: error.reason,
                message: error.message,
            });
            return redirect('/login?sso_error=unavailable');
        }
    }

    // Kaki kedua, di domain dasar. Tidak membuka sesi: cookie sesi milik alamat lingkungan.
    async callback(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const state = url.searchParams.get('state');
        // state yang tidak dikenal ditolak sebelum kode ditukar: penukaran menghubungi penyedia dan tidak boleh dipicu
        // tamu. state dipakai sekali.
        const [row] = state
            ? await this.runtime.unsafe(
                  `update sso_attempts set completed_at = now()
                   where state_hash = $1 and completed_at is null and expires_at > now()
                   returning id, mode, tenant_slug, environment_kind, tenant_id, nonce_hash, code_verifier, redirect_uri,
                       link_user_id`,
                  [hash(state)],
                  { prepare: true },
              )
            : [];
        if (!row)
            return plainText(
                400,
                'Permintaan masuk ini tidak dikenal atau sudah kedaluwarsa. Buka lagi alamat ruang kerja Anda dan mulai masuk dari sana.',
            );
        const attempt = callbackRowSchema.parse(row);
        const origin = this.environmentOrigin(
            {
                tenant_slug: attempt.tenant_slug,
                kind: attempt.environment_kind,
            },
            request,
        );
        const fail = (code: SsoErrorCode) =>
            redirect(
                `${origin}${attempt.mode === 'link' ? '/profile' : '/login'}?sso_error=${code}`,
            );
        if (url.searchParams.has('error')) return fail('cancelled');
        const code = url.searchParams.get('code');
        const verifier = this.cipher.decrypt(
            verifierCipherName,
            attempt.code_verifier,
        );
        const route = await findRoute(
            this.runtime,
            attempt.tenant_slug,
            attempt.environment_kind,
        );
        if (
            !code ||
            verifier === null ||
            route?.tenant_id !== attempt.tenant_id
        )
            return fail('failed');
        let claims: Claims;
        try {
            claims = await this.provider.exchangeCode({
                code,
                verifier,
                redirectUri: attempt.redirect_uri,
                now: Date.now(),
            });
        } catch (error) {
            if (!(error instanceof SsoFailure)) throw error;
            this.log('sso-callback-failed', {
                reason: error.reason,
                message: error.message,
            });
            return fail(
                error.reason === 'provider-unreachable'
                    ? 'unavailable'
                    : 'failed',
            );
        }
        // Penyedia hari ini tidak mengembalikan nonce pada alur kode. Ketiadaannya diterima karena PKCE sudah mengikat
        // kode ke upacara ini (RFC 9700 §2.1.1), sama dengan control plane; nonce yang ada wajib sama.
        if (claims.nonce === undefined)
            this.log('sso-nonce-missing', { issuer: claims.iss });
        else if (!equalText(hash(claims.nonce), attempt.nonce_hash))
            return fail('failed');

        const environment = this.environmentPool(route.database_name);
        let userId: string | null = null;
        if (attempt.mode === 'login') {
            const [linked] = await environment.unsafe(
                `select i.user_id, exists (
                        select 1 from tenant_memberships m
                        where m.user_id = i.user_id and m.tenant_id = $3 and m.status = 'active'
                    ) as member
                 from external_identities i join users u on u.id = i.user_id and u.account_type = 'person'
                 where i.issuer = $1 and i.subject = $2 and i.deleted_at is null
                 limit 1`,
                [claims.iss, claims.sub, route.tenant_id],
                { prepare: true },
            );
            const found = z
                .object({ user_id: z.string(), member: z.boolean() })
                .optional()
                .parse(linked);
            if (!found) return fail('unlinked');
            if (!found.member) return fail('no-access');
            userId = found.user_id;
        } else {
            const [linked] = await environment.unsafe(
                'select 1 from external_identities where issuer = $1 and subject = $2 and deleted_at is null limit 1',
                [claims.iss, claims.sub],
                { prepare: true },
            );
            if (linked) return fail('already-linked');
        }
        const token = randomUrlToken();
        await this.runtime.unsafe(
            `update sso_attempts set user_id = $2, issuer = $3, subject = $4, subject_email = $5, handoff_token_hash = $6
             where id = $1`,
            [
                attempt.id,
                userId,
                claims.iss,
                claims.sub,
                claims.email?.slice(0, 255) ?? null,
                hash(token),
            ],
            { prepare: true },
        );
        return redirect(
            `${origin}/sso/handoff?token=${encodeURIComponent(token)}`,
        );
    }

    // Kaki ketiga. Token serah hanya berlaku dari peramban yang memulai upacara, dan hanya sekali: klaimnya satu UPDATE
    // bersyarat, jadi dua tab yang berlomba menghasilkan paling banyak satu sesi.
    private async handoff(
        db: Database,
        session: Session,
        route: EnvironmentRoute,
        request: Request,
    ): Promise<Response> {
        const clear = this.ceremonyCookie('', 0);
        const token = new URL(request.url).searchParams.get('token');
        const secret = cookieValue(request, ceremonyCookie);
        const [row] =
            token && secret
                ? await this.runtime.unsafe(
                      `update sso_attempts set consumed_at = now()
                       where handoff_token_hash = $1 and browser_secret_hash = $2 and consumed_at is null
                         and expires_at > now() and tenant_slug = $3 and environment_kind = $4
                       returning mode, user_id, link_user_id, issuer, subject, subject_email, return_path`,
                      [
                          hash(token),
                          hash(secret),
                          route.tenant_slug,
                          route.kind,
                      ],
                      { prepare: true },
                  )
                : [];
        if (!row) return redirect('/login?sso_error=expired', [clear]);
        const attempt = handoffRowSchema.parse(row);
        switch (attempt.mode) {
            case 'login': {
                if (
                    !attempt.user_id ||
                    !(await session.signInVerified(attempt.user_id))
                )
                    return redirect('/login?sso_error=failed', [clear]);
                return redirect(attempt.return_path ?? '/', [clear]);
            }
            case 'link': {
                // Tautan hanya dipasang untuk pengguna yang memulainya dan masih masuk di peramban ini.
                if (
                    !attempt.link_user_id ||
                    !attempt.issuer ||
                    !attempt.subject ||
                    session.user?.id !== attempt.link_user_id
                )
                    return redirect('/profile?sso_error=failed', [clear]);
                const linked = await linkIdentity(db, {
                    userId: attempt.link_user_id,
                    issuer: attempt.issuer,
                    subject: attempt.subject,
                    email: attempt.subject_email,
                });
                return redirect(
                    linked
                        ? '/profile?sso=linked'
                        : '/profile?sso_error=already-linked',
                    [clear],
                );
            }
            default: {
                const unknown: never = attempt.mode;
                throw new Error(`Mode SSO tidak dikenal: ${String(unknown)}`);
            }
        }
    }

    // POST https://<BASE_DOMAIN>/sso/backchannel-logout dari penyedia. Pengirimnya server, jadi tidak ada CSRF; yang
    // menjaganya tanda tangan logout token. Semua sesi pengguna yang tertaut ke sub itu, di setiap lingkungan host ini,
    // berakhir.
    async backchannelLogout(request: Request): Promise<Response> {
        const invalid = () =>
            Response.json(
                { error: 'invalid_request' },
                { status: 400, headers: { 'cache-control': 'no-store' } },
            );
        const form = new URLSearchParams(await request.text());
        const token = form.get('logout_token');
        if (!token) return invalid();
        let claims;
        try {
            claims = await this.provider.verifyLogoutToken(token, Date.now());
        } catch (error) {
            if (!(error instanceof SsoFailure)) throw error;
            this.log('sso-logout-rejected', {
                reason: error.reason,
                message: error.message,
            });
            return invalid();
        }
        await this.runtime.unsafe(
            'delete from sso_logout_tokens where expires_at < now()',
            [],
            { prepare: true },
        );
        const fresh = await this.runtime.unsafe(
            `insert into sso_logout_tokens (issuer, jti, expires_at)
             values ($1, $2, to_timestamp($3::float8) + interval '${2 * logoutMaxAgeSeconds} seconds')
             on conflict do nothing returning jti`,
            [claims.iss, claims.jti, claims.iat],
            { prepare: true },
        );
        if (!fresh.length) {
            this.log('sso-logout-replayed', { issuer: claims.iss });
            return invalid();
        }
        const databases = z.array(
            z.object({ database_name: z.string().nullable() }),
        );
        const routes = databases.parse(
            await this.runtime.unsafe(
                'select distinct database_name from environment_routes where disabled_at is null',
                [],
                { prepare: true },
            ),
        );
        // Database bersama selalu ikut, walau belum ada alamat yang menunjuknya.
        const targets = new Set<string | null>([
            null,
            ...routes.map((route) => route.database_name),
        ]);
        for (const database of targets) {
            try {
                await this.environmentPool(database).unsafe(
                    `with revoked as (
                        update users set sessions_revoked_at = now()
                        where id in (
                            select user_id from external_identities
                            where issuer = $1 and subject = $2 and deleted_at is null
                        )
                        returning id
                     )
                     delete from sessions where user_id in (select id from revoked)`,
                    [claims.iss, claims.sub],
                    { prepare: true },
                );
            } catch (error) {
                // Satu database yang gagal tidak menghalangi lingkungan lain.
                reportError(error, {
                    method: 'POST',
                    path: '/sso/backchannel-logout',
                });
            }
        }
        return new Response(null, {
            status: 200,
            headers: { 'cache-control': 'no-store' },
        });
    }
}

// Menautkan identitas penyedia ke pengguna. false bila identitas itu atau pengguna itu sudah punya tautan hidup untuk
// penerbit yang sama (indeks unik parsial di external_identities yang menjaganya).
export async function linkIdentity(
    db: Database,
    identity: {
        userId: string;
        issuer: string;
        subject: string;
        email: string | null;
    },
): Promise<boolean> {
    const written = await db.execute(
        `insert into external_identities (id, user_id, issuer, subject, email_at_link, created_at, updated_at)
         values ($1, $2, $3, $4, $5, now(), now())
         on conflict do nothing`,
        [
            Bun.randomUUIDv7(),
            identity.userId,
            identity.issuer,
            identity.subject,
            identity.email,
        ],
    );
    return written > 0;
}
