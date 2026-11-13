import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    operationsTestApp,
    type Browser,
} from '../../../../../test/support/operations-app.ts';
import {
    createMember,
    createTenant,
    entitle,
    recordInstallation,
} from '../../../../../test/support/tenant-fixtures.ts';

type PatientType = {
    id: string;
    max_visits_per_section_per_day: number;
    version: number;
};
const api = '/api/modules/healthcare/v1/patient-types';

// Batas kunjungan per poli per hari pada tipe pasien. Butuh PostgreSQL yang sudah dimigrasi; dilewati bila DB_HOST
// kosong.
describe.skipIf(!process.env.DB_HOST)('patient type visit limit', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let admin: Browser;

    async function json<T>(response: Response, status: number): Promise<T> {
        const text = await response.text();
        if (response.status !== status)
            throw new Error(
                `Expected ${status}, got ${response.status}: ${text}`,
            );
        return JSON.parse(text) as T;
    }

    async function create(code: string, extra: Record<string, unknown> = {}) {
        return (
            await json<{ data: PatientType }>(
                await admin.post(api, { code, name: code, ...extra }),
                201,
            )
        ).data;
    }

    beforeAll(async () => {
        const tenantId = await createTenant(pool, 'Klinik Uji Batas Kunjungan');
        await entitle(pool, tenantId, 'healthcare');
        await recordInstallation(pool, tenantId, 'healthcare');
        const owner = await createMember(pool, tenantId, [
            'healthcare.payment-setup.manage',
        ]);
        admin = browser();
        await admin.login(owner.email, owner.password);
    });

    test('a patient type without a limit is unlimited', async () => {
        expect((await create('UMUM')).max_visits_per_section_per_day).toBe(0);
    });

    test('the limit is saved on create and update, and read back from the list', async () => {
        const created = await create('BPJS', {
            max_visits_per_section_per_day: '1',
        });
        expect(created.max_visits_per_section_per_day).toBe(1);
        const updated = await json<{ data: PatientType }>(
            await admin.patch(`${api}/${created.id}`, {
                code: 'BPJS',
                name: 'BPJS',
                max_visits_per_section_per_day: 2,
                version: created.version,
            }),
            200,
        );
        expect(updated.data.max_visits_per_section_per_day).toBe(2);
        const listed = await json<{ data: PatientType[] }>(
            await admin.get(`${api}?q=BPJS`),
            200,
        );
        expect(listed.data).toEqual([
            expect.objectContaining({
                id: created.id,
                max_visits_per_section_per_day: 2,
            }),
        ]);
    });

    test('a negative, fractional, non-numeric, or blank limit is refused', async () => {
        for (const limit of [-1, 1.5, 'dua', '']) {
            const refused = await json<{ errors: Record<string, string[]> }>(
                await admin.post(api, {
                    code: 'SALAH',
                    name: 'Salah',
                    max_visits_per_section_per_day: limit,
                }),
                422,
            );
            expect(Object.keys(refused.errors)).toEqual([
                'max_visits_per_section_per_day',
            ]);
        }
    });

    test('a limit saved over an older version is refused and leaves the newer one', async () => {
        const created = await create('ASR');
        const body = { code: 'ASR', name: 'ASR', version: created.version };
        await json(
            await admin.patch(`${api}/${created.id}`, {
                ...body,
                max_visits_per_section_per_day: 3,
            }),
            200,
        );
        const stale = await admin.patch(`${api}/${created.id}`, {
            ...body,
            max_visits_per_section_per_day: 5,
        });
        expect(stale.status).toBe(409);
        const [row] = await pool.unsafe<{ visit_limit: number }[]>(
            'select maks_kunjungan_per_poli_per_hari as visit_limit from sim_m_tipe_pasien where id = $1',
            [created.id],
        );
        expect(row?.visit_limit).toBe(3);
    });
});

type PricedPatientType = PatientType & {
    price_group_id: string | null;
    price_group_name: string | null;
};
type PriceGroup = { id: string; version: number };
const priceGroupApi = '/api/v1/pricing/price-groups';

// Kelompok harga Core yang ditunjuk tipe pasien: tersimpan dan terbaca namanya, kelompok nonaktif tidak bisa dipilih
// lagi kecuali oleh tipe yang sudah memegangnya, dan kelompok yang masih dipakai tidak bisa dihapus.
describe.skipIf(!process.env.DB_HOST)('patient type price group', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let admin: Browser;
    let tenantId: string;

    async function json<T>(response: Response, status: number): Promise<T> {
        const text = await response.text();
        if (response.status !== status)
            throw new Error(
                `Expected ${status}, got ${response.status}: ${text}`,
            );
        return JSON.parse(text) as T;
    }

    const priceGroup = async (code: string) =>
        (
            await json<{ data: PriceGroup }>(
                await admin.post(priceGroupApi, { code, name: code }),
                201,
            )
        ).data;

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Klinik Uji Kelompok Harga Tipe');
        await entitle(pool, tenantId, 'healthcare');
        await recordInstallation(pool, tenantId, 'healthcare');
        const owner = await createMember(pool, tenantId, [
            'healthcare.payment-setup.manage',
            'core.pricing-setup.manage',
        ]);
        admin = browser();
        await admin.login(owner.email, owner.password);
    });

    test('two patient types share one price group, and the list shows its name', async () => {
        const group = await priceGroup('LOKAL');
        for (const code of ['LOCAL', 'DOMESTIC'])
            await json(
                await admin.post(api, {
                    code,
                    name: code,
                    price_group_id: group.id,
                }),
                201,
            );
        const listed = await json<{ data: PricedPatientType[] }>(
            await admin.get(api),
            200,
        );
        expect(
            listed.data
                .filter((type) => type.price_group_id === group.id)
                .map((type) => type.price_group_name),
        ).toEqual(['LOKAL', 'LOKAL']);
        const [stored] = await pool.unsafe<{ count: number }[]>(
            'select count(*)::int as count from sim_m_tipe_pasien where tenant_id = $1 and kelompok_harga_id = $2',
            [tenantId, group.id],
        );
        expect(stored?.count).toBe(2);
    });

    test('a patient type saved without a price group keeps none, but an empty choice is refused', async () => {
        const created = await json<{ data: PricedPatientType }>(
            await admin.post(api, { code: 'TANPA', name: 'Tanpa kelompok' }),
            201,
        );
        expect(created.data.price_group_id).toBeNull();
        const refused = await json<{ errors: Record<string, string[]> }>(
            await admin.post(api, {
                code: 'KOSONG',
                name: 'Kosong',
                price_group_id: '',
            }),
            422,
        );
        expect(Object.keys(refused.errors)).toEqual(['price_group_id']);
    });

    test('an inactive price group cannot be chosen again, but a type that holds it keeps it', async () => {
        const group = await priceGroup('LAMA');
        const holder = await json<{ data: PricedPatientType }>(
            await admin.post(api, {
                code: 'PEGANG',
                name: 'Pegang',
                price_group_id: group.id,
            }),
            201,
        );
        await json(
            await admin.patch(`${priceGroupApi}/${group.id}`, {
                code: 'LAMA',
                name: 'LAMA',
                is_active: false,
                version: group.version,
            }),
            200,
        );
        const refused = await json<{ errors: Record<string, string[]> }>(
            await admin.post(api, {
                code: 'BARU',
                name: 'Baru',
                price_group_id: group.id,
            }),
            422,
        );
        expect(Object.keys(refused.errors)).toEqual(['price_group_id']);
        const kept = await json<{ data: PricedPatientType }>(
            await admin.patch(`${api}/${holder.data.id}`, {
                code: 'PEGANG',
                name: 'Pegang lagi',
                price_group_id: group.id,
                version: holder.data.version,
            }),
            200,
        );
        expect(kept.data.price_group_id).toBe(group.id);
        const metadata = await json<{
            price_groups: { id: string; active: boolean }[];
        }>(await admin.get(`${api}/metadata`), 200);
        expect(metadata.price_groups).toContainEqual(
            expect.objectContaining({ id: group.id, active: false }),
        );
    });

    test('a price group of another tenant is refused', async () => {
        const otherTenant = await createTenant(pool, 'Klinik Lain');
        const foreign = Bun.randomUUIDv7();
        await pool.unsafe(
            "insert into kelompok_harga (id, tenant_id, kode, nama, created_at, updated_at) values ($1, $2, 'ASING', 'Asing', now(), now())",
            [foreign, otherTenant],
        );
        const refused = await json<{ errors: Record<string, string[]> }>(
            await admin.post(api, {
                code: 'SALAH',
                name: 'Salah',
                price_group_id: foreign,
            }),
            422,
        );
        expect(Object.keys(refused.errors)).toEqual(['price_group_id']);
    });

    test('a price group still used by a patient type cannot be deleted until the type lets it go', async () => {
        const group = await priceGroup('WNA');
        const type = await json<{ data: PricedPatientType }>(
            await admin.post(api, {
                code: 'WNA',
                name: 'WNA',
                price_group_id: group.id,
            }),
            201,
        );
        const refused = await json<{ errors: Record<string, string[]> }>(
            await admin.delete(`${priceGroupApi}/${group.id}`, {
                version: group.version,
            }),
            422,
        );
        expect(Object.keys(refused.errors)).toEqual(['_form']);
        const [kept] = await pool.unsafe<{ deleted: boolean }[]>(
            'select deleted_at is not null as deleted from kelompok_harga where id = $1',
            [group.id],
        );
        expect(kept?.deleted).toBe(false);
        expect(
            (
                await admin.delete(`${api}/${type.data.id}`, {
                    version: type.data.version,
                })
            ).status,
        ).toBe(204);
        expect(
            (
                await admin.delete(`${priceGroupApi}/${group.id}`, {
                    version: group.version,
                })
            ).status,
        ).toBe(204);
    });
});

type TariffPatientType = PricedPatientType & {
    procedure_tariff: string;
    procedure_tariff_price_group_id: string | null;
    procedure_tariff_price_group_name: string | null;
};

// Cara tipe pasien mendapat tarif jasa dan kelompok harga yang tarif jasanya dicari, pengganti JenisKerjasamaID dan
// remap yang ditulis mati di sistem lama.
describe.skipIf(!process.env.DB_HOST)('patient type procedure tariff', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let admin: Browser;

    async function json<T>(response: Response, status: number): Promise<T> {
        const text = await response.text();
        if (response.status !== status)
            throw new Error(
                `Expected ${status}, got ${response.status}: ${text}`,
            );
        return JSON.parse(text) as T;
    }

    const priceGroup = async (code: string) =>
        (
            await json<{ data: PriceGroup }>(
                await admin.post(priceGroupApi, { code, name: code }),
                201,
            )
        ).data;
    const deactivate = (group: PriceGroup, code: string) =>
        admin.patch(`${priceGroupApi}/${group.id}`, {
            code,
            name: code,
            is_active: false,
            version: group.version,
        });

    beforeAll(async () => {
        const tenantId = await createTenant(pool, 'Klinik Uji Tarif Jasa Tipe');
        await entitle(pool, tenantId, 'healthcare');
        await recordInstallation(pool, tenantId, 'healthcare');
        const owner = await createMember(pool, tenantId, [
            'healthcare.payment-setup.manage',
            'core.pricing-setup.manage',
        ]);
        admin = browser();
        await admin.login(owner.email, owner.password);
    });

    test('a patient type saved without the fields gets the general tariff in its own price group', async () => {
        const created = await json<{ data: TariffPatientType }>(
            await admin.post(api, { code: 'UMUM', name: 'Umum' }),
            201,
        );
        expect(created.data.procedure_tariff).toBe('general');
        expect(created.data.procedure_tariff_price_group_id).toBeNull();
    });

    test('the tariff and its price group are saved and read back with the group name', async () => {
        const general = await priceGroup('TRF-UMUM');
        const own = await priceGroup('TRF-BPJS');
        const created = await json<{ data: TariffPatientType }>(
            await admin.post(api, {
                code: 'BPJS',
                name: 'BPJS',
                price_group_id: own.id,
                procedure_tariff: 'bpjs',
                procedure_tariff_price_group_id: general.id,
            }),
            201,
        );
        expect(created.data.procedure_tariff).toBe('bpjs');
        expect(created.data.procedure_tariff_price_group_name).toBe('TRF-UMUM');
        const [stored] = await pool.unsafe<{ tariff: string; group: string }[]>(
            'select tarif_jasa as tariff, kelompok_harga_tarif_id::text as group from sim_m_tipe_pasien where id = $1',
            [created.data.id],
        );
        expect(stored).toEqual({ tariff: 'bpjs', group: general.id });
        const updated = await json<{ data: TariffPatientType }>(
            await admin.patch(`${api}/${created.data.id}`, {
                code: 'BPJS',
                name: 'BPJS',
                price_group_id: own.id,
                procedure_tariff: 'none',
                procedure_tariff_price_group_id: null,
                version: created.data.version,
            }),
            200,
        );
        expect(updated.data.procedure_tariff).toBe('none');
        expect(updated.data.procedure_tariff_price_group_id).toBeNull();
    });

    test('an unknown tariff and a bad tariff price group are reported on their own fields', async () => {
        const unknownTariff = await json<{ errors: Record<string, string[]> }>(
            await admin.post(api, {
                code: 'SALAH',
                name: 'Salah',
                procedure_tariff: 'iks',
            }),
            422,
        );
        expect(Object.keys(unknownTariff.errors)).toEqual(['procedure_tariff']);
        const both = await json<{ errors: Record<string, string[]> }>(
            await admin.post(api, {
                code: 'SALAH',
                name: 'Salah',
                price_group_id: Bun.randomUUIDv7(),
                procedure_tariff_price_group_id: Bun.randomUUIDv7(),
            }),
            422,
        );
        expect(Object.keys(both.errors).sort()).toEqual([
            'price_group_id',
            'procedure_tariff_price_group_id',
        ]);
    });

    test('an inactive tariff price group stays only with the type that holds it', async () => {
        const group = await priceGroup('TRF-LAMA');
        const holder = await json<{ data: TariffPatientType }>(
            await admin.post(api, {
                code: 'IKS',
                name: 'IKS',
                procedure_tariff_price_group_id: group.id,
            }),
            201,
        );
        await json(await deactivate(group, 'TRF-LAMA'), 200);
        const refused = await json<{ errors: Record<string, string[]> }>(
            await admin.post(api, {
                code: 'IKS2',
                name: 'IKS 2',
                procedure_tariff_price_group_id: group.id,
            }),
            422,
        );
        expect(Object.keys(refused.errors)).toEqual([
            'procedure_tariff_price_group_id',
        ]);
        const kept = await json<{ data: TariffPatientType }>(
            await admin.patch(`${api}/${holder.data.id}`, {
                code: 'IKS',
                name: 'IKS',
                procedure_tariff_price_group_id: group.id,
                version: holder.data.version,
            }),
            200,
        );
        expect(kept.data.procedure_tariff_price_group_id).toBe(group.id);
    });

    test('a price group used only as a tariff price group cannot be deleted', async () => {
        const group = await priceGroup('TRF-PAKAI');
        await json(
            await admin.post(api, {
                code: 'PEMDA',
                name: 'PEMDA',
                procedure_tariff_price_group_id: group.id,
            }),
            201,
        );
        const refused = await json<{ errors: Record<string, string[]> }>(
            await admin.delete(`${priceGroupApi}/${group.id}`, {
                version: group.version,
            }),
            422,
        );
        expect(Object.keys(refused.errors)).toEqual(['_form']);
    });
});
