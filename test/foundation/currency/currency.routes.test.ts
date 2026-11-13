import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    Currency,
    roundInvoice,
} from '../../../src/foundation/currency/index.ts';
import { Database } from '../../../src/platform/database/index.ts';
import { Decimal } from '../../../src/platform/money/index.ts';
import { json, refused } from '../../support/billing-fixtures.ts';
import {
    operationsTestApp,
    type Browser,
} from '../../support/operations-app.ts';
import { createMember, createTenant } from '../../support/tenant-fixtures.ts';

const api = '/api/v1/currencies';
type Row = {
    id: string;
    currency_code: string;
    amount_decimals: number;
    unit_amount_decimals: number;
    invoice_rounding_precision: string;
    invoice_rounding_type: string;
    version: number;
};

// Presisi mata uang tenant (Sys Admin › Mata uang): tenant baru punya baris rupiah utuh, isian diperiksa per field, dan
// presisi yang disimpan langsung dipakai pembulatan tagihan.
describe.skipIf(!process.env.DB_HOST)('currency precisions', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let tenantId: string;
    let admin: Browser;

    const precision = async () => {
        const connection = await pool.reserve();
        try {
            return await new Currency(
                new Database(connection, undefined, Bun.randomUUIDv7()),
                tenantId,
            ).precision('idr');
        } finally {
            connection.release();
        }
    };
    const idr = {
        currency_code: 'idr',
        amount_decimals: 0,
        unit_amount_decimals: 0,
        invoice_rounding_precision: '100',
        invoice_rounding_type: 'up',
    };

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Klinik Uji Mata Uang');
        const member = await createMember(pool, tenantId, [
            'core.reference-data.manage',
        ]);
        admin = browser();
        await admin.login(member.email, member.password);
    });

    test('a new tenant has a whole-rupiah row: no amount or unit decimals and no further bill rounding', async () => {
        const listed = await json<{ data: Row[] }>(await admin.get(api), 200);
        expect(
            listed.data.map(({ id: _id, version: _version, ...row }) => row),
        ).toEqual([
            {
                currency_code: 'IDR',
                amount_decimals: 0,
                unit_amount_decimals: 0,
                invoice_rounding_precision: '0',
                invoice_rounding_type: 'nearest',
            },
        ]);
        expect(
            roundInvoice(Decimal.of('26252.5'), await precision()).normalized(),
        ).toBe('26253');
    });

    test('a unit precision coarser than the amount, an unknown method, and a negative multiple are refused per field', async () => {
        expect(
            Object.keys(
                await refused(
                    await admin.post(api, {
                        ...idr,
                        amount_decimals: 2,
                        invoice_rounding_precision: '-1',
                        invoice_rounding_type: 'sideways',
                    }),
                ),
            ).sort(),
        ).toEqual([
            'invoice_rounding_precision',
            'invoice_rounding_type',
            'unit_amount_decimals',
        ]);
    });

    test('a saved precision is the one the bill is rounded with, and a code is set once', async () => {
        const [current] = (
            await json<{ data: Row[] }>(await admin.get(api), 200)
        ).data;
        if (!current) throw new Error('The tenant has no rupiah row.');
        expect(Object.keys(await refused(await admin.post(api, idr)))).toEqual([
            'currency_code',
        ]);
        const saved = await json<{ data: Row }>(
            await admin.patch(`${api}/${current.id}`, {
                ...idr,
                version: current.version,
            }),
            200,
        );
        expect(saved.data.currency_code).toBe('IDR');
        expect(
            roundInvoice(
                Decimal.of('26252.88'),
                await precision(),
            ).normalized(),
        ).toBe('26300');
        const updated = await json<{ data: Row }>(
            await admin.patch(`${api}/${current.id}`, {
                ...idr,
                invoice_rounding_precision: '0',
                version: saved.data.version,
            }),
            200,
        );
        expect(updated.data.version).toBe(saved.data.version + 1);
        expect(
            roundInvoice(
                Decimal.of('26252.88'),
                await precision(),
            ).normalized(),
        ).toBe('26253');
    });

    test('another currency is added with its own precision', async () => {
        const created = await json<{ data: Row }>(
            await admin.post(api, {
                currency_code: 'usd',
                amount_decimals: 2,
                unit_amount_decimals: 5,
                invoice_rounding_precision: '0',
                invoice_rounding_type: 'nearest',
            }),
            201,
        );
        expect(created.data.currency_code).toBe('USD');
    });
});
