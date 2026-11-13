import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { operationsTestApp } from '../../../../../test/support/operations-app.ts';
import {
    createMember,
    grantAllOrganizations,
} from '../../../../../test/support/tenant-fixtures.ts';
import {
    api,
    createPharmacy,
    json,
    pharmacyDuties,
    refused,
    type Pharmacy,
} from '../../support/pharmacy-fixture.ts';

type Reference = { id: string; code: string; name: string };
type GradingGroup = {
    id: string;
    name: string;
    is_active: boolean;
    version: number;
};
type DrugPrice = {
    id: string;
    price_group: Reference;
    grading_group: { id: string; name: string } | null;
    ktp_patient: boolean;
    price_from: string;
    price_to: string;
    markup_percent: string;
    discount_percent: string;
    effective_from: string;
    version: number;
};

// Kelompok grading dan grading harga obat: nama kelompok unik per legal entity, rentang yang bertumpuk pada kelompok
// harga, kelompok grading, Patient KTP, dan tanggal berlaku yang sama ditolak, kelompok harga Core dan kelompok grading tidak bisa
// dihapus selama dipakai, dan data obat farmasi memegang kelompok gradingnya. Butuh PostgreSQL yang sudah dimigrasi;
// dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('grading groups and drug prices', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let pharmacy: Pharmacy;
    let umum: Reference;
    let injeksi: GradingGroup;

    const group = (name: string, body: Record<string, unknown> = {}) =>
        pharmacy.created<GradingGroup>(`${api}/grading-groups`, {
            name,
            ...body,
        });
    const grading = (body: Record<string, unknown>) =>
        pharmacy.admin.post(`${api}/drug-prices`, {
            price_group_id: umum.id,
            grading_group_id: injeksi.id,
            price_from: 0,
            price_to: 1000000000,
            markup_percent: 50,
            effective_from: '2026-01-01',
            ...body,
        });
    const created = async (body: Record<string, unknown>) =>
        (await json<{ data: DrugPrice }>(await grading(body), 201)).data;

    beforeAll(async () => {
        pharmacy = await createPharmacy(pool, browser, 'Farmasi Uji Grading', {
            duties: [...pharmacyDuties, 'core.pricing-setup.manage'],
        });
        umum = await pharmacy.created('/api/v1/pricing/price-groups', {
            code: 'UMUM',
            name: 'Umum',
        });
        injeksi = await group('INJEKSI');
    });

    test('a grading group name is unique per legal entity regardless of case, and inactive groups leave the active list', async () => {
        expect(
            Object.keys(
                await refused(
                    await pharmacy.admin.post(`${api}/grading-groups`, {
                        name: ' injeksi ',
                    }),
                ),
            ),
        ).toEqual(['name']);
        const old = await group('LAMA', { is_active: false });
        const active = await json<{ data: GradingGroup[] }>(
            await pharmacy.admin.get(`${api}/grading-groups?active=1`),
            200,
        );
        expect(active.data.map((row) => row.name)).toContain('INJEKSI');
        expect(active.data.map((row) => row.id)).not.toContain(old.id);
    });

    test('a grading row lists its price group and grading group by name, and an all-items row has none', async () => {
        const forGroup = await created({
            discount_percent: '2.5',
            effective_from: '2026-02-01',
        });
        const forAll = await created({
            grading_group_id: null,
            markup_percent: '10',
            effective_from: '2026-02-01',
        });
        expect(forGroup).toMatchObject({
            price_group: { id: umum.id, code: 'UMUM', name: 'Umum' },
            grading_group: { id: injeksi.id, name: 'INJEKSI' },
            price_from: '0',
            price_to: '1000000000',
            markup_percent: '50',
            discount_percent: '2.5',
            effective_from: '2026-02-01',
        });
        expect(forAll.grading_group).toBeNull();
        expect(forAll.discount_percent).toBe('0');
        const listed = await json<{ data: DrugPrice[] }>(
            await pharmacy.admin.get(`${api}/drug-prices?q=INJEKSI`),
            200,
        );
        expect(listed.data.map((row) => row.id)).toContain(forGroup.id);
    });

    test('a range overlapping another row with the same price group, grading group, and date is refused, bounds included', async () => {
        await created({
            price_from: 1000,
            price_to: 5000,
            effective_from: '2026-03-01',
        });
        for (const range of [
            { price_from: 5000, price_to: 9000 },
            { price_from: 0, price_to: 1000 },
            { price_from: 2000, price_to: 3000 },
        ])
            expect(
                Object.keys(
                    await refused(
                        await grading({
                            ...range,
                            effective_from: '2026-03-01',
                        }),
                    ),
                ),
            ).toEqual(['price_from']);
        await created({
            price_from: '5000.0001',
            price_to: 9000,
            effective_from: '2026-03-01',
        });
        await created({
            price_from: 1000,
            price_to: 5000,
            effective_from: '2026-04-01',
        });
        await created({
            grading_group_id: null,
            price_from: 1000,
            price_to: 5000,
            effective_from: '2026-03-01',
        });
        expect(
            Object.keys(
                await refused(
                    await grading({
                        grading_group_id: null,
                        price_from: 4000,
                        price_to: 4000,
                        effective_from: '2026-03-01',
                    }),
                ),
            ),
        ).toEqual(['price_from']);
        const [count] = await pool.unsafe<{ count: number }[]>(
            `select count(*)::int as count from far_m_grading_harga
             where tenant_id = $1 and berlaku_mulai = '2026-03-01' and deleted_at is null`,
            [pharmacy.tenantId],
        );
        expect(count?.count).toBe(3);
    });

    test('Patient KTP is part of the key: a row is for KTP patients by default, the same range is allowed once per KTP value, and a change that does not send it keeps it', async () => {
        const range = {
            price_from: 1000,
            price_to: 5000,
            effective_from: '2026-05-01',
        };
        const ktp = await created(range);
        expect(ktp.ktp_patient).toBe(true);
        const withoutKtp = await created({
            ...range,
            ktp_patient: false,
            markup_percent: 60,
        });
        expect(withoutKtp.ktp_patient).toBe(false);
        expect(
            Object.keys(
                await refused(
                    await grading({
                        ...range,
                        price_from: 2000,
                        price_to: 3000,
                        ktp_patient: false,
                    }),
                ),
            ),
        ).toEqual(['price_from']);
        const changed = await json<{ data: DrugPrice }>(
            await pharmacy.admin.patch(`${api}/drug-prices/${withoutKtp.id}`, {
                price_group_id: umum.id,
                grading_group_id: injeksi.id,
                ...range,
                markup_percent: 65,
                version: withoutKtp.version,
            }),
            200,
        );
        expect(changed.data).toMatchObject({
            ktp_patient: false,
            markup_percent: '65',
        });
        expect(
            Object.keys(
                await refused(
                    await pharmacy.admin.patch(
                        `${api}/drug-prices/${withoutKtp.id}`,
                        {
                            price_group_id: umum.id,
                            grading_group_id: injeksi.id,
                            ...range,
                            markup_percent: 65,
                            ktp_patient: true,
                            version: changed.data.version,
                        },
                    ),
                ),
            ),
        ).toEqual(['price_from']);
        const stored = await pool.unsafe<{ id: string; pasien_ktp: boolean }[]>(
            `select id, pasien_ktp from far_m_grading_harga
             where tenant_id = $1 and berlaku_mulai = '2026-05-01' and deleted_at is null order by pasien_ktp`,
            [pharmacy.tenantId],
        );
        expect([...stored]).toEqual([
            { id: withoutKtp.id, pasien_ktp: false },
            { id: ktp.id, pasien_ktp: true },
        ]);
    });

    test('a reversed range, a negative markup, or a discount above 100 is refused field by field', async () => {
        const errors = await refused(
            await grading({
                price_from: 10,
                price_to: 5,
                markup_percent: -1,
                discount_percent: 101,
                effective_from: '2026-13-01',
            }),
        );
        expect(Object.keys(errors).sort()).toEqual([
            'discount_percent',
            'effective_from',
            'markup_percent',
            'price_to',
        ]);
    });

    test('a price group used by a grading row cannot be deleted until the row is deleted', async () => {
        const asing = await pharmacy.created<Reference & { version: number }>(
            '/api/v1/pricing/price-groups',
            { code: 'ASING', name: 'Asing' },
        );
        const row = await created({ price_group_id: asing.id });
        const remove = () =>
            pharmacy.admin.delete(`/api/v1/pricing/price-groups/${asing.id}`, {
                version: asing.version,
            });
        expect(Object.keys(await refused(await remove()))).toEqual(['_form']);
        expect(
            (
                await pharmacy.admin.delete(`${api}/drug-prices/${row.id}`, {
                    version: row.version,
                })
            ).status,
        ).toBe(204);
        expect((await remove()).status).toBe(204);
    });

    test('pharmacy drug data holds a grading group, keeps it when not sent, and a grading group in use cannot be deleted', async () => {
        const item = await pharmacy.item('GRD-1');
        const oral = await group('OBAT ORAL');
        const saved = await json<{
            data: {
                grading_group: { id: string; name: string } | null;
                version: number;
            };
        }>(
            await pharmacy.admin.put(`${api}/drugs/${item.id}`, {
                drug_class_id: null,
                grading_group_id: oral.id,
                is_generic: true,
                is_formulary: false,
                version: 0,
            }),
            200,
        );
        expect(saved.data.grading_group).toEqual({
            id: oral.id,
            name: 'OBAT ORAL',
        });
        const kept = await json<{
            data: { grading_group: { id: string } | null; version: number };
        }>(
            await pharmacy.admin.put(`${api}/drugs/${item.id}`, {
                drug_class_id: null,
                is_generic: false,
                is_formulary: false,
                version: saved.data.version,
            }),
            200,
        );
        expect(kept.data.grading_group?.id).toBe(oral.id);
        expect(
            Object.keys(
                await refused(
                    await pharmacy.admin.delete(
                        `${api}/grading-groups/${oral.id}`,
                        { version: oral.version },
                    ),
                ),
            ),
        ).toEqual(['_form']);
        const inactive = await group('TIDAK DIPAKAI', { is_active: false });
        expect(
            Object.keys(
                await refused(
                    await pharmacy.admin.put(`${api}/drugs/${item.id}`, {
                        drug_class_id: null,
                        grading_group_id: inactive.id,
                        is_generic: false,
                        is_formulary: false,
                        version: kept.data.version,
                    }),
                ),
            ),
        ).toEqual(['grading_group_id']);
        expect(
            (
                await pharmacy.admin.delete(
                    `${api}/grading-groups/${inactive.id}`,
                    { version: inactive.version },
                )
            ).status,
        ).toBe(204);
    });

    test('a viewer of pharmacy setup reads grading but cannot change it', async () => {
        const viewer = await createMember(pool, pharmacy.tenantId, [
            'pharmacy.setup.inquire',
        ]);
        await grantAllOrganizations(
            pool,
            pharmacy.tenantId,
            viewer.membershipId,
        );
        const session = browser();
        await session.login(viewer.email, viewer.password);
        const listed = await json<{ can_manage: boolean }>(
            await session.get(`${api}/drug-prices`),
            200,
        );
        expect(listed.can_manage).toBe(false);
        expect(
            (await session.post(`${api}/grading-groups`, { name: 'BARU' }))
                .status,
        ).toBe(403);
    });
});
