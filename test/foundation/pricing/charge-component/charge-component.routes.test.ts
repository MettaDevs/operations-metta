import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    operationsTestApp,
    type Browser,
} from '../../../support/operations-app.ts';
import {
    createMember,
    createTenant,
} from '../../../support/tenant-fixtures.ts';

type ChargeComponent = {
    id: string;
    code: string;
    name: string;
    sort_order: number;
    is_active: boolean;
    version: number;
};
const api = '/api/v1/pricing/charge-components';

async function json<T>(response: Response, status: number): Promise<T> {
    const text = await response.text();
    if (response.status !== status)
        throw new Error(`Expected ${status}, got ${response.status}: ${text}`);
    return JSON.parse(text) as T;
}

// Komponen biaya Core: satu komponen bawaan saat tenant lahir, kode pendek unik per tenant selama barisnya belum dihapus,
// urutan bilangan bulat, dan hak kelola terpisah dari hak lihat. Penolakan hapus saat dipakai tarif diuji di module
// layanan kesehatan, yang memegang tabel tarifnya.
describe.skipIf(!process.env.DB_HOST)('charge components', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let tenantId: string;
    let manager: Browser;
    let viewer: Browser;

    const list = async (as: Browser, query = '') =>
        json<{ data: ChargeComponent[]; can_manage: boolean }>(
            await as.get(`${api}${query}`),
            200,
        );

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Klinik Uji Komponen Biaya');
        const owner = await createMember(pool, tenantId, [
            'core.pricing-setup.manage',
        ]);
        manager = browser();
        await manager.login(owner.email, owner.password);
        const reader = await createMember(pool, tenantId, [
            'core.pricing-setup.inquire',
        ]);
        viewer = browser();
        await viewer.login(reader.email, reader.password);
    });

    test('a new tenant starts with one active component, so a tariff can be entered without setup', async () => {
        const listed = await list(manager);
        expect(
            listed.data.map((row) => [
                row.code,
                row.name,
                row.sort_order,
                row.is_active,
            ]),
        ).toEqual([['PELAYANAN', 'Pelayanan', 1, true]]);
    });

    test('filling the default again adds nothing, and does not bring back a deleted default', async () => {
        const fill = () =>
            pool.unsafe('select public.komponen_biaya_isi_acuan($1)', [
                tenantId,
            ]);
        const count = async () =>
            (
                await pool.unsafe<{ live: number; all: number }[]>(
                    `select count(*) filter (where deleted_at is null)::int as live, count(*)::int as all
                     from komponen_biaya where tenant_id = $1`,
                    [tenantId],
                )
            )[0];
        await fill();
        expect(await count()).toEqual({ live: 1, all: 1 });
        const otherTenant = await createTenant(pool, 'Klinik Tanpa Komponen');
        await pool.unsafe(
            'update komponen_biaya set deleted_at = now() where tenant_id = $1',
            [otherTenant],
        );
        await pool.unsafe('select public.komponen_biaya_isi_acuan($1)', [
            otherTenant,
        ]);
        const [rows] = await pool.unsafe<{ live: number }[]>(
            'select count(*) filter (where deleted_at is null)::int as live from komponen_biaya where tenant_id = $1',
            [otherTenant],
        );
        expect(rows?.live).toBe(0);
    });

    test('components are listed by their order, and the order typed on screen is saved as a whole number', async () => {
        const created = await json<{ data: ChargeComponent }>(
            await manager.post(api, {
                code: 'sarana',
                name: 'Sarana',
                sort_order: '0',
            }),
            201,
        );
        expect(created.data).toEqual({
            id: created.data.id,
            code: 'SARANA',
            name: 'Sarana',
            sort_order: 0,
            account_group: 'Pendapatan',
            posting_to: 'GL',
            payable_to: 'None',
            service_group: 'Jasa Pelayanan',
            includes_incentive: false,
            excludes_hospital_cost: false,
            is_active: true,
            version: 1,
        });
        expect((await list(manager)).data.map((row) => row.code)).toEqual([
            'SARANA',
            'PELAYANAN',
        ]);
    });

    test('a taken code, a blank name, and an order that is not a whole number from 0 to 999 are refused per field', async () => {
        const taken = await json<{ errors: Record<string, string[]> }>(
            await manager.post(api, { code: 'Pelayanan', name: 'Lain' }),
            422,
        );
        expect(Object.keys(taken.errors)).toEqual(['code']);
        for (const sortOrder of [-1, 1.5, 'dua', '', 1000]) {
            const refused = await json<{ errors: Record<string, string[]> }>(
                await manager.post(api, {
                    code: 'X',
                    name: ' ',
                    sort_order: sortOrder,
                }),
                422,
            );
            expect(Object.keys(refused.errors).sort()).toEqual([
                'name',
                'sort_order',
            ]);
        }
    });

    test('an unused component is deleted softly, and its code is free again', async () => {
        const created = await json<{ data: ChargeComponent }>(
            await manager.post(api, { code: 'BHP', name: 'BHP' }),
            201,
        );
        expect(
            (
                await manager.delete(`${api}/${created.data.id}`, {
                    version: created.data.version,
                })
            ).status,
        ).toBe(204);
        const [row] = await pool.unsafe<{ deleted: boolean }[]>(
            'select deleted_at is not null as deleted from komponen_biaya where id = $1',
            [created.data.id],
        );
        expect(row?.deleted).toBe(true);
        await json(
            await manager.post(api, { code: 'BHP', name: 'Bahan habis pakai' }),
            201,
        );
    });

    test('the legacy component fields default to the meaning of Kuta DT76 Pelayanan and are saved as chosen', async () => {
        const fields = (row: Record<string, unknown>) => ({
            account_group: row.account_group,
            posting_to: row.posting_to,
            payable_to: row.payable_to,
            service_group: row.service_group,
            includes_incentive: row.includes_incentive,
            excludes_hospital_cost: row.excludes_hospital_cost,
        });
        const listed = await list(manager, '?q=PELAYANAN');
        expect(listed.data.map(fields)).toEqual([
            {
                account_group: 'Pendapatan',
                posting_to: 'GL',
                payable_to: 'None',
                service_group: 'Jasa Pelayanan',
                includes_incentive: false,
                excludes_hospital_cost: false,
            },
        ]);
        const sarana = await json<{ data: Record<string, unknown> }>(
            await manager.post(api, {
                code: 'DT80',
                name: 'Sarana Kuta',
                account_group: 'Biaya',
                posting_to: 'Hutang',
                payable_to: 'Dokter',
                service_group: 'Jasa Sarana',
                includes_incentive: true,
            }),
            201,
        );
        expect(fields(sarana.data)).toEqual({
            account_group: 'Biaya',
            posting_to: 'Hutang',
            payable_to: 'Dokter',
            service_group: 'Jasa Sarana',
            includes_incentive: true,
            excludes_hospital_cost: false,
        });
        const [row] = await pool.unsafe<{ rekening: string; jasa: string }[]>(
            "select kelompok_rekening as rekening, kelompok_jasa as jasa from komponen_biaya where tenant_id = $1 and kode = 'DT80'",
            [tenantId],
        );
        expect(row).toEqual({ rekening: 'Biaya', jasa: 'Jasa Sarana' });
        const refused = await json<{ errors: Record<string, string[]> }>(
            await manager.post(api, {
                code: 'DT99',
                name: 'Salah',
                posting_to: 'Kas',
                service_group: 'Alat',
            }),
            422,
        );
        expect(Object.keys(refused.errors).sort()).toEqual([
            'posting_to',
            'service_group',
        ]);
    });

    test('a viewer reads components but cannot add one', async () => {
        const listed = await list(viewer, '?active=1');
        expect(listed.can_manage).toBe(false);
        expect(listed.data.length).toBeGreaterThan(0);
        expect((await viewer.post(api, { code: 'Y', name: 'Y' })).status).toBe(
            403,
        );
    });
});
