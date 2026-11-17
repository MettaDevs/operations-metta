import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    createBusiness,
    inventoryDuties,
    json,
    type Business,
} from '../../../support/inventory-fixtures.ts';
import { operationsTestApp } from '../../../support/operations-app.ts';
import {
    createMember,
    grantAllOrganizations,
} from '../../../support/tenant-fixtures.ts';

type Terms = {
    id: string;
    code: string;
    name: string;
    due_days: number;
    version: number;
};
type WithTerms = {
    id: string;
    version: number;
    payment_terms: { id: string; code: string; due_days: number } | null;
};

const path = '/api/v1/purchasing/payment-terms';

// Termin pembayaran: kode yang diketik pengguna dan unik per legal entity selama belum dihapus, jumlah hari sampai jatuh
// tempo, termin bawaan vendor yang disalin ke purchase order baru, penolakan hapus termin yang masih dipakai, dan izin.
describe.skipIf(!process.env.DB_HOST)('payment terms', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let business: Business;

    beforeAll(async () => {
        business = await createBusiness(pool, browser, 'Klinik Uji Termin', [
            ...inventoryDuties,
            'core.vendor.manage',
            'core.purchase-order.manage',
        ]);
    });

    const create = async (body: Record<string, unknown>) =>
        (
            await json<{ data: Terms }>(
                await business.admin.post(path, body),
                201,
            )
        ).data;

    test('a code is uppercased, unique among live terms, and free again after delete', async () => {
        const terms = await create({
            code: ' 30h ',
            name: '30 hari',
            due_days: '30',
        });
        expect(terms).toMatchObject({
            code: '30H',
            name: '30 hari',
            due_days: 30,
        });
        const taken = await json<{ errors: Record<string, string[]> }>(
            await business.admin.post(path, {
                code: '30H',
                name: 'Lain',
                due_days: 30,
            }),
            422,
        );
        expect(taken.errors.code?.[0]).toContain('sudah dipakai');
        expect(
            (
                await business.admin.delete(`${path}/${terms.id}`, {
                    version: terms.version,
                })
            ).status,
        ).toBe(204);
        expect(
            await create({ code: '30H', name: '30 hari', due_days: 30 }),
        ).toMatchObject({ code: '30H' });
        const [row] = await pool.unsafe<{ live: number; deleted: number }[]>(
            `select count(*) filter (where deleted_at is null)::int as live,
                    count(*) filter (where deleted_at is not null)::int as deleted
             from termin_pembayaran where tenant_id = $1 and kode = '30H'`,
            [business.tenantId],
        );
        expect(row).toEqual({ live: 1, deleted: 1 });
    });

    test('days must be a whole number from 0 to 3650', async () => {
        for (const due_days of [-1, 3651, '1.5', 'tiga'])
            expect(
                (
                    await json<{ errors: Record<string, string[]> }>(
                        await business.admin.post(path, {
                            code: 'X',
                            name: 'Salah',
                            due_days,
                        }),
                        422,
                    )
                ).errors.due_days?.[0],
            ).toBe('Isi jumlah hari 0 sampai 3650.');
        expect(
            await create({ code: 'TUNAI', name: 'Tunai', due_days: 0 }),
        ).toMatchObject({ due_days: 0 });
    });

    test('the vendor default is copied to a new purchase order, kept when the order omits it, and blocks delete', async () => {
        const terms = await create({
            code: '21H',
            name: '21 hari',
            due_days: 21,
        });
        const vendor = (
            await json<{ data: WithTerms }>(
                await business.admin.post('/api/v1/purchasing/vendors', {
                    name: 'PBF Uji Termin',
                    payment_terms_id: terms.id,
                }),
                201,
            )
        ).data;
        expect(vendor.payment_terms).toMatchObject({
            code: '21H',
            due_days: 21,
        });
        const location = await business.location('GUDANG');
        const item = await business.item('AMX');
        const body = {
            vendor_id: vendor.id,
            location_id: location.id,
            order_date: '2026-11-17',
            lines: [{ item_id: item.id, quantity: 1, unit_cost: 1000 }],
        };
        const order = (
            await json<{ data: WithTerms }>(
                await business.admin.post('/api/v1/purchasing/orders', body),
                201,
            )
        ).data;
        expect(order.payment_terms?.id).toBe(terms.id);
        const kept = (
            await json<{ data: WithTerms }>(
                await business.admin.patch(
                    `/api/v1/purchasing/orders/${order.id}`,
                    { ...body, version: order.version },
                ),
                200,
            )
        ).data;
        expect(kept.payment_terms?.id).toBe(terms.id);
        const cleared = (
            await json<{ data: WithTerms }>(
                await business.admin.patch(
                    `/api/v1/purchasing/orders/${order.id}`,
                    { ...body, payment_terms_id: null, version: kept.version },
                ),
                200,
            )
        ).data;
        expect(cleared.payment_terms).toBeNull();
        const inUse = await json<{ errors: Record<string, string[]> }>(
            await business.admin.delete(`${path}/${terms.id}`, {
                version: terms.version,
            }),
            422,
        );
        expect(inUse.errors._form?.[0]).toContain('termin bawaan vendor');
    });

    test('reading terms needs the vendor or purchase order duty, and changing them needs vendor manage', async () => {
        const reader = await createMember(pool, business.tenantId, [
            'core.purchase-order.inquire',
        ]);
        await grantAllOrganizations(
            pool,
            business.tenantId,
            reader.membershipId,
        );
        const session = browser();
        await session.login(reader.email, reader.password);
        const listed = await json<{ can_manage: boolean }>(
            await session.get(path),
            200,
        );
        expect(listed.can_manage).toBe(false);
        expect(
            (
                await session.post(path, {
                    code: 'NO',
                    name: 'Tidak boleh',
                    due_days: 1,
                })
            ).status,
        ).toBe(403);
    });
});
