import type postgres from 'postgres';
import { z } from 'zod';
import { createApplication } from '../src/main.ts';
import type { Config } from '../src/platform/config/index.ts';

// Data contoh laptop developer untuk satu lingkungan: perusahaan dan unit, role, petugas dengan batas datanya, dan
// master layanan kesehatan yang dibutuhkan untuk mencoba layar. Semuanya sintetis dan hanya untuk laptop; ini bukan
// data awal produk.
//
// Organisasi, role, penugasan, tipe pasien, dan penjamin dibuat lewat API yang sama dengan layar, dengan admin pertama
// yang login, sehingga hook dan aturan bisnisnya ikut berjalan (misalnya sequence NRM bawaan per perusahaan dan unit).
// Hanya pengguna dan keanggotaannya yang ditulis lewat SQL, sama dengan admin pertama di provisionEnvironment, karena
// identitas pengguna milik control plane dan repo ini tidak punya API untuk membuatnya.
export const sampleSchema = z.object({
    legal_entities: z.array(
        z.object({
            name: z.string(),
            company_code: z.string(),
            units: z.array(z.object({ name: z.string(), number: z.string() })),
        }),
    ),
    roles: z.array(z.object({ name: z.string(), duties: z.array(z.string()) })),
    // Role tambahan admin pertama, dengan batas data seluruh organisasi untuk kebijakan data yang disebut.
    admin: z.object({ role: z.string(), unrestricted: z.array(z.string()) }),
    staff: z.array(
        z.object({
            name: z.string(),
            email: z.string(),
            password: z.string().min(12),
            role: z.string(),
            // Nomor unit tempat petugas bekerja; batas datanya unit itu di perusahaan pemiliknya.
            unit: z.string(),
            policy: z.string(),
        }),
    ),
    healthcare: z
        .object({
            patient_types: z.array(
                z.object({
                    code: z.string(),
                    name: z.string(),
                    behaviors: z.array(z.string()).default([]),
                    default: z.boolean().default(false),
                }),
            ),
            guarantors: z.array(
                z.object({
                    name: z.string(),
                    patient_type: z.string(),
                    default: z.boolean().default(false),
                }),
            ),
        })
        .optional(),
});
export type Sample = z.infer<typeof sampleSchema>;

const idBody = z.object({ data: z.object({ id: z.string() }) });

// Mengisi data contoh bila lingkungan itu belum punya perusahaan. Lingkungan yang sudah berisi dilewati, jadi aman
// diulang.
export async function seedSample(
    config: Config,
    sql: postgres.Sql,
    options: {
        host: string;
        tenantId: string;
        admin: { email: string; password: string };
        sample: Sample;
    },
): Promise<boolean> {
    const [existing] = await sql<{ found: boolean }[]>`
        select true as found from organizations where tenant_id = ${options.tenantId}
          and classification = 'legal_entity' limit 1`;
    if (existing) return false;
    const application = createApplication(config);
    const cookies = new Map<string, string>();
    async function call(
        method: string,
        path: string,
        body?: unknown,
    ): Promise<unknown> {
        const xsrf = cookies.get('XSRF-TOKEN');
        const response = await application.handle(
            new Request(`http://${options.host}${path}`, {
                method,
                headers: {
                    accept: 'application/json',
                    'sec-fetch-site': 'same-origin',
                    ...(body === undefined
                        ? {}
                        : { 'content-type': 'application/json' }),
                    ...(cookies.size
                        ? {
                              cookie: [...cookies]
                                  .map(([name, value]) => `${name}=${value}`)
                                  .join('; '),
                          }
                        : {}),
                    ...(xsrf
                        ? { 'x-xsrf-token': decodeURIComponent(xsrf) }
                        : {}),
                },
                body: body === undefined ? undefined : JSON.stringify(body),
            }),
            '127.0.0.1',
        );
        for (const cookie of response.headers.getSetCookie()) {
            const [pair = ''] = cookie.split(';');
            const position = pair.indexOf('=');
            cookies.set(pair.slice(0, position), pair.slice(position + 1));
        }
        const text = await response.text();
        if (!response.ok)
            throw new Error(
                `${method} ${path} gagal (${response.status}): ${text}`,
            );
        return text ? JSON.parse(text) : null;
    }
    const created = async (path: string, body: unknown) =>
        idBody.parse(await call('POST', path, body)).data.id;

    try {
        await call('POST', '/login', options.admin);
        const units = new Map<string, { id: string; legalEntity: string }>();
        for (const company of options.sample.legal_entities) {
            const legalEntity = await created('/api/v1/organizations', {
                classification: 'legal_entity',
                name: company.name,
                company_code: company.company_code,
                country_code: 'ID',
            });
            for (const unit of company.units)
                units.set(unit.number, {
                    legalEntity,
                    id: await created('/api/v1/organizations', {
                        classification: 'operating_unit',
                        name: unit.name,
                        operating_unit_type: 'department',
                        operating_unit_number: unit.number,
                    }),
                });
        }
        const roles = new Map<string, string>();
        for (const role of options.sample.roles)
            roles.set(
                role.name,
                await created('/api/v1/roles', {
                    name: role.name,
                    duty_codes: role.duties,
                }),
            );
        const roleId = (name: string) => {
            const id = roles.get(name);
            if (!id) throw new Error(`Role contoh ${name} tidak ada.`);
            return id;
        };
        const assign = async (
            membershipId: string,
            assignments: unknown[],
        ): Promise<void> => {
            const member = z
                .object({ data: z.object({ version: z.number() }) })
                .parse(
                    await call('GET', `/api/v1/memberships/${membershipId}`),
                );
            await call('PATCH', `/api/v1/memberships/${membershipId}`, {
                version: member.data.version,
                assignments,
            });
        };
        const [adminMembership] = await sql<{ id: string }[]>`
            select m.id from tenant_memberships m join users u on u.id = m.user_id
            where m.tenant_id = ${options.tenantId} and u.email = ${options.admin.email}`;
        if (!adminMembership)
            throw new Error('Keanggotaan admin pertama tidak ditemukan.');
        await assign(adminMembership.id, [
            {
                role_id: roleId(options.sample.admin.role),
                policy_scopes: options.sample.admin.unrestricted.map(
                    (policy) => ({
                        policy_code: policy,
                        include_descendants: false,
                        unrestricted: true,
                    }),
                ),
            },
        ]);
        for (const person of options.sample.staff) {
            const unit = units.get(person.unit);
            if (!unit) throw new Error(`Unit contoh ${person.unit} tidak ada.`);
            const userId = Bun.randomUUIDv7();
            const membershipId = Bun.randomUUIDv7();
            const hash = await Bun.password.hash(person.password, {
                algorithm: 'bcrypt',
            });
            await sql.begin(async (transaction) => {
                await transaction.unsafe(
                    "insert into users (id, name, email, password, account_type, created_at, updated_at) values ($1, $2, $3, $4, 'person', now(), now())",
                    [userId, person.name, person.email, hash],
                );
                await transaction.unsafe(
                    "insert into tenant_memberships (id, tenant_id, user_id, status, created_at, updated_at) values ($1, $2, $3, 'active', now(), now())",
                    [membershipId, options.tenantId, userId],
                );
            });
            await assign(membershipId, [
                {
                    role_id: roleId(person.role),
                    policy_scopes: [
                        {
                            policy_code: person.policy,
                            legal_entity_id: unit.legalEntity,
                            organization_id: unit.id,
                            include_descendants: false,
                        },
                    ],
                },
            ]);
        }
        const healthcare = options.sample.healthcare;
        if (healthcare) {
            const api = '/api/modules/healthcare/v1';
            const types = new Map<string, string>();
            for (const type of healthcare.patient_types)
                types.set(
                    type.code,
                    await created(`${api}/patient-types`, {
                        code: type.code,
                        name: type.name,
                        behaviors: type.behaviors,
                        is_default: type.default,
                    }),
                );
            for (const guarantor of healthcare.guarantors)
                await created(`${api}/guarantors`, {
                    name: guarantor.name,
                    patient_type_id: types.get(guarantor.patient_type),
                    is_default: guarantor.default,
                });
        }
    } finally {
        await application.close();
    }
    return true;
}
