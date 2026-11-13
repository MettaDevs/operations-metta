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
type Row = { id: string; currency_code: string; version: number };

// Presisi mata uang tenant (Sys Admin › Mata uang): rupiah tanpa baris memakai bawaan, isian diperiksa per field, dan
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

    test('rupiah without a row uses the default: two amount decimals, three unit decimals, bills to the nearest rupiah', async () => {
        expect(await precision()).toEqual({
            amount_decimals: 2,
            unit_amount_decimals: 3,
            invoice_rounding_precision: '1',
            invoice_rounding_type: 'nearest',
        });
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
        const created = await json<{ data: Row }>(
            await admin.post(api, idr),
            201,
        );
        expect(created.data.currency_code).toBe('IDR');
        const saved = await precision();
        expect(roundInvoice(Decimal.of('26252.88'), saved).normalized()).toBe(
            '26300',
        );
        expect(Object.keys(await refused(await admin.post(api, idr)))).toEqual([
            'currency_code',
        ]);
        const updated = await json<{ data: Row }>(
            await admin.patch(`${api}/${created.data.id}`, {
                ...idr,
                invoice_rounding_precision: '0',
                version: created.data.version,
            }),
            200,
        );
        expect(updated.data.version).toBe(created.data.version + 1);
        expect(
            roundInvoice(
                Decimal.of('26252.88'),
                await precision(),
            ).normalized(),
        ).toBe('26253');
    });
});
