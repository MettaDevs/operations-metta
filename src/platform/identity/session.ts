import {
    createCipheriv,
    createDecipheriv,
    createHash,
    createHmac,
    randomBytes,
    randomInt,
    timingSafeEqual,
} from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../config/index.ts';
import type { EnvironmentRoute } from '../environment/index.ts';
import type { Database } from '../database/index.ts';
import { abort, HttpFailure, idSchema, validation } from '../http/index.ts';
import { RateLimiter } from './login-limiter.ts';
import type { ValkeySessions } from './valkey-sessions.ts';

const envelopeSchema = z.object({
    iv: z.string(),
    value: z.string(),
    mac: z.string().regex(/^[a-f0-9]{64}$/),
    tag: z.string().optional(),
});
const guardKey =
    'login_web_' +
    createHash('sha1').update('Illuminate\\Auth\\SessionGuard').digest('hex');
const sessionSchema = z
    .object({
        _token: z.string(),
        workspace: z
            .object({
                membership_id: z.string().optional(),
                legal_entity_id: z.string().optional(),
                org_unit_id: z.string().optional(),
                work_date: z.string().optional(),
                work_date_notice_dismissed: z.boolean().optional(),
            })
            .optional(),
    })
    .catchall(z.json());
// Form login memakai noValidate, jadi pesan ini yang tampil saat field dibiarkan kosong.
export const loginInputSchema = z.object({
    email: z.string({ error: 'Isi email.' }).min(1, 'Isi email.'),
    password: z.string({ error: 'Isi kata sandi.' }).min(1, 'Isi kata sandi.'),
});
const userSchema = z.object({
    id: idSchema,
    name: z.string(),
    email: z.string(),
    // Kosong untuk pengguna yang hanya masuk lewat SSO.
    password: z.string().nullable(),
    account_type: z.literal('person'),
    must_change_password: z.boolean(),
    two_factor_secret: z.string().nullable(),
    two_factor_confirmed_at: z.string().nullable(),
    sessions_revoked_epoch: z.number().nullable(),
});
export type SessionUser = z.infer<typeof userSchema>;
// Setiap pembacaan pengguna sesi membawa waktu pencabutan sesinya (back-channel logout) dalam detik epoch.
const userColumns =
    '*,extract(epoch from sessions_revoked_at)::float8 as sessions_revoked_epoch';

export function randomToken(): string {
    return randomBytes(48)
        .toString('base64')
        .replace(/[^A-Za-z0-9]/g, '')
        .slice(0, 40);
}

function equal(left: string, right: string): boolean {
    const first = Buffer.from(left);
    const second = Buffer.from(right);
    return first.length === second.length && timingSafeEqual(first, second);
}

export class CookieCipher {
    constructor(private readonly key: Buffer) {}

    private prefix(name: string): string {
        return (
            createHmac('sha1', this.key)
                .update(name + 'v2')
                .digest('hex') + '|'
        );
    }

    encrypt(name: string, value: string): string {
        const iv = randomBytes(16);
        const cipher = createCipheriv('aes-256-cbc', this.key, iv);
        const encrypted = Buffer.concat([
            cipher.update(this.prefix(name) + value, 'utf8'),
            cipher.final(),
        ]).toString('base64');
        const encodedIv = iv.toString('base64');
        const mac = createHmac('sha256', this.key)
            .update(encodedIv + encrypted)
            .digest('hex');
        return Buffer.from(
            JSON.stringify({ iv: encodedIv, value: encrypted, mac, tag: '' }),
        ).toString('base64');
    }

    decrypt(name: string, value: string): string | null {
        try {
            const parsed = envelopeSchema.safeParse(
                JSON.parse(Buffer.from(value, 'base64').toString('utf8')),
            );
            if (!parsed.success) return null;
            const envelope = parsed.data;
            const expected = createHmac('sha256', this.key)
                .update(envelope.iv + envelope.value)
                .digest('hex');
            if (!equal(expected, envelope.mac)) return null;
            const iv = Buffer.from(envelope.iv, 'base64');
            if (iv.length !== 16 || (envelope.tag ?? '') !== '') return null;
            const decipher = createDecipheriv('aes-256-cbc', this.key, iv);
            const clear = Buffer.concat([
                decipher.update(Buffer.from(envelope.value, 'base64')),
                decipher.final(),
            ]).toString('utf8');
            const prefix = this.prefix(name);
            if (!equal(clear.slice(0, prefix.length), prefix)) return null;
            return clear.slice(prefix.length);
        } catch {
            return null;
        }
    }
}

export class Session {
    readonly responseHeaders: Record<string, string> = {};

    private constructor(
        private readonly db: Database,
        private readonly config: Config,
        private readonly request: Request,
        private readonly clientAddress: string,
        private readonly cipher: CookieCipher,
        private readonly valkey: ValkeySessions | null,
        // Id yang sesinya dimuat dari penyimpanan di request ini, atau null bila sesinya lahir di request ini.
        private readonly storedId: string | null,
        public id: string,
        public data: z.infer<typeof sessionSchema>,
        public user: z.infer<typeof userSchema> | null,
        // Lingkungan yang ditunjuk alamat request, atau null bila alamat tidak dirutekan.
        readonly environment: EnvironmentRoute | null,
    ) {}

    static async open(
        db: Database,
        config: Config,
        request: Request,
        clientAddress: string,
        valkey: ValkeySessions | null,
        environment: EnvironmentRoute | null = null,
    ) {
        const cipher = new CookieCipher(config.key);
        const cookies = new Map(
            (request.headers.get('cookie') ?? '').split(';').map((part) => {
                const position = part.indexOf('=');
                return [
                    part.slice(0, position).trim(),
                    part.slice(position + 1).trim(),
                ];
            }),
        );
        const encoded = cookies.get(config.SESSION_COOKIE);
        let sessionId: string | null = null;
        try {
            if (encoded)
                sessionId = cipher.decrypt(
                    config.SESSION_COOKIE,
                    decodeURIComponent(encoded),
                );
        } catch {
            sessionId = null;
        }
        // Id dari cookie dipakai lagi hanya bila sesinya terbaca. Selain itu sesi baru lahir dengan id baru, supaya
        // id yang sudah dihapus logout tidak pernah dibuat ulang oleh request lain yang masih membawa cookie lamanya.
        let data: z.infer<typeof sessionSchema> = { _token: randomToken() };
        let storedId: string | null = null;
        if (sessionId && /^[A-Za-z0-9]{40}$/.test(sessionId)) {
            const payload = await this.payload(db, config, valkey, sessionId);
            if (payload !== null) {
                try {
                    const parsed = sessionSchema.safeParse(
                        JSON.parse(
                            Buffer.from(payload, 'base64').toString('utf8'),
                        ),
                    );
                    if (parsed.success) {
                        data = parsed.data;
                        storedId = sessionId;
                    }
                } catch {
                    // Payload yang rusak dibaca sebagai sesi baru.
                }
            }
        }
        // Sesi dari sebelum id pengguna menjadi uuid memegang id angka, dan dibaca sebagai belum login.
        const principal = idSchema.safeParse(data[guardKey]);
        let user: z.infer<typeof userSchema> | undefined;
        if (principal.success)
            user = await db.one(
                userSchema,
                `select ${userColumns} from users where id=$1 and account_type='person' limit 1`,
                [principal.data],
            );
        // Sesi yang login sebelum sesi pengguna itu dicabut dibaca sebagai belum login.
        if (user && !Session.loggedInAfterRevocation(data, user)) {
            user = undefined;
            data[guardKey] = null;
        }
        if (user) await db.actor(user.id);
        return new Session(
            db,
            config,
            request,
            clientAddress,
            cipher,
            valkey,
            storedId,
            storedId ?? randomToken(),
            data,
            user ?? null,
            environment,
        );
    }

    private static loggedInAfterRevocation(
        data: z.infer<typeof sessionSchema>,
        user: SessionUser,
    ): boolean {
        if (user.sessions_revoked_epoch === null) return true;
        const loginAt = data.login_at;
        return (
            typeof loginAt === 'number' && loginAt > user.sessions_revoked_epoch
        );
    }

    // Payload sesi yang masih hidup, atau null bila tidak ada atau kedaluwarsa. Di Valkey, TTL kunci
    // menggantikan pemeriksaan last_activity.
    private static async payload(
        db: Database,
        config: Config,
        valkey: ValkeySessions | null,
        id: string,
    ): Promise<string | null> {
        if (valkey) return valkey.read(id);
        const stored = await db.one(
            z.object({ payload: z.string(), last_activity: z.number() }),
            'select payload,last_activity from sessions where id=$1 limit 1',
            [id],
        );
        return stored &&
            stored.last_activity >=
                Math.floor(Date.now() / 1000) - config.SESSION_LIFETIME * 60
            ? stored.payload
            : null;
    }

    requireUser() {
        if (!this.user) abort(401, 'Unauthenticated.');
        if (this.user.must_change_password) {
            abort(423, 'Ganti kata sandi sebelum melanjutkan.');
        }
        return this.user;
    }

    csrf(body: unknown): void {
        if (['GET', 'HEAD', 'OPTIONS'].includes(this.request.method)) return;
        if (this.request.headers.get('sec-fetch-site') === 'same-origin')
            return;
        const parsed = z
            .object({ _token: z.string().optional() })
            .safeParse(body);
        let token = parsed.success ? parsed.data._token : undefined;
        token ||= this.request.headers.get('x-csrf-token') ?? undefined;
        if (!token) {
            const encoded = this.request.headers.get('x-xsrf-token');
            if (encoded)
                token = this.cipher.decrypt('XSRF-TOKEN', encoded) ?? undefined;
        }
        if (!token || !equal(token, this.data._token)) {
            abort(419, 'CSRF token mismatch.');
        }
    }

    async login(input: unknown): Promise<{ two_factor: boolean }> {
        this.csrf(input);
        const result = loginInputSchema.safeParse(input);
        if (!result.success) {
            validation(
                Object.fromEntries(
                    result.error.issues.map((issue) => [
                        issue.path.join('.'),
                        issue.message,
                    ]),
                ),
            );
        }
        const credentials = result.data;
        const email = credentials.email.toLowerCase();
        const { throttleKey, routeKey } = this.loginKeys(email);
        const limiter = new RateLimiter(this.db, this.config.CACHE_PREFIX);
        if (await limiter.tooManyAttempts(routeKey)) {
            const seconds = await limiter.availableIn(routeKey);
            throw new HttpFailure(
                429,
                {
                    message: `Terlalu banyak percobaan masuk. Coba lagi dalam ${seconds} detik.`,
                },
                {
                    'X-RateLimit-Limit': '5',
                    'X-RateLimit-Remaining': '0',
                    'Retry-After': String(seconds),
                    'X-RateLimit-Reset': String(
                        Math.floor(Date.now() / 1000) + seconds,
                    ),
                },
            );
        }
        await limiter.hit(routeKey);
        try {
            return await this.authenticate(
                email,
                credentials.password,
                limiter,
                throttleKey,
            );
        } finally {
            this.responseHeaders['X-RateLimit-Limit'] = '5';
            this.responseHeaders['X-RateLimit-Remaining'] = String(
                await limiter.remaining(routeKey),
            );
        }
    }

    private async authenticate(
        email: string,
        password: string,
        limiter: RateLimiter,
        throttleKey: string,
    ): Promise<{ two_factor: boolean }> {
        const find = () =>
            this.db.one(
                userSchema,
                `select ${userColumns} from users where email=$1 and account_type='person' limit 1`,
                [email],
            );
        // Pengguna tanpa kata sandi (hanya SSO) ditolak dengan pesan yang sama dengan kata sandi salah.
        const matches = async (user: SessionUser | undefined) =>
            user?.password != null &&
            (await Bun.password.verify(password, user.password));
        const first = await find();
        const verified = first && (await matches(first));
        if (!verified) {
            await limiter.hit(throttleKey);
            validation({
                email: 'Email atau kata sandi salah.',
            });
        }
        if (first.two_factor_secret && first.two_factor_confirmed_at) {
            this.data['login.id'] = first.id;
            this.data['login.remember'] = false;
            return { two_factor: true };
        }
        const second = await find();
        if (!second || !(await matches(second))) {
            await limiter.hit(throttleKey);
            validation({
                email: 'Email atau kata sandi salah.',
            });
        }
        await this.signIn(second);
        await limiter.clear(throttleKey);
        return { two_factor: false };
    }

    // Sesi baru untuk pengguna yang sudah dibuktikan, lewat kata sandi atau lewat SSO. Id sesi diganti supaya id sebelum
    // login tidak pernah menjadi sesi yang sudah login.
    private async signIn(user: SessionUser): Promise<void> {
        await this.forget();
        this.id = randomToken();
        this.data[guardKey] = user.id;
        this.data.password_hash_web = user.password;
        this.data._token = randomToken();
        this.user = user;
        // Waktu login dari jam database, jam yang sama dengan users.sessions_revoked_at yang dibandingkan dengannya.
        // Jam proses ini bisa tertinggal dari jam database, dan login sesudah back-channel logout lalu terbaca sebagai
        // login sebelum pencabutan.
        const stamped = await this.db.one(
            z.object({ login_at: z.number() }),
            'update users set last_login_at=current_timestamp,updated_at=current_timestamp where id=$1 returning extract(epoch from current_timestamp)::float8 as login_at',
            [user.id],
        );
        if (stamped) this.data.login_at = stamped.login_at;
        await this.db.actor(user.id);
        this.id = randomToken();
    }

    // Masuk lewat SSO: identitasnya sudah dibuktikan penyedia dan tautannya sudah diperiksa. false bila pengguna itu
    // tidak ada lagi.
    async signInVerified(userId: string): Promise<boolean> {
        const user = await this.db.one(
            userSchema,
            `select ${userColumns} from users where id=$1 and account_type='person' limit 1`,
            [userId],
        );
        if (!user) return false;
        await this.signIn(user);
        return true;
    }

    // Kata sandi pengguna yang sedang masuk diketik ulang, misalnya sebelum menautkan akun SSO.
    // Kunci penghitung percobaan masuk satu email dari alamat ini, sama dengan Fortify.
    private loginKeys(email: string) {
        const throttleKey =
            email.normalize('NFKD').replace(/\p{M}/gu, '') + '|' + this.ip();
        return {
            throttleKey,
            routeKey: createHash('md5')
                .update('login' + throttleKey)
                .digest('hex'),
        };
    }

    // Penyetuju yang mengetik email dan kata sandinya di layar pengguna lain, misalnya batal pembayaran kasir (ListApprove
    // sistem lama). Percobaannya dihitung bersama percobaan masuk email itu dari alamat yang sama, supaya kata sandi
    // tidak bisa ditebak lewat jalur ini. Id penggunanya, atau null bila email atau kata sandinya salah.
    async verifyApprover(
        email: string,
        password: string,
    ): Promise<string | null> {
        const normalized = email.trim().toLowerCase();
        const { routeKey } = this.loginKeys(normalized);
        const limiter = new RateLimiter(this.db, this.config.CACHE_PREFIX);
        if (await limiter.tooManyAttempts(routeKey))
            validation({
                approver_email: `Terlalu banyak percobaan. Coba lagi dalam ${await limiter.availableIn(routeKey)} detik.`,
            });
        const user = await this.db.one(
            userSchema,
            `select ${userColumns} from users where email=$1 and account_type='person' limit 1`,
            [normalized],
        );
        if (
            user?.password != null &&
            (await Bun.password.verify(password, user.password))
        ) {
            await limiter.clear(routeKey);
            return user.id;
        }
        await limiter.hit(routeKey);
        return null;
    }

    async confirmPassword(password: string): Promise<boolean> {
        const user = this.requireUser();
        return (
            user.password !== null &&
            (await Bun.password.verify(password, user.password))
        );
    }

    async logout(input: unknown): Promise<void> {
        this.csrf(input);
        await this.forget();
        this.id = randomToken();
        this.data = { _token: randomToken() };
        this.user = null;
        await this.db.actor(null);
    }

    private ip(): string {
        return this.clientAddress;
    }

    private async forget(): Promise<void> {
        if (this.valkey) await this.valkey.forget(this.id);
        else
            await this.db.execute('delete from sessions where id=$1', [
                this.id,
            ]);
    }

    async save(): Promise<string[]> {
        const payload = Buffer.from(JSON.stringify(this.data)).toString(
            'base64',
        );
        // Sesi yang dimuat dari penyimpanan hanya diperbarui selama masih ada; hanya sesi yang lahir di request ini yang
        // dibuat. Logout atau login di request lain yang menghapusnya lebih dulu menang, dan cookie sesi yang sudah
        // dihapus tidak dikirim ulang, supaya cookie dari logout itu tetap dipegang peramban.
        const existing = this.id === this.storedId;
        const saved = this.valkey
            ? await this.valkey.write(this.id, payload, existing)
            : await this.persist(payload, existing);
        if (!saved) return [];
        // Cookie berawalan __Host- hanya diterima peramban bila Secure.
        const secure =
            this.config.SESSION_SECURE_COOKIE === 'true' ||
            this.config.SESSION_COOKIE.startsWith('__Host-');
        const suffix = `; Path=/; Max-Age=${this.config.SESSION_LIFETIME * 60}; SameSite=Lax${secure ? '; Secure' : ''}`;
        return [
            `XSRF-TOKEN=${encodeURIComponent(this.cipher.encrypt('XSRF-TOKEN', this.data._token))}${suffix}`,
            `${this.config.SESSION_COOKIE}=${encodeURIComponent(this.cipher.encrypt(this.config.SESSION_COOKIE, this.id))}${suffix}; HttpOnly`,
        ];
    }

    // false bila sesi yang dimuat sudah tidak ada di tabel sessions.
    private async persist(
        payload: string,
        existing: boolean,
    ): Promise<boolean> {
        const written = await this.db.execute(
            existing
                ? 'update sessions set user_id=$2,ip_address=$3,user_agent=$4,payload=$5,last_activity=$6 where id=$1'
                : 'insert into sessions(id,user_id,ip_address,user_agent,payload,last_activity) values($1,$2,$3,$4,$5,$6)',
            [
                this.id,
                this.user?.id ?? null,
                this.ip(),
                (this.request.headers.get('user-agent') ?? '').slice(0, 500),
                payload,
                Math.floor(Date.now() / 1000),
            ],
        );
        if (
            randomInt(this.config.SESSION_LOTTERY_OUT_OF) <
            this.config.SESSION_LOTTERY_HITS
        ) {
            await this.db.execute(
                'delete from sessions where last_activity<$1',
                [
                    Math.floor(Date.now() / 1000) -
                        this.config.SESSION_LIFETIME * 60,
                ],
            );
        }
        return written > 0;
    }
}
