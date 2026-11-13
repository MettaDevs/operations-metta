import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    Currency,
    localCurrencyCode,
    toLocalAmount,
} from '../../../src/foundation/currency/index.ts';
import { Database } from '../../../src/platform/database/index.ts';
import { HttpFailure } from '../../../src/platform/http/index.ts';
import { Decimal } from '../../../src/platform/money/index.ts';
import { json, refused } from '../../support/billing-fixtures.ts';
import {
    operationsTestApp,
    type Browser,
} from '../../support/operations-app.ts';
import { createMember, createTenant } from '../../support/tenant-fixtures.ts';

const api = '/api/v1/exchange-rates';
type Row = {
    id: string;
    currency_code: string;
    starting_date: string;
    rate: string;
    version: number;
};

// Kurs mata uang asing (Sys Admin › Kurs): mata uangnya wajib sudah disetel, kurs dipilih menurut tanggal berlaku
// terakhir yang tidak lewat dari tanggal pembayaran, dan tanggal tanpa kurs ditolak dengan pesan yang jelas.
describe.skipIf(!process.env.DB_HOST)('exchange rates', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let tenantId: string;
    let admin: Browser;
    // Kode mata uang asing uji, bukan nama mata uang sungguhan, supaya tidak ada yang ditulis mati.
    const foreign = 'XTS';

    const withCurrency = async <T>(
        work: (currency: Currency) => Promise<T>,
    ) => {
        const connection = await pool.reserve();
        try {
            return await work(
                new Currency(
                    new Database(connection, undefined, Bun.randomUUIDv7()),
                    tenantId,
                ),
            );
        } finally {
            connection.release();
        }
    };
    const rate = (date: string) =>
        withCurrency(async (currency) =>
            (await currency.rate(foreign, date)).normalized(),
        );

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Klinik Uji Kurs');
        const member = await createMember(pool, tenantId, [
            'core.reference-data.manage',
        ]);
        admin = browser();
        await admin.login(member.email, member.password);
        await json(
            await admin.post('/api/v1/currencies', {
                currency_code: foreign,
                amount_decimals: 2,
                unit_amount_decimals: 4,
                invoice_rounding_precision: '0',
                invoice_rounding_type: 'nearest',
            }),
            201,
        );
    });

    test('the local currency, a currency not set up, a bad date, and a rate that is not above zero are refused per field', async () => {
        expect(
            Object.keys(
                await refused(
                    await admin.post(api, {
                        currency_code: localCurrencyCode,
                        starting_date: '2026-11-31',
                        rate: '0',
                    }),
                ),
            ).sort(),
        ).toEqual(['currency_code', 'rate', 'starting_date']);
        expect(
            await refused(
                await admin.post(api, {
                    currency_code: 'XXX',
                    starting_date: '2026-11-01',
                    rate: '1.1234567',
                }),
            ),
        ).toEqual({
            currency_code: [
                'Pilih mata uang yang sudah disetel di Sys Admin › Mata uang.',
            ],
            rate: [
                'Isi kurs lebih dari 0, paling banyak 6 angka di belakang koma.',
            ],
        });
    });

    test('the rate for a date is the latest starting date on or before it, and a date before the first rate is refused', async () => {
        const first = await json<{ data: Row }>(
            await admin.post(api, {
                currency_code: foreign.toLowerCase(),
                starting_date: '2026-11-01',
                rate: '16000',
            }),
            201,
        );
        expect(first.data).toMatchObject({
            currency_code: foreign,
            starting_date: '2026-11-01',
            rate: '16000',
        });
        await json(
            await admin.post(api, {
                currency_code: foreign,
                starting_date: '2026-11-10',
                rate: '16250,5',
            }),
            201,
        );
        expect(
            await refused(
                await admin.post(api, {
                    currency_code: foreign,
                    starting_date: '2026-11-10',
                    rate: '16300',
                }),
            ),
        ).toEqual({
            starting_date: [
                'Kurs mata uang ini untuk tanggal itu sudah ada. Ubah baris yang ada saja.',
            ],
        });

        expect(await rate('2026-11-01')).toBe('16000');
        expect(await rate('2026-11-09')).toBe('16000');
        expect(await rate('2026-11-10')).toBe('16250.5');
        expect(await rate('2026-12-31')).toBe('16250.5');
        expect(
            await withCurrency(async (currency) =>
                (
                    await currency.rate(localCurrencyCode, '2026-11-05')
                ).normalized(),
            ),
        ).toBe('1');

        const missing = await withCurrency(async (currency) => {
            try {
                await currency.rate(foreign, '2026-10-31', 'payments.0.rate');
                return null;
            } catch (error) {
                if (error instanceof HttpFailure) return error.body;
                throw error;
            }
        });
        expect(missing).toEqual({
            message: `Kurs ${foreign} untuk 31/10/2026 belum diisi. Atur di Sys Admin › Kurs.`,
            errors: {
                'payments.0.rate': [
                    `Kurs ${foreign} untuk 31/10/2026 belum diisi. Atur di Sys Admin › Kurs.`,
                ],
            },
        });
    });

    test('an amount is converted at the exact rate and rounded once to the local amount precision', async () => {
        const local = await withCurrency((currency) =>
            currency.precision(localCurrencyCode),
        );
        const exchanged = Decimal.of('12.35');
        const rateOn = Decimal.of(await rate('2026-11-12'));
        expect(toLocalAmount(exchanged, rateOn, local).normalized()).toBe(
            '200694',
        );
        expect(
            toLocalAmount(exchanged, rateOn, {
                ...local,
                amount_decimals: 2,
            }).fixed(2),
        ).toBe('200693.68');
    });

    test('a changed rate is used from then on, and a deleted rate hands its dates back to the one before', async () => {
        const listed = await json<{ data: Row[]; currencies: string[] }>(
            await admin.get(api),
            200,
        );
        expect(listed.currencies).toEqual([foreign]);
        expect(listed.data.map((row) => row.starting_date)).toEqual([
            '2026-11-10',
            '2026-11-01',
        ]);
        const [latest] = listed.data;
        if (!latest) throw new Error('No rate listed.');
        const changed = await json<{ data: Row }>(
            await admin.patch(`${api}/${latest.id}`, {
                currency_code: foreign,
                starting_date: latest.starting_date,
                rate: '16300',
                version: latest.version,
            }),
            200,
        );
        expect(changed.data.version).toBe(latest.version + 1);
        expect(await rate('2026-11-15')).toBe('16300');

        expect(
            (
                await admin.delete(`${api}/${latest.id}`, {
                    version: changed.data.version,
                })
            ).status,
        ).toBe(204);
        expect(await rate('2026-11-15')).toBe('16000');
        expect(
            (await json<{ data: Row[] }>(await admin.get(api), 200)).data,
        ).toHaveLength(1);
    });
});
