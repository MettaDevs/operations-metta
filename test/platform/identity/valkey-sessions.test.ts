import { expect, spyOn, test } from 'bun:test';
import type { RedisClient } from 'bun';
import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import type { Config } from '../../../src/platform/config/index.ts';
import { Database, type Bind } from '../../../src/platform/database/index.ts';
import { HttpFailure } from '../../../src/platform/http/index.ts';
import {
    CookieCipher,
    randomToken,
    Session,
} from '../../../src/platform/identity/session.ts';
import { ValkeySessions } from '../../../src/platform/identity/valkey-sessions.ts';

const prefix = 'coreerp-session:';
const guardKey =
    'login_web_' +
    createHash('sha1').update('Illuminate\\Auth\\SessionGuard').digest('hex');
const config = {
    key: Buffer.alloc(32, 5),
    SESSION_COOKIE: 'laravel-session',
    SESSION_LIFETIME: 120,
    SESSION_SECURE_COOKIE: 'false',
} as unknown as Config;
const user = {
    id: '019a6b3c-1d2e-7f40-8a5b-6c7d8e9f0a1b',
    name: 'User',
    email: 'user@example.test',
    password: 'hash',
    account_type: 'person',
    must_change_password: false,
    two_factor_secret: null,
    two_factor_confirmed_at: null,
};

function harness(failing = false, principal: string | number = user.id) {
    const store = new Map<string, string>();
    const commands: (string | number)[][] = [];
    const fail = () => Promise.reject(new Error('Connection closed'));
    const client = {
        get: async (key: string) => {
            commands.push(['GET', key]);
            return failing ? fail() : (store.get(key) ?? null);
        },
        set: async (key: string, value: string, mode: string, ttl: number) => {
            commands.push(['SET', key, mode, ttl]);
            if (failing) return fail();
            store.set(key, value);
            return 'OK';
        },
        del: async (key: string) => {
            commands.push(['DEL', key]);
            return failing ? fail() : Number(store.delete(key));
        },
    };
    const statements: string[] = [];
    const unsafe = async (query: string, parameters: Bind[]) => {
        statements.push(query);
        const rows =
            query.startsWith('select * from users') && parameters[0] === user.id
                ? [user]
                : [];
        return Object.assign(rows, { count: rows.length });
    };
    const db = new Database(
        { unsafe } as unknown as postgres.ReservedSql,
        undefined,
        'test',
    );
    const valkey = new ValkeySessions(
        client as unknown as RedisClient,
        prefix,
        7200,
    );
    const id = randomToken();
    store.set(
        prefix + id,
        Buffer.from(
            JSON.stringify({ _token: 'token', [guardKey]: principal }),
        ).toString('base64'),
    );
    const request = new Request('http://localhost/logout', {
        method: 'POST',
        headers: {
            'sec-fetch-site': 'same-origin',
            cookie: `laravel-session=${encodeURIComponent(new CookieCipher(config.key).encrypt('laravel-session', id))}`,
        },
    });
    const open = () => Session.open(db, config, request, '10.0.0.7', valkey);
    return { id, store, commands, statements, open };
}

test('logout deletes the old key and saves the new session with the lifetime TTL, without touching sessions', async () => {
    const { id, store, commands, statements, open } = harness();
    const session = await open();
    expect(session.user?.id).toBe(user.id);
    await session.logout({});
    await session.save();
    expect(session.id).not.toBe(id);
    expect(commands).toEqual([
        ['GET', prefix + id],
        ['DEL', prefix + id],
        ['SET', prefix + session.id, 'EX', 7200],
    ]);
    const saved = JSON.parse(
        Buffer.from(store.get(prefix + session.id)!, 'base64').toString(),
    );
    expect(saved).toEqual({ _token: session.data._token });
    expect(statements.some((query) => query.includes('sessions'))).toBe(false);
});

test('a session saved before user ids became uuid opens logged out without querying users', async () => {
    const { statements, open } = harness(false, 3);
    const session = await open();
    expect(session.user).toBeNull();
    expect(statements).toEqual([]);
});

test('a Valkey failure becomes a 503 instead of falling back to the database', async () => {
    const { statements, open } = harness(true);
    const stderr = spyOn(process.stderr, 'write').mockImplementation(
        () => true,
    );
    try {
        const failure = await open().catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(HttpFailure);
        expect((failure as HttpFailure).status).toBe(503);
        expect(String(stderr.mock.calls[0]?.[0])).toContain(
            'native-valkey-failed',
        );
    } finally {
        stderr.mockRestore();
    }
    expect(statements).toEqual([]);
});
