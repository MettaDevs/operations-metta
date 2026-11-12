import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    operationsTestApp,
    type Browser,
} from '../../../../../test/support/operations-app.ts';
import {
    createMember,
    createTenant,
    entitle,
    grantAllOrganizations,
    recordInstallation,
} from '../../../../../test/support/tenant-fixtures.ts';

type LifeCycleChoice = {
    id: string;
    code: string;
    name: string;
    cluster_id: string;
    cluster_code: string;
};
type Classification = {
    asks_pregnancy: boolean;
    life_cycle: LifeCycleChoice | null;
    message: string | null;
};
type Visit = {
    id: string;
    pregnant: boolean;
    life_cycle_id: string | null;
    life_cycle_name: string | null;
    cluster_id: string | null;
    cluster_code: string | null;
};

const api = '/api/modules/healthcare/v1';
const undetermined =
    'Siklus hidup pasien tidak dapat ditentukan. Periksa pengaturan Siklus hidup.';

// Tanggal lahir pasien yang berumur `years` tahun lebih `months` bulan tepat pada `today`, dikurangi satu hari bila
// `dayBefore` (ulang tahunnya besok). 29 Februari dipindah ke 28 Februari.
function born(today: string, years: number, months = 0, dayBefore = false) {
    const [year = 0, month = 0, day = 0] = today.split('-').map(Number);
    const total = year * 12 + (month - 1) - years * 12 - months;
    const birthYear = Math.floor(total / 12);
    const birthMonth = (total % 12) + 1;
    const last = new Date(Date.UTC(birthYear, birthMonth, 0)).getUTCDate();
    const date = new Date(
        Date.UTC(birthYear, birthMonth - 1, Math.min(day, last)),
    );
    if (dayBefore) date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
}

// Klaster, siklus hidup, dan status hamil pada pendaftaran kunjungan: hitungan dari aturan Siklus hidup, pilihan
// petugas, saringan section per klaster, daftar per klaster, dan isolasi tenant. Butuh PostgreSQL yang sudah
// dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('visit life cycle and cluster', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let admin: Browser;
    let tenantId: string;
    let today: string;
    let umum: string;
    let mapped: string;
    let open: string;
    let lifeCycles: LifeCycleChoice[];

    async function json<T>(response: Response, status: number): Promise<T> {
        const text = await response.text();
        if (response.status !== status)
            throw new Error(
                `Expected ${status}, got ${response.status}: ${text}`,
            );
        return (text ? JSON.parse(text) : undefined) as T;
    }

    async function created(path: string, body: Record<string, unknown>) {
        return (
            await json<{ data: { id: string; version: number } }>(
                await admin.post(path, body),
                201,
            )
        ).data;
    }

    async function patient(
        gender: string,
        birthDate: string | null,
    ): Promise<string> {
        return (
            await created(`${api}/patients`, {
                name: `Pasien ILP ${gender} ${birthDate ?? 'tanpa tanggal lahir'}`,
                nationality_country_code: 'AU',
                passport_number: `PI${Math.floor(Math.random() * 1e8)}`,
                gender,
                ...(birthDate ? { birth_date: birthDate } : {}),
                phone: '081200000005',
                domicile_address: { street: 'Jl. Klaster No. 2' },
                payment_methods: [{ patient_type_id: umum }],
            })
        ).id;
    }

    async function classify(patientId: string, pregnant = false, as = admin) {
        return json<Classification>(
            await as.get(
                `${api}/visits/classification?patient_id=${patientId}&pregnant=${String(pregnant)}`,
            ),
            200,
        );
    }

    const code = (id: string | undefined) =>
        lifeCycles.find((row) => row.id === id)?.code;

    function register(extra: Record<string, unknown>) {
        return admin.post(`${api}/visits`, {
            patient_type_id: umum,
            visit_condition: 'sakit',
            section_id: open,
            ...extra,
        });
    }

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Puskesmas Uji Klaster');
        await entitle(pool, tenantId, 'healthcare');
        await recordInstallation(pool, tenantId, 'healthcare');
        const owner = await createMember(pool, tenantId, [
            'core.organization.manage',
            'healthcare.patient.manage',
            'healthcare.payment-setup.manage',
            'healthcare.service-setup.manage',
            'healthcare.visit.manage',
        ]);
        await grantAllOrganizations(pool, tenantId, owner.membershipId);
        await pool.unsafe(
            `insert into role_assignment_data_policy_scopes
                     (id, tenant_id, role_assignment_id, policy_code, include_descendants, valid_from, created_at,
                      updated_at)
                 select $1, $2, id, 'healthcare.patient-unit', false, now() - interval '1 day', now(), now()
                 from role_assignments where membership_id = $3`,
            [Bun.randomUUIDv7(), tenantId, owner.membershipId],
        );
        admin = browser();
        await admin.login(owner.email, owner.password);
        await created('/api/v1/organizations', {
            classification: 'legal_entity',
            name: 'PT Puskesmas Uji Klaster',
            company_code: `KK${Date.now() % 100000}`,
            country_code: 'ID',
        });
        const unit = (
            await created('/api/v1/organizations', {
                classification: 'operating_unit',
                name: 'Puskesmas Klaster',
                operating_unit_type: 'department',
                operating_unit_number: 'PKK',
            })
        ).id;
        umum = (
            await created(`${api}/patient-types`, {
                code: 'UMUM',
                name: 'Umum',
            })
        ).id;
        const sectionMetadata = await json<{
            clusters: { id: string; code: string }[];
        }>(await admin.get(`${api}/sections/metadata`), 200);
        const k3 = sectionMetadata.clusters.find((row) => row.code === 'K3');
        mapped = (
            await created(`${api}/sections`, {
                operating_unit_id: unit,
                name: 'Poli Dewasa',
                kind: 'rawat_jalan',
                cluster_ids: [k3?.id],
            })
        ).id;
        open = (
            await created(`${api}/sections`, {
                operating_unit_id: unit,
                name: 'Laboratorium',
                kind: 'penunjang',
            })
        ).id;
        const metadata = await json<{
            date: string;
            life_cycles: LifeCycleChoice[];
            sections: { id: string; cluster_ids: string[] }[];
        }>(await admin.get(`${api}/visits/metadata`), 200);
        today = metadata.date;
        lifeCycles = metadata.life_cycles;
        expect(lifeCycles.map((row) => row.code)).toEqual([
            'IBU',
            'BALITA',
            'ANAK',
            'DEWASA',
            'LANSIA',
        ]);
        expect(
            metadata.sections.find((row) => row.id === mapped)?.cluster_ids,
        ).toEqual([k3!.id]);
        expect(
            metadata.sections.find((row) => row.id === open)?.cluster_ids,
        ).toEqual([]);
    });

    test('age boundaries on the visit date pick the life cycle and its cluster', async () => {
        const cases: [string, string, string][] = [
            [born(today, 6, 11), 'BALITA', 'K2'],
            [born(today, 7, 0, true), 'BALITA', 'K2'],
            [born(today, 7), 'ANAK', 'K2'],
            [born(today, 17), 'ANAK', 'K2'],
            [born(today, 18, 0, true), 'ANAK', 'K2'],
            [born(today, 18), 'DEWASA', 'K3'],
            [born(today, 59), 'DEWASA', 'K3'],
            [born(today, 60), 'LANSIA', 'K3'],
        ];
        for (const [birthDate, expected, cluster] of cases) {
            const result = await classify(await patient('male', birthDate));
            expect([
                birthDate,
                result.life_cycle?.code,
                result.life_cycle?.cluster_code,
                result.asks_pregnancy,
            ]).toEqual([birthDate, expected, cluster, false]);
        }
    });

    test('a pregnant woman is Ibu Hamil in Klaster 2, and the question is never asked for a man', async () => {
        const woman = await patient('female', born(today, 25));
        const notPregnant = await classify(woman);
        expect(notPregnant.asks_pregnancy).toBe(true);
        expect(notPregnant.life_cycle?.code).toBe('DEWASA');
        const pregnant = await classify(woman, true);
        expect(pregnant.life_cycle?.code).toBe('IBU');
        expect(pregnant.life_cycle?.cluster_code).toBe('K2');
        const visit = (
            await json<{ data: Visit }>(
                await register({ patient_id: woman, pregnant: true }),
                201,
            )
        ).data;
        expect([
            visit.pregnant,
            code(visit.life_cycle_id ?? undefined),
            visit.cluster_code,
        ]).toEqual([true, 'IBU', 'K2']);
        expect(visit.life_cycle_name).toBe('Ibu Hamil, Bersalin dan Nifas');

        const man = await patient('male', born(today, 25));
        const male = await classify(man, true);
        expect(male.asks_pregnancy).toBe(false);
        expect(male.life_cycle?.code).toBe('DEWASA');
        const refused = await json<{ errors: Record<string, string[]> }>(
            await register({ patient_id: man, pregnant: true }),
            422,
        );
        expect(refused.errors.pregnant).toEqual([
            'Status hamil tidak berlaku untuk pasien ini.',
        ]);
        const stored = (
            await json<{ data: Visit }>(
                await register({ patient_id: man }),
                201,
            )
        ).data;
        expect([
            stored.pregnant,
            code(stored.life_cycle_id ?? undefined),
            stored.cluster_code,
        ]).toEqual([false, 'DEWASA', 'K3']);
    });

    test('a tie or no matching rule is refused, and the officer cannot pick a life cycle instead', async () => {
        const noBirthDate = await patient('female', null);
        const unknown = await classify(noBirthDate);
        expect(unknown.life_cycle).toBeNull();
        expect(unknown.message).toBe(undetermined);
        expect(
            (
                await json<{ errors: Record<string, string[]> }>(
                    await register({ patient_id: noBirthDate }),
                    422,
                )
            ).errors.life_cycle_id,
        ).toEqual([undetermined]);

        const [cluster] = await pool.unsafe<{ id: string }[]>(
            "select id from sim_m_klaster where tenant_id = $1 and kode = 'K5'",
            [tenantId],
        );
        const [tie] = await pool.unsafe<{ id: string }[]>(
            `insert into sim_m_siklus_hidup (id, tenant_id, klaster_id, kode, nama, umur_min_bulan, umur_maks_bulan,
                                                 prioritas, created_at, updated_at)
                 values ($1, $2, $3, 'GANDA', 'Aturan ganda', 216, 720, 10, now(), now()) returning id`,
            [Bun.randomUUIDv7(), tenantId, cluster!.id],
        );
        const adult = await patient('male', born(today, 30));
        try {
            expect((await classify(adult)).message).toBe(undetermined);
            expect(
                (
                    await json<{ errors: Record<string, string[]> }>(
                        await register({ patient_id: adult }),
                        422,
                    )
                ).errors.life_cycle_id,
            ).toEqual([undetermined]);
            // Klaster dan siklus hidup selalu hasil hitungan: siklus hidup kiriman klien diabaikan.
            const lansia = lifeCycles.find((row) => row.code === 'LANSIA');
            expect(
                (
                    await json<{ errors: Record<string, string[]> }>(
                        await register({
                            patient_id: adult,
                            life_cycle_id: lansia?.id,
                        }),
                        422,
                    )
                ).errors.life_cycle_id,
            ).toEqual([undetermined]);
        } finally {
            await pool.unsafe(
                'update sim_m_siklus_hidup set aktif = false, deleted_at = now() where id = $1',
                [tie!.id],
            );
        }
    });

    test('a section limited to some clusters refuses patients of another cluster', async () => {
        const child = await patient('female', born(today, 4));
        const refused = await json<{ errors: Record<string, string[]> }>(
            await register({ patient_id: child, section_id: mapped }),
            422,
        );
        expect(refused.errors.section_id).toEqual([
            'Poli ini tidak melayani klaster Kesehatan Ibu dan Anak.',
        ]);
        const child2 = (
            await json<{ data: Visit }>(
                await register({ patient_id: child, section_id: open }),
                201,
            )
        ).data;
        expect(code(child2.life_cycle_id ?? undefined)).toBe('BALITA');
        const adult = await patient('male', born(today, 40));
        await json(
            await register({ patient_id: adult, section_id: mapped }),
            201,
        );
        // Klaster yang masih dipilih section tidak bisa dihapus.
        const [k3] = await pool.unsafe<{ id: string; version: number }[]>(
            "select id, version from sim_m_klaster where tenant_id = $1 and kode = 'K3'",
            [tenantId],
        );
        const owner = await createMember(pool, tenantId, [
            'healthcare.clinical-setup.manage',
        ]);
        const setup = browser();
        await setup.login(owner.email, owner.password);
        await json(
            await setup.delete(`${api}/clusters/${k3?.id}`, {
                version: k3?.version,
            }),
            422,
        );
    });

    test('the visit list shows and filters by cluster', async () => {
        const k2 = lifeCycles.find((row) => row.code === 'BALITA')?.cluster_id;
        const listing = await json<{
            data: {
                cluster_id: string | null;
                cluster_code: string | null;
                life_cycle_name: string | null;
            }[];
        }>(await admin.get(`${api}/visits?cluster_id=${k2}`), 200);
        expect(listing.data.length).toBe(2);
        expect(
            listing.data.every(
                (row) => row.cluster_id === k2 && row.cluster_code === 'K2',
            ),
        ).toBe(true);
        expect(listing.data.map((row) => row.life_cycle_name).sort()).toEqual([
            'Balita dan Anak Prasekolah',
            'Ibu Hamil, Bersalin dan Nifas',
        ]);
    });

    test('life cycles and patients of another tenant are not reachable', async () => {
        const otherTenant = await createTenant(pool, 'Puskesmas Lain');
        await entitle(pool, otherTenant, 'healthcare');
        await recordInstallation(pool, otherTenant, 'healthcare');
        const [foreign] = await pool.unsafe<{ id: string }[]>(
            "select id from sim_m_siklus_hidup where tenant_id = $1 and kode = 'DEWASA'",
            [otherTenant],
        );
        expect(foreign).toBeDefined();
        expect(lifeCycles.some((row) => row.id === foreign?.id)).toBe(false);
        const adult = await patient('male', born(today, 35));
        // Siklus hidup tenant lain yang dikirim klien diabaikan; kunjungan tetap memakai aturan tenant ini.
        const visit = (
            await json<{ data: Visit }>(
                await register({
                    patient_id: adult,
                    life_cycle_id: foreign?.id,
                }),
                201,
            )
        ).data;
        expect(visit.life_cycle_id).not.toBe(foreign?.id ?? null);
        const stranger = await createMember(pool, otherTenant, [
            'healthcare.visit.manage',
        ]);
        const session = browser();
        await session.login(stranger.email, stranger.password);
        expect(
            (
                await session.get(
                    `${api}/visits/classification?patient_id=${adult}`,
                )
            ).status,
        ).toBe(422);
    });
});
