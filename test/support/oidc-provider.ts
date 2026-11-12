// Penyedia OIDC untuk test: server HTTP sungguhan di port acak dengan kunci RSA sendiri, jadi klien OIDC diuji lewat
// fetch, discovery, JWKS, dan endpoint token yang benar-benar berjalan, bukan lewat fetch yang dipalsukan. Disalin dari
// test/support/oidc-provider.ts di control-plane-metta, tanpa endpoint undangan.
import { createHash } from 'node:crypto';

type Grant = { claims: Record<string, unknown>; challenge: string };

export const backchannelLogoutEvent =
    'http://schemas.openid.net/event/backchannel-logout';

export class OidcStub {
    readonly clientId = 'operations-test-client';
    readonly clientSecret = 'operations-test-secret';
    private readonly grants = new Map<string, Grant>();
    private keys: { kid: string; pair: CryptoKeyPair }[] = [];
    private server!: ReturnType<typeof Bun.serve>;

    // Alamat balik yang didaftarkan klien ini di penyedia; endpoint token menolak alamat lain, seperti penyedia sungguhan.
    private constructor(readonly redirectUri: string) {}

    static async start(redirectUri: string): Promise<OidcStub> {
        const stub = new OidcStub(redirectUri);
        await stub.rotateKey('key-1');
        stub.server = Bun.serve({
            port: 0,
            hostname: '127.0.0.1',
            fetch: (request) => stub.handle(request),
        });
        return stub;
    }

    get issuer(): string {
        return `http://127.0.0.1:${this.server.port}`;
    }

    stop(): void {
        void this.server.stop(true);
    }

    async rotateKey(kid: string): Promise<void> {
        const pair = await crypto.subtle.generateKey(
            {
                name: 'RSASSA-PKCS1-v1_5',
                modulusLength: 2048,
                publicExponent: new Uint8Array([1, 0, 1]),
                hash: 'SHA-256',
            },
            true,
            ['sign', 'verify'],
        );
        this.keys = [{ kid, pair }];
    }

    async sign(claims: Record<string, unknown>): Promise<string> {
        const key = this.keys[0]!;
        const encode = (value: unknown) =>
            Buffer.from(JSON.stringify(value)).toString('base64url');
        const head = encode({ alg: 'RS256', kid: key.kid });
        const body = encode(claims);
        const signature = await crypto.subtle.sign(
            'RSASSA-PKCS1-v1_5',
            key.pair.privateKey,
            new TextEncoder().encode(`${head}.${body}`),
        );
        return `${head}.${body}.${Buffer.from(signature).toString('base64url')}`;
    }

    // Klaim ID token baku untuk klien ini, tanpa nonce seperti penyedia hari ini; yang diberikan menimpanya.
    idClaims(overrides: Record<string, unknown> = {}) {
        const now = Math.floor(Date.now() / 1000);
        return {
            iss: this.issuer,
            aud: this.clientId,
            sub: 'subject-1',
            email: 'pengguna@example.com',
            iat: now,
            exp: now + 300,
            ...overrides,
        };
    }

    // Logout token back-channel untuk sub itu, dengan jti baru.
    logoutClaims(sub: string, overrides: Record<string, unknown> = {}) {
        const now = Math.floor(Date.now() / 1000);
        return {
            iss: this.issuer,
            aud: this.clientId,
            sub,
            iat: now,
            exp: now + 120,
            jti: crypto.randomUUID(),
            events: { [backchannelLogoutEvent]: {} },
            ...overrides,
        };
    }

    // Menerbitkan kode otorisasi untuk authorize URL yang dibuat klien, seperti penyedia sesudah pengguna login.
    grant(authorizeUrl: string, claims: Record<string, unknown>): string {
        const url = new URL(authorizeUrl);
        const code = crypto.randomUUID();
        this.grants.set(code, {
            claims,
            challenge: url.searchParams.get('code_challenge') ?? '',
        });
        return code;
    }

    private async handle(request: Request): Promise<Response> {
        const { pathname } = new URL(request.url);
        if (pathname === '/.well-known/openid-configuration')
            return Response.json({
                issuer: this.issuer,
                authorization_endpoint: `${this.issuer}/authorize`,
                token_endpoint: `${this.issuer}/token`,
                jwks_uri: `${this.issuer}/jwks`,
            });
        if (pathname === '/jwks')
            return Response.json({
                keys: await Promise.all(
                    this.keys.map(async ({ kid, pair }) => ({
                        ...(await crypto.subtle.exportKey(
                            'jwk',
                            pair.publicKey,
                        )),
                        kid,
                        use: 'sig',
                        alg: 'RS256',
                    })),
                ),
            });
        if (pathname === '/token' && request.method === 'POST') {
            const expected = `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`;
            if (request.headers.get('authorization') !== expected)
                return Response.json(
                    { error: 'invalid_client' },
                    { status: 401 },
                );
            const form = new URLSearchParams(await request.text());
            const grant = this.grants.get(form.get('code') ?? '');
            this.grants.delete(form.get('code') ?? '');
            const challenge = createHash('sha256')
                .update(form.get('code_verifier') ?? '')
                .digest('base64url');
            if (
                grant?.challenge !== challenge ||
                form.get('redirect_uri') !== this.redirectUri
            )
                return Response.json(
                    { error: 'invalid_grant' },
                    { status: 400 },
                );
            return Response.json({ id_token: await this.sign(grant.claims) });
        }
        return new Response('Not Found', { status: 404 });
    }
}
