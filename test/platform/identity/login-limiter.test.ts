import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import type { Config } from '../../../src/platform/config/index.ts';
import { Database, type Bind } from '../../../src/platform/database/index.ts';
import { HttpFailure } from '../../../src/platform/http/index.ts';
import { Session } from '../../../src/platform/identity/session.ts';

const prefix = 'laravel-cache-';
const ip = '10.0.0.7';
const email = 'user@example.test';
const fortifyKey = email + '|' + ip;
const routeKey = createHash('md5')
    .update('login' + fortifyKey)
    .digest('hex');
const config = {
    key: Buffer.alloc(32, 7),
    SESSION_COOKIE: 'laravel-session',
    SESSION_LIFETIME: 120,
    CACHE_PREFIX: prefix,
} as unknown as Config;

type Row = { key: string; value: string; expiration: number };

async function harness() {
    const cache = new Map<string, Row>();
    const user = {
        id: '019a6b3c-1d2e-7f40-8a5b-6c7d8e9f0a1b',
        name: 'User',
        email,
        password: await Bun.password.hash('secret', {
            algorithm: 'bcrypt',
            cost: 4,
        }),
        account_type: 'person',
        must_change_password: false,
        two_factor_secret: null,
        two_factor_confirmed_at: null,
        sessions_revoked_epoch: null,
    };
    let log: string[] = [];
    const label = (value: Bind | undefined) =>
        typeof value === 'string' && value.startsWith(prefix)
            ? ' ' +
              value
                  .slice(prefix.length)
                  .replace(routeKey, 'Kr')
                  .replace(fortifyKey, 'Kf')
            : '';
    const unsafe = (query: string, parameters: Bind[]) => {
        const [first, second, third] = parameters;
        const keys = [first, second].filter(
            (value) => typeof value === 'string',
        );
        log.push(
            query +
                label(query.startsWith('update cache') ? second : first) +
                (query.includes('in ($1,$2)') ? label(second) : '') +
                (query.includes('set_config') ? ` ${first}` : ''),
        );
        let rows: unknown[] = [];
        let count = 0;
        if (query === 'select * from cache where key in ($1)') {
            rows = cache.has(String(first)) ? [cache.get(String(first))] : [];
        } else if (query.startsWith('select * from cache where key=$1')) {
            rows = cache.has(String(first)) ? [cache.get(String(first))] : [];
        } else if (query.startsWith('delete from cache')) {
            for (const key of keys) {
                const row = cache.get(key);
                if (
                    row &&
                    (third === undefined || row.expiration <= Number(third))
                )
                    count += Number(cache.delete(key));
            }
        } else if (query.endsWith('on conflict do nothing')) {
            if (!cache.has(String(first))) {
                cache.set(String(first), {
                    key: String(first),
                    value: String(second),
                    expiration: Number(third),
                });
                count = 1;
            }
        } else if (query.startsWith('insert into cache')) {
            cache.set(String(first), {
                key: String(first),
                value: String(second),
                expiration: Number(third),
            });
            count = 1;
        } else if (query.startsWith('update cache')) {
            cache.get(String(second))!.value = String(first);
            count = 1;
        } else if (
            query.startsWith(
                'select *,extract(epoch from sessions_revoked_at)::float8 as sessions_revoked_epoch from users',
            )
        ) {
            rows = first === email ? [user] : [];
        }
        return Promise.resolve(Object.assign(rows, { count }));
    };
    const db = new Database(
        { unsafe } as unknown as postgres.ReservedSql,
        undefined,
        'test',
    );
    const attempt = async (password: string) => {
        const session = await Session.open(
            db,
            config,
            new Request('http://localhost/login', {
                method: 'POST',
                headers: { 'sec-fetch-site': 'same-origin' },
            }),
            ip,
            null,
        );
        log = [];
        let status = 200;
        let headers: Record<string, string> = {};
        let body: object = {};
        try {
            await session.login({ email: 'User@Example.test', password });
        } catch (error) {
            if (!(error instanceof HttpFailure)) throw error;
            status = error.status;
            headers = error.headers;
            body = error.body;
        }
        return {
            status,
            body,
            headers: { ...session.responseHeaders, ...headers },
            statements: log,
        };
    };
    return { cache, attempt };
}

const readKr = 'select * from cache where key in ($1) Kr';
const hit = (key: string) => [
    `select * from cache where key in ($1) ${key}:timer`,
    `insert into cache (key,value,expiration) values ($1,$2,$3) on conflict do nothing ${key}:timer`,
    `select * from cache where key in ($1) ${key}`,
    `insert into cache (key,value,expiration) values ($1,$2,$3) on conflict do nothing ${key}`,
    'begin',
    `select * from cache where key=$1 limit 1 for update ${key}`,
    `update cache set value=$1 where key=$2 ${key}`,
    'commit',
];
const findUser =
    "select *,extract(epoch from sessions_revoked_at)::float8 as sessions_revoked_epoch from users where email=$1 and account_type='person' limit 1";

test('failed login hits the route key before and the Fortify key after the credential check', async () => {
    const { cache, attempt } = await harness();
    const first = await attempt('wrong');
    expect(first.status).toBe(422);
    expect(first.body).toEqual({
        message: 'Email atau kata sandi salah.',
        errors: { email: ['Email atau kata sandi salah.'] },
    });
    expect(first.statements).toEqual([
        readKr,
        ...hit('Kr'),
        findUser,
        ...hit('Kf'),
        readKr,
    ]);
    expect(first.headers).toEqual({
        'X-RateLimit-Limit': '5',
        'X-RateLimit-Remaining': '4',
    });
    const values = Object.fromEntries(
        [...cache.values()].map((row) => [row.key, row.value]),
    );
    expect(values[prefix + routeKey]).toBe('i:1;');
    expect(values[prefix + fortifyKey]).toBe('i:1;');
    expect(values[prefix + routeKey + ':timer']).toMatch(/^i:\d{10};$/);
    expect(values[prefix + fortifyKey + ':timer']).toMatch(/^i:\d{10};$/);
    const second = await attempt('wrong');
    expect(second.statements).toEqual([
        readKr,
        'select * from cache where key in ($1) Kr:timer',
        'select * from cache where key in ($1) Kr',
        'begin',
        'select * from cache where key=$1 limit 1 for update Kr',
        'update cache set value=$1 where key=$2 Kr',
        'commit',
        findUser,
        'select * from cache where key in ($1) Kf:timer',
        'select * from cache where key in ($1) Kf',
        'begin',
        'select * from cache where key=$1 limit 1 for update Kf',
        'update cache set value=$1 where key=$2 Kf',
        'commit',
        readKr,
    ]);
    expect(second.headers['X-RateLimit-Remaining']).toBe('3');
});

test('sixth login is throttled with retry headers and no further writes', async () => {
    const { cache, attempt } = await harness();
    for (let index = 0; index < 5; index++) await attempt('wrong');
    const before = JSON.stringify([...cache.entries()]);
    const throttled = await attempt('secret');
    expect(throttled.status).toBe(429);
    expect(throttled.statements).toEqual([
        readKr,
        'select * from cache where key in ($1) Kr:timer',
        'select * from cache where key in ($1) Kr:timer',
    ]);
    const retryAfter = Number(throttled.headers['Retry-After']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(throttled.body).toEqual({
        message: `Terlalu banyak percobaan masuk. Coba lagi dalam ${retryAfter} detik.`,
    });
    expect(throttled.headers['X-RateLimit-Limit']).toBe('5');
    expect(throttled.headers['X-RateLimit-Remaining']).toBe('0');
    expect(
        Number(throttled.headers['X-RateLimit-Reset']) - retryAfter,
    ).toBeCloseTo(Math.floor(Date.now() / 1000), -1);
    expect(JSON.stringify([...cache.entries()])).toBe(before);
});

test('successful login clears the Fortify key with two deletes and keeps the route key', async () => {
    const { cache, attempt } = await harness();
    const success = await attempt('secret');
    expect(success.status).toBe(200);
    expect(success.statements).toEqual([
        readKr,
        ...hit('Kr'),
        findUser,
        findUser,
        'delete from sessions where id=$1',
        'update users set last_login_at=current_timestamp,updated_at=current_timestamp where id=$1 returning extract(epoch from current_timestamp)::float8 as login_at',
        "select set_config('coreerp.user_id', $1, false) 019a6b3c-1d2e-7f40-8a5b-6c7d8e9f0a1b",
        'delete from cache where key in ($1,$2) Kf illuminate:cache:flexible:created:Kf',
        'delete from cache where key in ($1,$2) Kf:timer illuminate:cache:flexible:created:Kf:timer',
        readKr,
    ]);
    expect(success.headers).toEqual({
        'X-RateLimit-Limit': '5',
        'X-RateLimit-Remaining': '4',
    });
    expect([...cache.keys()].sort()).toEqual([
        prefix + routeKey,
        prefix + routeKey + ':timer',
    ]);
});

test('an expired counter is deleted by the read that finds it and counting restarts', async () => {
    const { cache, attempt } = await harness();
    for (const key of [routeKey, routeKey + ':timer'])
        cache.set(prefix + key, {
            key: prefix + key,
            value: 'i:5;',
            expiration: Math.floor(Date.now() / 1000) - 1,
        });
    const result = await attempt('wrong');
    expect(result.status).toBe(422);
    expect(result.statements.slice(0, 4)).toEqual([
        readKr,
        'delete from cache where key in ($1,$2) and expiration<=$3 Kr illuminate:cache:flexible:created:Kr',
        'select * from cache where key in ($1) Kr:timer',
        'delete from cache where key in ($1,$2) and expiration<=$3 Kr:timer illuminate:cache:flexible:created:Kr:timer',
    ]);
    expect(cache.get(prefix + routeKey)?.value).toBe('i:1;');
    expect(result.headers['X-RateLimit-Remaining']).toBe('4');
});
