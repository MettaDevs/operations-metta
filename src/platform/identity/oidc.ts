import { z } from 'zod';
import type { SsoSettings } from '../config/index.ts';

// Klien OpenID Connect untuk masuk lewat SSO: alur kode otorisasi dengan PKCE S256, ID token RS256 yang diverifikasi
// terhadap JWKS penyedia, dan logout token dari back-channel logout. Tidak memakai library JWT; yang diperiksa sama
// dengan klien OIDC control-plane-metta (src/platform/oidc/) dan Core CoreERP.
const clockLeewaySeconds = 60;
export const logoutMaxAgeSeconds = 300;
const backchannelLogoutEvent =
    'http://schemas.openid.net/event/backchannel-logout';

export type SsoFailureReason =
    'provider-unreachable' | 'rejected-by-provider' | 'invalid-token';

export class SsoFailure extends Error {
    constructor(
        readonly reason: SsoFailureReason,
        message: string,
    ) {
        super(message);
    }
}

const discoverySchema = z.object({
    issuer: z.string(),
    authorization_endpoint: z.url(),
    token_endpoint: z.url(),
    jwks_uri: z.url(),
});
type Discovery = z.infer<typeof discoverySchema>;

const jwkSchema = z.looseObject({
    kty: z.string(),
    kid: z.string().optional(),
    n: z.string().optional(),
    e: z.string().optional(),
});
type Jwk = z.infer<typeof jwkSchema>;

const claimsSchema = z.looseObject({
    iss: z.string(),
    sub: z.string().min(1).max(255),
    aud: z.union([z.string(), z.array(z.string())]),
    exp: z.number(),
    iat: z.number().optional(),
    nbf: z.number().optional(),
    nonce: z.string().optional(),
    email: z.string().optional(),
    name: z.string().optional(),
});
export type Claims = z.infer<typeof claimsSchema>;

const decodeJson = (part: string): unknown =>
    JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

export const randomUrlToken = () =>
    Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
        'base64url',
    );

async function pkceChallenge(verifier: string): Promise<string> {
    const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(verifier),
    );
    return Buffer.from(digest).toString('base64url');
}

export class OidcProvider {
    private discovery: Promise<Discovery> | undefined;
    private keys: Promise<Jwk[]> | undefined;

    constructor(readonly settings: SsoSettings) {}

    private async request(url: string, init?: RequestInit): Promise<Response> {
        try {
            return await fetch(url, {
                ...init,
                signal: AbortSignal.timeout(15_000),
            });
        } catch (error) {
            throw new SsoFailure(
                'provider-unreachable',
                `${url} is unreachable: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    private async json(url: string): Promise<unknown> {
        const response = await this.request(url, {
            headers: { accept: 'application/json' },
        });
        if (!response.ok)
            throw new SsoFailure(
                'rejected-by-provider',
                `${url} answered ${response.status}.`,
            );
        return response.json();
    }

    private endpoints(): Promise<Discovery> {
        this.discovery ??= (async () => {
            const url = `${this.settings.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
            const discovery = discoverySchema.parse(await this.json(url));
            if (discovery.issuer !== this.settings.issuer)
                throw new SsoFailure(
                    'invalid-token',
                    `Discovery issuer ${discovery.issuer} differs from the configured ${this.settings.issuer}.`,
                );
            return discovery;
        })().catch((error: unknown) => {
            this.discovery = undefined;
            throw error;
        });
        return this.discovery;
    }

    private signingKeys(refresh: boolean): Promise<Jwk[]> {
        if (refresh || !this.keys)
            this.keys = (async () => {
                const body = z
                    .object({ keys: z.array(jwkSchema) })
                    .parse(await this.json((await this.endpoints()).jwks_uri));
                return body.keys.filter((key) => key.kty === 'RSA');
            })().catch((error: unknown) => {
                this.keys = undefined;
                throw error;
            });
        return this.keys;
    }

    async authorizationUrl(input: {
        redirectUri: string;
        state: string;
        nonce: string;
        verifier: string;
    }): Promise<string> {
        const query = new URLSearchParams({
            response_type: 'code',
            client_id: this.settings.clientId,
            redirect_uri: input.redirectUri,
            scope: 'openid profile email',
            state: input.state,
            nonce: input.nonce,
            code_challenge: await pkceChallenge(input.verifier),
            code_challenge_method: 'S256',
        });
        return `${(await this.endpoints()).authorization_endpoint}?${query.toString()}`;
    }

    // Menukar kode dan memverifikasi ID token-nya. Nonce dibandingkan pemanggil, karena yang disimpan hanya hash-nya.
    async exchangeCode(input: {
        code: string;
        verifier: string;
        redirectUri: string;
        now: number;
    }): Promise<Claims> {
        const credentials = Buffer.from(
            `${encodeURIComponent(this.settings.clientId)}:${encodeURIComponent(this.settings.clientSecret)}`,
        ).toString('base64');
        const response = await this.request(
            (await this.endpoints()).token_endpoint,
            {
                method: 'POST',
                headers: {
                    accept: 'application/json',
                    authorization: `Basic ${credentials}`,
                    'content-type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code: input.code,
                    redirect_uri: input.redirectUri,
                    code_verifier: input.verifier,
                }),
            },
        );
        if (!response.ok)
            throw new SsoFailure(
                'rejected-by-provider',
                `The token endpoint answered ${response.status}.`,
            );
        const body = z
            .object({ id_token: z.string().min(1) })
            .safeParse(await response.json().catch(() => null));
        if (!body.success)
            throw new SsoFailure(
                'invalid-token',
                'The token endpoint answer has no id_token.',
            );
        return this.verify(body.data.id_token, input.now);
    }

    // OpenID Connect Back-Channel Logout 1.0 §2.6. Pemanggil yang menolak jti yang sudah dipakai.
    async verifyLogoutToken(
        token: string,
        now: number,
    ): Promise<Claims & { jti: string; iat: number }> {
        const claims = await this.verify(token, now);
        const events = z
            .record(z.string(), z.unknown())
            .safeParse(claims.events);
        if (!events.success || !(backchannelLogoutEvent in events.data))
            throw new SsoFailure(
                'invalid-token',
                'The logout token has no back-channel logout event.',
            );
        if ('nonce' in claims)
            throw new SsoFailure(
                'invalid-token',
                'A logout token must not carry a nonce.',
            );
        const seconds = Math.floor(now / 1000);
        const { jti, iat } = claims;
        if (
            iat === undefined ||
            iat > seconds + clockLeewaySeconds ||
            iat < seconds - logoutMaxAgeSeconds ||
            typeof jti !== 'string' ||
            jti === '' ||
            jti.length > 255
        )
            throw new SsoFailure(
                'invalid-token',
                'The logout token has no valid iat or jti.',
            );
        return { ...claims, jti, iat };
    }

    private async verify(token: string, now: number): Promise<Claims> {
        const [head, payload, signature, ...rest] = token.split('.');
        if (
            head === undefined ||
            payload === undefined ||
            signature === undefined ||
            rest.length
        )
            throw new SsoFailure('invalid-token', 'The token is not a JWT.');
        let header: { alg?: unknown; kid?: unknown };
        let claims: Claims;
        try {
            header = z
                .object({ alg: z.unknown(), kid: z.unknown() })
                .parse(decodeJson(head));
            claims = claimsSchema.parse(decodeJson(payload));
        } catch {
            throw new SsoFailure('invalid-token', 'The token is malformed.');
        }
        if (header.alg !== 'RS256')
            throw new SsoFailure(
                'invalid-token',
                `The token algorithm ${String(header.alg)} is not RS256.`,
            );
        const pick = (keys: Jwk[]) =>
            typeof header.kid === 'string'
                ? keys.find((key) => key.kid === header.kid)
                : keys.length === 1
                  ? keys[0]
                  : undefined;
        // Kunci yang belum dikenal bisa berarti penyedia baru saja berganti kunci, jadi JWKS diambil ulang sekali.
        const jwk =
            pick(await this.signingKeys(false)) ??
            pick(await this.signingKeys(true));
        if (!jwk)
            throw new SsoFailure(
                'invalid-token',
                'The token was signed with an unknown key.',
            );
        const key = await crypto.subtle.importKey(
            'jwk',
            { kty: 'RSA', n: jwk.n, e: jwk.e },
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
            false,
            ['verify'],
        );
        const valid = await crypto.subtle.verify(
            'RSASSA-PKCS1-v1_5',
            key,
            Buffer.from(signature, 'base64url'),
            new TextEncoder().encode(`${head}.${payload}`),
        );
        if (!valid)
            throw new SsoFailure(
                'invalid-token',
                'The token signature is invalid.',
            );
        const seconds = Math.floor(now / 1000);
        if (claims.iss !== this.settings.issuer)
            throw new SsoFailure(
                'invalid-token',
                `The token iss ${claims.iss} is not the configured provider.`,
            );
        const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
        if (!audiences.includes(this.settings.clientId))
            throw new SsoFailure(
                'invalid-token',
                'The token aud is not this client.',
            );
        if (
            claims.exp <= seconds - clockLeewaySeconds ||
            (claims.nbf !== undefined &&
                claims.nbf > seconds + clockLeewaySeconds)
        )
            throw new SsoFailure(
                'invalid-token',
                'The token is expired or not valid yet.',
            );
        return claims;
    }
}
