import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    createBusiness,
    json,
    type Adjustment,
    type Business,
} from '../../../support/inventory-fixtures.ts';
import { operationsTestApp } from '../../../support/operations-app.ts';
import { documentText } from '../../../support/receipt-fixture.ts';

// Penyesuaian stok dicetak dari baris kartu gudangnya setelah diposting, karena batch stok keluar baru dipilih saat
// posting; draf dicetak dari barisnya dan ditandai.
describe.skipIf(!process.env.DB_HOST)('adjustment document', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let business: Business;
    let outbound: Adjustment;
    let userName: string;
    const text = async (id: string) => {
        const response = await business.admin.get(
            `/api/v1/reports/core.inventory-adjustment/records/${id}?format=docx`,
        );
        expect(response.status).toBe(200);
        return documentText(new Uint8Array(await response.arrayBuffer()));
    };

    beforeAll(async () => {
        business = await createBusiness(
            pool,
            browser,
            'Klinik Uji Cetak Penyesuaian',
        );
        const store = await business.location('GUDANG');
        const tracked = await business.trackingCode('OBAT', {
            batch_required: true,
            expiry_required: true,
        });
        const item = await business.item('ASM-1', {
            tracking_code_id: tracked.id,
        });
        await business.posted('masuk', store.id, [
            {
                item_id: item.id,
                quantity: 10,
                unit_cost: 700,
                batch_number: 'E-1',
                expiry_date: '2026-12-31',
            },
            {
                item_id: item.id,
                quantity: 10,
                unit_cost: 900,
                batch_number: 'E-2',
                expiry_date: '2027-03-31',
            },
        ]);
        outbound = await business.draft('keluar', store.id, [
            { item_id: item.id, quantity: 15 },
        ]);
        const [user] = await pool.unsafe<{ name: string }[]>(
            `select u.name from users u join tenant_memberships m on m.user_id = u.id where m.id = $1`,
            [business.member.membershipId],
        );
        userName = user?.name ?? '';
    });

    test('a draft prints its own lines and is marked as not posted', async () => {
        const draft = await text(outbound.id);
        expect(draft).toContain('PENYESUAIAN STOK');
        expect(draft).toContain('DRAF, BELUM DIPOSTING');
        expect(draft).toContain('Stok keluar');
        expect(draft).toContain('Barang ASM-1');
        expect(draft).not.toContain('{');
    });

    test('a posted outbound adjustment prints one line per batch taken, with expiry, cost, and the officer', async () => {
        await json(await business.post(outbound), 200);
        const posted = await text(outbound.id);
        expect(posted).not.toContain('DRAF');
        expect(posted).toContain('E-1');
        expect(posted).toContain('31 Desember 2026');
        expect(posted).toContain('E-2');
        expect(posted).toContain('7.000');
        expect(posted).toContain('4.500');
        expect(posted).toContain('11.500');
        expect(posted).toContain('Sebelas Ribu Lima Ratus Rupiah');
        expect(posted).toContain(`( ${userName} )`);
        expect(posted).not.toContain('{');
    });
});
