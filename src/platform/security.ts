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
import type { Config } from './config.ts';
import { Database } from './db.ts';
import { abort, HttpFailure, validation } from './errors.ts';
import { RateLimiter } from './limiter.ts';
import type { ValkeySessions } from './valkey.ts';

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
const userSchema = z.object({
    id: z.coerce.number().int().positive(),
    name: z.string(),
    email: z.string(),
    password: z.string(),
    account_type: z.literal('person'),
    must_change_password: z.boolean(),
    two_factor_secret: z.string().nullable(),
    two_factor_confirmed_at: z.string().nullable(),
});
const membershipSchema = z.object({ id: z.string(), tenant_id: z.string() });
const organizationSchema = z.object({
    id: z.string(),
    tenant_id: z.string(),
    name: z.string(),
    classification: z.enum(['legal_entity', 'operating_unit']),
});
const scopeSchema = z.object({
    policy_code: z.string(),
    legal_entity_id: z.string().nullable(),
    organization_id: z.string().nullable(),
    hierarchy_version_id: z.string().nullable(),
    include_descendants: z.boolean(),
});
type Membership = z.infer<typeof membershipSchema>;
type Organization = z.infer<typeof organizationSchema>;
type Grant = { legalEntityId: string | null; operatingUnitIds: string[] };
export type Policy = { kind: 'all' } | { kind: 'grants'; grants: Grant[] };

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
        public id: string,
        public data: z.infer<typeof sessionSchema>,
        public user: z.infer<typeof userSchema> | null,
    ) {}

    static async open(
        db: Database,
        config: Config,
        request: Request,
        clientAddress: string,
        valkey: ValkeySessions | null,
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
        let data: z.infer<typeof sessionSchema> = { _token: randomToken() };
        if (sessionId && /^[A-Za-z0-9]{40}$/.test(sessionId)) {
            const payload = await this.payload(db, config, valkey, sessionId);
            if (payload !== null) {
                try {
                    const parsed = sessionSchema.safeParse(
                        JSON.parse(
                            Buffer.from(payload, 'base64').toString('utf8'),
                        ),
                    );
                    if (parsed.success) data = parsed.data;
                } catch {
                    sessionId = null;
                }
            }
        } else sessionId = null;
        const principal = data[guardKey];
        let user: z.infer<typeof userSchema> | undefined;
        if (typeof principal === 'number' || typeof principal === 'string')
            user = await db.one(
                userSchema,
                "select * from users where id=$1 and account_type='person' limit 1",
                [principal],
            );
        if (user) await db.actor(user.id);
        return new Session(
            db,
            config,
            request,
            clientAddress,
            cipher,
            valkey,
            sessionId ?? randomToken(),
            data,
            user ?? null,
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

    async login(input: unknown): Promise<object> {
        this.csrf(input);
        const result = z
            .object({ email: z.string().min(1), password: z.string().min(1) })
            .safeParse(input);
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
        const throttleKey =
            email.normalize('NFKD').replace(/\p{M}/gu, '') + '|' + this.ip();
        const routeKey = createHash('md5')
            .update('login' + throttleKey)
            .digest('hex');
        const limiter = new RateLimiter(this.db, this.config.CACHE_PREFIX);
        if (await limiter.tooManyAttempts(routeKey)) {
            const seconds = await limiter.availableIn(routeKey);
            throw new HttpFailure(
                429,
                { message: 'Too Many Attempts.' },
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
    ): Promise<object> {
        const find = () =>
            this.db.one(
                userSchema,
                "select * from users where email=$1 and account_type='person' limit 1",
                [email],
            );
        const first = await find();
        const verified =
            first && (await Bun.password.verify(password, first.password));
        if (!verified) {
            await limiter.hit(throttleKey);
            validation({
                email: 'These credentials do not match our records.',
            });
        }
        if (first.two_factor_secret && first.two_factor_confirmed_at) {
            this.data['login.id'] = first.id;
            this.data['login.remember'] = false;
            return { two_factor: true };
        }
        const second = await find();
        if (
            !second ||
            !(await Bun.password.verify(password, second.password))
        ) {
            await limiter.hit(throttleKey);
            validation({
                email: 'These credentials do not match our records.',
            });
        }
        await this.forget();
        this.id = randomToken();
        this.data[guardKey] = second.id;
        this.data.password_hash_web = second.password;
        this.data._token = randomToken();
        this.user = second;
        await this.db.execute(
            'update users set last_login_at=current_timestamp,updated_at=current_timestamp where id=$1',
            [second.id],
        );
        await this.db.actor(second.id);
        this.id = randomToken();
        await limiter.clear(throttleKey);
        return { two_factor: false };
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
        if (this.valkey) await this.valkey.write(this.id, payload);
        else await this.persist(payload);
        const suffix = `; Path=/; Max-Age=${this.config.SESSION_LIFETIME * 60}; SameSite=Lax${this.config.SESSION_SECURE_COOKIE === 'true' ? '; Secure' : ''}`;
        return [
            `XSRF-TOKEN=${encodeURIComponent(this.cipher.encrypt('XSRF-TOKEN', this.data._token))}${suffix}`,
            `${this.config.SESSION_COOKIE}=${encodeURIComponent(this.cipher.encrypt(this.config.SESSION_COOKIE, this.id))}${suffix}; HttpOnly`,
        ];
    }

    private async persist(payload: string): Promise<void> {
        await this.db.execute(
            'insert into sessions(id,user_id,ip_address,user_agent,payload,last_activity) values($1,$2,$3,$4,$5,$6) on conflict(id) do update set user_id=excluded.user_id,ip_address=excluded.ip_address,user_agent=excluded.user_agent,payload=excluded.payload,last_activity=excluded.last_activity',
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
    }
}

export class Workspace {
    private constructor(
        readonly tenantId: string,
        readonly membershipId: string,
        readonly userId: number,
        readonly legalEntityId: string | null,
        readonly orgUnitId: string | null,
        readonly permissions: Set<string>,
        readonly policy: Policy,
        readonly moduleId: string,
    ) {}

    private static async memberships(
        db: Database,
        session: Session,
    ): Promise<Membership[]> {
        const user = session.requireUser();
        const memberships = await db.rows(
            membershipSchema,
            "select m.id,m.tenant_id from tenant_memberships m where m.user_id=$1 and m.status='active' order by m.created_at",
            [user.id],
        );
        if (memberships.length) {
            const tenantIds = memberships.map(
                (membership) => membership.tenant_id,
            );
            await db.rows(
                z.object({ id: z.string() }),
                `select id from tenants where id in (${tenantIds.map((_, index) => `$${index + 1}`).join(',')})`,
                tenantIds,
            );
        }
        return memberships;
    }

    private static async policies(
        db: Database,
        membership: Membership,
    ): Promise<Map<string, Policy>> {
        const rows = await db.rows(
            scopeSchema,
            "select s.policy_code,s.legal_entity_id,s.organization_id,s.hierarchy_version_id,s.include_descendants from role_assignment_data_policy_scopes s join role_assignments a on a.id=s.role_assignment_id where s.tenant_id=$1 and a.membership_id=$2 and a.status='active' and a.valid_from<=current_timestamp and (a.valid_until is null or a.valid_until>current_timestamp) and s.valid_from<=current_timestamp and (s.valid_until is null or s.valid_until>current_timestamp)",
            [membership.tenant_id, membership.id],
        );
        const grouped = Map.groupBy(rows, (row) => row.policy_code);
        const policies = new Map<string, Policy>();
        for (const [code, scopes] of grouped) {
            if (
                scopes.some(
                    (scope) =>
                        scope.legal_entity_id === null &&
                        scope.organization_id === null,
                )
            ) {
                policies.set(code, { kind: 'all' });
                continue;
            }
            const grants: Grant[] = [];
            for (const scope of scopes) {
                const ids =
                    scope.organization_id === null
                        ? []
                        : [scope.organization_id];
                if (scope.include_descendants) {
                    ids.push(
                        ...(
                            await db.rows(
                                z.object({ id: z.string() }),
                                'select descendant_organization_id as id from organization_hierarchy_closures where version_id=$1 and ancestor_organization_id=$2',
                                [
                                    scope.hierarchy_version_id,
                                    scope.organization_id,
                                ],
                            )
                        ).map((row) => row.id),
                    );
                }
                const units = ids.length
                    ? (
                          await db.rows(
                              z.object({ id: z.string() }),
                              `select id from organizations where tenant_id=$1 and classification='operating_unit' and id in (${ids.map((_, index) => `$${index + 2}`).join(',')})`,
                              [membership.tenant_id, ...ids],
                          )
                      ).map((row) => row.id)
                    : [];
                if (scope.legal_entity_id !== null || units.length)
                    grants.push({
                        legalEntityId: scope.legal_entity_id,
                        operatingUnitIds: units,
                    });
            }
            policies.set(code, { kind: 'grants', grants });
        }
        return policies;
    }

    private static async organizations(
        db: Database,
        membership: Membership,
        policies: Map<string, Policy>,
    ): Promise<Organization[]> {
        const all = [...policies.values()].some(
            (policy) => policy.kind === 'all',
        );
        const ids = [
            ...new Set(
                [...policies.values()].flatMap((policy) =>
                    policy.kind === 'all'
                        ? []
                        : policy.grants.flatMap((grant) => [
                              ...(grant.legalEntityId
                                  ? [grant.legalEntityId]
                                  : []),
                              ...grant.operatingUnitIds,
                          ]),
                ),
            ),
        ];
        if (!all && !ids.length) return [];
        const scoped = all ? null : ids;
        return db.rows(
            organizationSchema,
            `select id,tenant_id,name,classification from organizations where tenant_id=$1 and status='active' ${scoped ? `and id in (${scoped.map((_, index) => `$${index + 2}`).join(',')})` : ''} order by name`,
            [membership.tenant_id, ...(scoped ?? [])],
        );
    }

    private static async permissions(
        db: Database,
        membership: Membership,
        moduleId: string,
    ): Promise<Set<string>> {
        const assigned = await db.rows(
            z.object({ role_id: z.string() }),
            "select a.role_id from role_assignments a join roles r on r.id=a.role_id where a.membership_id=$1 and a.status='active' and r.is_active=true and a.valid_from<=current_timestamp and (a.valid_until is null or a.valid_until>current_timestamp)",
            [membership.id],
        );
        const effective = assigned.length
            ? await db.rows(
                  z.object({ role_id: z.string() }),
                  `with recursive reachable(role_id) as (select r.id from roles r where r.tenant_id=$1 and r.is_active=true and r.id in (${assigned.map((_, index) => `$${index + 2}`).join(',')}) union select link.child_role_id from security_role_children link join reachable on reachable.role_id=link.parent_role_id join roles child on child.id=link.child_role_id and child.is_active=true where link.tenant_id=$1) select role_id from reachable`,
                  [membership.tenant_id, ...assigned.map((row) => row.role_id)],
              )
            : [];
        const permissionRows = effective.length
            ? await db.rows(
                  z.object({ code: z.string() }),
                  `select distinct p.code from security_role_duties rd join security_duty_privileges dp on dp.duty_code=rd.duty_code join security_privilege_permissions pp on pp.privilege_code=dp.privilege_code join permissions p on p.code=pp.permission_code where p.app_id=$1 and rd.role_id in (${effective.map((_, index) => `$${index + 2}`).join(',')}) order by p.code`,
                  [moduleId, ...effective.map((row) => row.role_id)],
              )
            : [];
        return new Set(permissionRows.map((row) => row.code));
    }

    static async select(db: Database, session: Session, input: unknown) {
        const parsed = z
            .object({
                membership_id: z.string(),
                legal_entity_id: z.string().nullable().optional(),
                org_unit_id: z.string().nullable().optional(),
            })
            .safeParse(input);
        if (!parsed.success)
            validation({
                membership_id: 'The membership id field is required.',
            });
        const requested = parsed.data;
        const membership = (await this.memberships(db, session)).find(
            (item) => item.id === requested.membership_id,
        );
        if (!membership)
            validation({
                membership_id: 'Tenant tidak tersedia untuk identity ini.',
            });
        const policies = await this.policies(db, membership);
        const organizations = await this.organizations(
            db,
            membership,
            policies,
        );
        const pick = (
            id: string | null | undefined,
            classification: string,
            field: string,
        ) => {
            const eligible = organizations.filter(
                (item) => item.classification === classification,
            );
            const selected = id
                ? eligible.find((item) => item.id === id)
                : eligible[0];
            if (id && !selected)
                validation({
                    [field]:
                        'Organisasi tidak tersedia dalam scope akses Anda.',
                });
            return selected?.id ?? null;
        };
        const legalEntityId = pick(
            requested.legal_entity_id,
            'legal_entity',
            'legal_entity_id',
        );
        const orgUnitId = pick(
            requested.org_unit_id,
            'operating_unit',
            'org_unit_id',
        );
        session.data.workspace = {
            membership_id: membership.id,
            ...(legalEntityId ? { legal_entity_id: legalEntityId } : {}),
            ...(orgUnitId ? { org_unit_id: orgUnitId } : {}),
        };
        return {
            data: {
                membership_id: membership.id,
                tenant_id: membership.tenant_id,
                legal_entity_id: legalEntityId,
                org_unit_id: orgUnitId,
            },
        };
    }

    static async resolve(
        db: Database,
        session: Session,
        moduleId: string,
        policyCode: string,
    ): Promise<Workspace> {
        const user = session.requireUser();
        const memberships = await this.memberships(db, session);
        const membership =
            memberships.find(
                (item) => item.id === session.data.workspace?.membership_id,
            ) ?? memberships[0];
        if (!membership) {
            delete session.data.workspace;
            abort(403, 'Tidak ada tenant aktif untuk permintaan ini.');
        }
        const permissions = await this.permissions(db, membership, moduleId);
        if (!permissions.size) abort(403, 'Tidak ada izin untuk module ini.');
        const policies = await this.policies(db, membership);
        const organizations = await this.organizations(
            db,
            membership,
            policies,
        );
        const selected = session.data.workspace;
        const companies = organizations.filter(
            (item) => item.classification === 'legal_entity',
        );
        const units = organizations.filter(
            (item) => item.classification === 'operating_unit',
        );
        const company =
            companies.find((item) => item.id === selected?.legal_entity_id) ??
            companies[0];
        const unit =
            units.find((item) => item.id === selected?.org_unit_id) ?? units[0];
        session.data.workspace = {
            ...selected,
            membership_id: membership.id,
            ...(company ? { legal_entity_id: company.id } : {}),
            ...(unit ? { org_unit_id: unit.id } : {}),
        };
        return new Workspace(
            membership.tenant_id,
            membership.id,
            user.id,
            company?.id ?? null,
            unit?.id ?? null,
            permissions,
            policies.get(policyCode) ?? {
                kind: 'grants',
                grants: [],
            },
            moduleId,
        );
    }

    guard(resource: string, action: string): void {
        if (!this.permissions.has(`${this.moduleId}.${resource}.${action}`))
            abort(403, 'Tidak diizinkan.');
    }

    allows(legalEntityId: string, orgUnitId: string | null): boolean {
        if (legalEntityId !== this.legalEntityId) return false;
        return (
            this.policy.kind === 'all' ||
            this.policy.grants.some(
                (grant) =>
                    grant.legalEntityId === legalEntityId &&
                    orgUnitId !== null &&
                    grant.operatingUnitIds.includes(orgUnitId),
            )
        );
    }

    require(legalEntityId: string, orgUnitId: string | null): void {
        if (!this.legalEntityId)
            validation({
                legal_entity_id:
                    'Pilih perusahaan di tempat kerja sebelum melanjutkan.',
            });
        if (legalEntityId !== this.legalEntityId)
            validation({
                legal_entity_id:
                    'Perusahaan transaksi harus sama dengan perusahaan aktif. Ganti tempat kerja terlebih dahulu.',
            });
        if (!this.allows(legalEntityId, orgUnitId))
            abort(
                403,
                'Data ini berada di luar unit kerja yang dapat Anda akses.',
            );
    }

    filter(
        alias: string,
        start: number,
    ): { clause: string; bindings: (string | null)[] } {
        const bindings: (string | null)[] = [this.tenantId, this.legalEntityId];
        const base = `${alias}.tenant_id=$${start} and ${alias}.legal_entity_id=$${start + 1}`;
        if (this.policy.kind === 'all') return { clause: base, bindings };
        const clauses: string[] = [];
        for (const grant of this.policy.grants) {
            if (!grant.legalEntityId || !grant.operatingUnitIds.length)
                continue;
            const companyPosition = start + bindings.length;
            bindings.push(grant.legalEntityId);
            const unitPositions = grant.operatingUnitIds.map((id) => {
                const position = start + bindings.length;
                bindings.push(id);
                return `$${position}`;
            });
            clauses.push(
                `(${alias}.legal_entity_id=$${companyPosition} and ${alias}.responsible_org_unit_id in (${unitPositions.join(',')}))`,
            );
        }
        return {
            clause: `${base} and (${clauses.join(' or ') || 'false'})`,
            bindings,
        };
    }
}
