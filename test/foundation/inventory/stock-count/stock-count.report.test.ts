import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    createBusiness,
    inventoryApi,
    inventoryDuties,
    json,
    type Business,
} from '../../../support/inventory-fixtures.ts';
import { operationsTestApp } from '../../../support/operations-app.ts';
import { documentText } from '../../../support/receipt-fixture.ts';
import {
    createMember,
    grantAllOrganizations,
} from '../../../support/tenant-fixtures.ts';

type Reference = { id: string; code: string; name: string };
type Position = {
    item: Reference & { base_unit_id: string };
    batch: { id: string; batch_number: string } | null;
};
type Count = { id: string; number: string; version: number };

const path = `${inventoryApi}/stock-counts`;

// Lembar hitung (Phys. Inventory List BC) dan hasil opname (Posted Phys. Invt. Order Diff BC) dari satu dataset opname:
// lembar hitung dengan atau tanpa stok tercatat, hasil dengan selisih per batch, nilai dari kartu gudang, penghitung
// dan pemosting.
describe.skipIf(!process.env.DB_HOST)('stock count documents', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let business: Business;
    let count: Count;
    let userName: string;
    const text = async (code: string, query = 'format=docx') => {
        const response = await business.admin.get(
            `/api/v1/reports/${code}/records/${count.id}?${query}`,
        );
        expect(response.status).toBe(200);
        return documentText(new Uint8Array(await response.arrayBuffer()));
    };

    beforeAll(async () => {
        business = await createBusiness(
            pool,
            browser,
            'Klinik Uji Cetak Opname',
            [...inventoryDuties, 'core.inventory-count.manage'],
        );
        const store = await business.location('APOTEK');
        const tracked = await business.trackingCode('OBAT', {
            batch_required: true,
            expiry_required: true,
        });
        const item = await business.item('CTM-4', {
            tracking_code_id: tracked.id,
        });
        await business.posted('masuk', store.id, [
            {
                item_id: item.id,
                quantity: 30,
                unit_cost: 500,
                batch_number: 'B-OPN',
                expiry_date: '2027-09-30',
            },
        ]);
        const positions = (
            await json<{ data: Position[] }>(
                await business.admin.post(`${path}/calculate-lines`, {
                    location_id: store.id,
                    posting_date: '2026-11-12',
                }),
                200,
            )
        ).data;
        const draft = (
            await json<{ data: Count }>(
                await business.admin.post(path, {
                    location_id: store.id,
                    count_date: '2026-11-12',
                    posting_date: '2026-11-12',
                    description: 'Opname akhir bulan',
                    lines: positions.map((position) => ({
                        item_id: position.item.id,
                        batch_id: position.batch?.id ?? null,
                        unit_id: position.item.base_unit_id,
                        quantity_counted: 27,
                    })),
                }),
                201,
            )
        ).data;
        count = draft;
        const [user] = await pool.unsafe<{ name: string }[]>(
            `select u.name from users u join tenant_memberships m on m.user_id = u.id where m.id = $1`,
            [business.member.membershipId],
        );
        userName = user?.name ?? '';
    });

    test('the counting sheet lists each batch with its expiry and leaves the count blank; the blind layout hides the recorded stock', async () => {
        const sheet = await text('core.stock-count-sheet');
        expect(sheet).toContain('LEMBAR HITUNG STOK');
        expect(sheet).toContain(count.number);
        expect(sheet).toContain('Lokasi APOTEK');
        expect(sheet).toContain('B-OPN');
        expect(sheet).toContain('30 September 2027');
        expect(sheet).toContain('TAB\n30\n\n');
        const blind = await text(
            'core.stock-count-sheet',
            'format=docx&layout=builtin:a4-blind',
        );
        expect(blind).toContain('B-OPN');
        expect(blind).not.toContain('Tercatat');
    });

    test('the result before posting is marked, and after posting shows the difference, its value, and who counted and posted', async () => {
        expect(await text('core.stock-count-result')).toContain(
            'BELUM SELESAI DIHITUNG',
        );
        const step = async (
            action: string,
            body: Record<string, unknown> = {},
        ) => {
            count = (
                await json<{ data: Count }>(
                    await business.admin.post(`${path}/${count.id}/${action}`, {
                        version: count.version,
                        ...body,
                    }),
                    200,
                )
            ).data;
        };
        await step('finish');
        await step('post', { posting_date: '2026-11-12' });
        const result = await text('core.stock-count-result');
        expect(result).toContain('HASIL OPNAME STOK');
        expect(result).not.toContain('BELUM');
        expect(result).toContain('B-OPN');
        expect(result).toContain('-3');
        expect(result).toContain('-1.500');
        expect(result).toContain('1.500');
        expect(result.split(`( ${userName} )`).length - 1).toBe(2);
        expect(result).not.toContain('{');
    });

    test('printing needs the stock count read permission', async () => {
        const clerk = await createMember(pool, business.tenantId, [
            'core.organization.manage',
        ]);
        await grantAllOrganizations(
            pool,
            business.tenantId,
            clerk.membershipId,
        );
        const session = browser();
        await session.login(clerk.email, clerk.password);
        expect(
            (
                await session.get(
                    `/api/v1/reports/core.stock-count-sheet/records/${count.id}?format=docx`,
                )
            ).status,
        ).toBe(403);
    });
});
