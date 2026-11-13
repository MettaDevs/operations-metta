import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    createBillingBusiness,
    json,
    refused,
} from '../../../support/billing-fixtures.ts';
import {
    operationsTestApp,
    type Browser,
} from '../../../support/operations-app.ts';

const api = '/api/v1/billing/merchants';

type Merchant = {
    id: string;
    code: string;
    name: string;
    debit_surcharge_percent: string;
    credit_surcharge_percent: string;
    discount_percent: string;
    is_active: boolean;
    version: number;
};

// Merchan per legal entity: isian form Merchan sistem lama, persen 0 sampai 100 dengan dua angka di belakang koma, dan
// kode unik selama barisnya belum dihapus.
describe.skipIf(!process.env.DB_HOST)('merchants', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let admin: Browser;

    beforeAll(async () => {
        admin = (
            await createBillingBusiness(pool, browser, 'Klinik Uji Merchan', [
                'core.billing-setup.manage',
            ])
        ).admin;
    });

    test('a merchant keeps the percents typed on screen, with a comma or a point', async () => {
        const created = await json<{ data: Merchant }>(
            await admin.post(api, {
                code: '002',
                name: 'QRIS',
                debit_surcharge_percent: '1,5',
                credit_surcharge_percent: 2.75,
            }),
            201,
        );
        expect(created.data).toEqual({
            id: created.data.id,
            code: '002',
            name: 'QRIS',
            debit_surcharge_percent: '1.5',
            credit_surcharge_percent: '2.75',
            discount_percent: '0',
            is_active: true,
            version: 1,
        });
        const [row] = await pool.unsafe<{ debet: string; kredit: string }[]>(
            'select add_charge_debet::text as debet, add_charge_kredit::text as kredit from merchan where id = $1',
            [created.data.id],
        );
        expect(row).toEqual({ debet: '1.50', kredit: '2.75' });
    });

    test('a percent outside 0 to 100 or with more than two decimals is refused per field', async () => {
        expect(
            Object.keys(
                await refused(
                    await admin.post(api, {
                        code: 'BCA',
                        name: 'EDC BCA',
                        debit_surcharge_percent: '101',
                        credit_surcharge_percent: '-1',
                        discount_percent: '0.125',
                    }),
                ),
            ).sort(),
        ).toEqual([
            'credit_surcharge_percent',
            'debit_surcharge_percent',
            'discount_percent',
        ]);
    });

    test('a code is unique until the merchant is deleted', async () => {
        const created = await json<{ data: Merchant }>(
            await admin.post(api, { code: 'mdr', name: 'EDC Mandiri' }),
            201,
        );
        expect(
            Object.keys(
                await refused(
                    await admin.post(api, { code: 'MDR', name: 'Lain' }),
                ),
            ),
        ).toEqual(['code']);
        expect(
            (
                await admin.delete(`${api}/${created.data.id}`, {
                    version: created.data.version,
                })
            ).status,
        ).toBe(204);
        await json(
            await admin.post(api, { code: 'MDR', name: 'EDC Mandiri' }),
            201,
        );
    });
});
