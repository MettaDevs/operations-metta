import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import type { Config } from '../src/config.ts';
import { ContextCache, utcInstant } from '../src/context-cache.ts';
import { Database, type Bind } from '../src/db.ts';
import {
    CookieCipher,
    randomToken,
    Session,
    Workspace,
} from '../src/security.ts';

const guardKey =
    'login_web_' +
    createHash('sha1').update('Illuminate\\Auth\\SessionGuard').digest('hex');
const config = {
    key: Buffer.alloc(32, 11),
    SESSION_COOKIE: 'laravel-session',
    SESSION_LIFETIME: 120,
} as unknown as Config;
const user = {
    id: 7,
    name: 'User',
    email: 'user@example.test',
    password: 'hash',
    account_type: 'person',
    must_change_password: false,
    two_factor_secret: null,
    two_factor_confirmed_at: null,
};
const memberships = [
    { id: 'm-1', tenant_id: 't-1' },
    { id: 'm-2', tenant_id: 't-2' },
];
const organizations = [
    {
        id: 'le-1a',
        tenant_id: 't-1',
        name: 'A',
        classification: 'legal_entity',
    },
    {
        id: 'le-1b',
        tenant_id: 't-1',
        name: 'B',
        classification: 'legal_entity',
    },
    {
        id: 'ou-1',
        tenant_id: 't-1',
        name: 'C',
        classification: 'operating_unit',
    },
    { id: 'le-2', tenant_id: 't-2', name: 'D', classification: 'legal_entity' },
    {
        id: 'ou-2',
        tenant_id: 't-2',
        name: 'E',
        classification: 'operating_unit',
    },
];

// Database palsu: setiap query dicatat dengan tiga kata pertamanya, jawabannya bentuk baris yang sama dengan PostgreSQL.
function database(state: { version: string; payloads: Map<string, string> }) {
    const log: string[] = [];
    const unsafe = async (query: string, parameters: Bind[]) => {
        log.push(query.split(' ').slice(0, 3).join(' '));
        const [first, second] = parameters;
        let rows: unknown[];
        if (query.startsWith('select version'))
            rows = [{ version: state.version }];
        else if (query.startsWith('select payload,last_activity'))
            rows = [
                {
                    payload: state.payloads.get(String(first)),
                    last_activity: Math.floor(Date.now() / 1000),
                },
            ];
        else if (query.startsWith('select * from users where id'))
            rows = first === user.id ? [user] : [];
        else if (query.startsWith('select m.id,m.tenant_id'))
            rows = memberships;
        else if (query.startsWith('select id from tenants'))
            rows = parameters.map((id) => ({ id }));
        else if (query.startsWith('select min(t)')) rows = [{ min: null }];
        else if (query.startsWith('select a.role_id'))
            rows = [{ role_id: `role-${first}` }];
        else if (query.startsWith('with recursive'))
            rows = [{ role_id: second }];
        else if (query.startsWith('select distinct p.code'))
            rows = [{ code: 'management-aset.receipt.view' }];
        else if (query.startsWith('select s.policy_code'))
            rows = [
                {
                    policy_code: 'management-aset.asset-responsibility',
                    legal_entity_id: null,
                    organization_id: null,
                    hierarchy_version_id: null,
                    include_descendants: false,
                },
            ];
        else if (query.startsWith('select id,tenant_id,name,classification'))
            rows = organizations.filter((item) => item.tenant_id === first);
        else if (query.startsWith('select set_config')) rows = [];
        else throw new Error('Query tidak dikenal: ' + query);
        return Object.assign(rows, { count: rows.length });
    };
    const db = new Database(
        { unsafe } as unknown as postgres.ReservedSql,
        undefined,
        'test',
    );
    return { db, log };
}

test('a version change clears every entry and the next request reads again', async () => {
    const state = { version: '1', payloads: new Map<string, string>() };
    const { db, log } = database(state);
    const cache = new ContextCache(300);
    let loads = 0;
    const load = async () => ++loads;
    const first = await cache.open(db);
    expect(await first.remember('a', load)).toBe(1);
    expect(await first.remember('b', load)).toBe(2);
    const same = await cache.open(db);
    expect(await same.remember('a', load)).toBe(1);
    expect(await same.remember('b', load)).toBe(2);
    state.version = '2';
    const changed = await cache.open(db);
    expect(await changed.remember('a', load)).toBe(3);
    expect(await changed.remember('b', load)).toBe(4);
    expect(log).toEqual([
        'select version from',
        'select version from',
        'select version from',
    ]);
});

test('a request that saw an older version neither reads nor stores entries of the newer one', async () => {
    const state = { version: '1', payloads: new Map<string, string>() };
    const { db } = database(state);
    const cache = new ContextCache(300);
    let loads = 0;
    const load = async () => ++loads;
    const older = await cache.open(db);
    state.version = '2';
    const newer = await cache.open(db);
    expect(await older.remember('k', load)).toBe(1);
    expect(await newer.remember('k', load)).toBe(2);
    expect(await older.remember('k', load)).toBe(3);
    expect(await newer.remember('k', load)).toBe(2);
});

test('entries expire at the validity boundary or the TTL, whichever comes first', async () => {
    let now = 1_800_000_000_000;
    const state = { version: '1', payloads: new Map<string, string>() };
    const { db } = database(state);
    const cache = new ContextCache(300, () => now);
    const view = await cache.open(db);
    const order: string[] = [];
    let loads = 0;
    const load = async () => {
        order.push('load');
        return ++loads;
    };
    const boundary = async () => {
        order.push('boundary');
        return now + 5_000;
    };
    expect(await view.remember('policy', load, boundary)).toBe(1);
    expect(order).toEqual(['boundary', 'load']);
    now += 4_999;
    expect(await view.remember('policy', load, boundary)).toBe(1);
    now += 1;
    expect(await view.remember('policy', load, boundary)).toBe(2);

    expect(await view.remember('user', load)).toBe(3);
    now += 299_999;
    expect(await view.remember('user', load)).toBe(3);
    now += 1;
    expect(await view.remember('user', load)).toBe(4);
});

test('validity boundaries are read as UTC timestamps', () => {
    expect(utcInstant('2026-11-04 10:15:30')).toBe(
        Date.UTC(2026, 10, 4, 10, 15, 30),
    );
    expect(() => utcInstant('infinity')).toThrow();
});

test('workspace selection is computed per request while the context comes from the cache', async () => {
    const state = { version: '1', payloads: new Map<string, string>() };
    const { db, log } = database(state);
    const cache = new ContextCache(300);
    const cipher = new CookieCipher(config.key);
    const request = async (workspace: Record<string, string>) => {
        const id = randomToken();
        state.payloads.set(
            id,
            Buffer.from(
                JSON.stringify({
                    _token: 'token',
                    [guardKey]: user.id,
                    workspace,
                }),
            ).toString('base64'),
        );
        log.length = 0;
        const session = await Session.open(
            db,
            config,
            new Request('http://localhost/api', {
                headers: {
                    cookie: `laravel-session=${encodeURIComponent(cipher.encrypt('laravel-session', id))}`,
                },
            }),
            '10.0.0.7',
            { valkey: null, contextCache: cache },
        );
        const resolved = await Workspace.resolve(
            db,
            session,
            'management-aset',
        );
        return { resolved, session, statements: [...log] };
    };

    const first = await request({ membership_id: 'm-1' });
    expect(first.resolved.tenantId).toBe('t-1');
    expect(first.resolved.legalEntityId).toBe('le-1a');
    expect(first.resolved.orgUnitId).toBe('ou-1');
    expect(first.statements).toEqual([
        'select payload,last_activity from',
        'select version from',
        'select * from',
        "select set_config('coreerp.user_id', $1,",
        'select m.id,m.tenant_id from',
        'select id from',
        'select min(t) from',
        'select a.role_id from',
        'with recursive reachable(role_id)',
        'select distinct p.code',
        'select min(t) from',
        'select s.policy_code,s.legal_entity_id,s.organization_id,s.hierarchy_version_id,s.include_descendants from',
        'select id,tenant_id,name,classification from',
    ]);

    const second = await request({
        membership_id: 'm-1',
        legal_entity_id: 'le-1b',
    });
    expect(second.resolved.legalEntityId).toBe('le-1b');
    expect(second.session.data.workspace).toEqual({
        membership_id: 'm-1',
        legal_entity_id: 'le-1b',
        org_unit_id: 'ou-1',
    });
    expect(second.statements).toEqual([
        'select payload,last_activity from',
        'select version from',
        "select set_config('coreerp.user_id', $1,",
    ]);

    const third = await request({ membership_id: 'm-2' });
    expect(third.resolved.tenantId).toBe('t-2');
    expect(third.resolved.legalEntityId).toBe('le-2');
    expect(third.statements).not.toContain('select m.id,m.tenant_id from');

    log.length = 0;
    const selected = await Workspace.select(db, second.session, {
        membership_id: 'm-1',
    });
    expect(selected.data.legal_entity_id).toBe('le-1a');
    expect(log).toEqual([]);
});
