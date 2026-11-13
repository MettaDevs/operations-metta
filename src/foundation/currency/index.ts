import { z } from 'zod';
import type { Database } from '../../platform/database/index.ts';
import { validation } from '../../platform/http/index.ts';
import {
    Decimal,
    localCurrencyCode,
    localCurrencyPrecision,
    roundingMethods,
    roundToMultiple,
    type RoundingMethod,
} from '../../platform/money/index.ts';

// Presisi mata uang per tenant (tabel Currency dan General Ledger Setup BC): angka di belakang koma untuk jumlah uang
// dan harga satuan, dan pembulatan total tagihan. Satu sumber pembulatan uang dan harga untuk kasir, farmasi, aset, dan
// finance; pembulatannya lewat helper di src/platform/money/.

export {
    amountDecimalOptions,
    amountInput,
    decimalsHint,
    unitAmountDecimalOptions,
} from './currency.rules.ts';
export { currencyRoutes } from './currency.routes.ts';
export { exchangeRateRoutes } from './exchange-rate.routes.ts';
export { localCurrencyCode } from '../../platform/money/index.ts';

const precisionSchema = z.object({
    amount_decimals: z.number(),
    unit_amount_decimals: z.number(),
    invoice_rounding_precision: z.string(),
    invoice_rounding_type: z.string(),
});

export type Precision = {
    amount_decimals: number;
    unit_amount_decimals: number;
    // Kelipatan pembulatan total tagihan; 0 berarti tidak dibulatkan.
    invoice_rounding_precision: string;
    invoice_rounding_type: RoundingMethod;
};

// Setiap tenant mendapat baris rupiah saat disiapkan, dan tenant lama lewat migration, jadi bawaan ini hanya jaring bila
// baris itu tetap tidak ada: rupiah utuh, sama dengan baris yang ditulis penyiapan.
const localDefault: Precision = localCurrencyPrecision;

const isRoundingMethod = (value: string): value is RoundingMethod =>
    roundingMethods.some((method) => method === value);

const rateSchema = z.object({ kurs: z.string() });

// Tanggal untuk pesan, dd/mm/yyyy seperti layar.
const displayDate = (date: string) => date.split('-').reverse().join('/');

export class Currency {
    private readonly cache = new Map<string, Precision>();
    private readonly rates = new Map<string, Decimal>();

    constructor(
        private readonly db: Database,
        private readonly tenantId: string,
    ) {
        db.onTransactionBoundary(() => {
            this.cache.clear();
            this.rates.clear();
        });
    }

    async precision(code: string): Promise<Precision> {
        const key = code.toUpperCase();
        const cached = this.cache.get(key);
        if (cached) return cached;
        const row = await this.db.one(
            precisionSchema,
            `select amount_decimals, unit_amount_decimals,
                    trim_scale(invoice_rounding_precision)::text as invoice_rounding_precision, invoice_rounding_type
             from currency_precisions where tenant_id=$1 and currency_code=$2 limit 1`,
            [this.tenantId, key],
        );
        if (!row && key !== localCurrencyCode)
            validation({
                currency_code: `Presisi mata uang ${key} belum disetel. Atur di Sys Admin › Mata uang.`,
            });
        const type = row?.invoice_rounding_type ?? 'nearest';
        if (!isRoundingMethod(type))
            throw new Error(`Invalid invoice rounding type ${type}.`);
        const precision = row
            ? { ...row, invoice_rounding_type: type }
            : localDefault;
        this.cache.set(key, precision);
        return precision;
    }

    // Kurs mata uang pada satu tanggal (yyyy-mm-dd): nilai satu satuan mata uang itu dalam mata uang lokal, dari baris
    // dengan tanggal berlaku terakhir yang tidak lewat dari tanggal itu (Currency Exchange Rate BC). Mata uang lokal
    // selalu 1. Kurs yang belum diisi ditolak di `field`.
    async rate(
        code: string,
        date: string,
        field = 'currency_code',
    ): Promise<Decimal> {
        const key = code.toUpperCase();
        if (key === localCurrencyCode) return Decimal.of('1');
        const cached = this.rates.get(`${key}:${date}`);
        if (cached) return cached;
        const row = await this.db.one(
            rateSchema,
            `select trim_scale(kurs)::text as kurs from tbj_his_currency
             where tenant_id = $1 and currency_code = $2 and tanggal_berlaku <= $3::date and deleted_at is null
             order by tanggal_berlaku desc limit 1`,
            [this.tenantId, key, date],
        );
        if (!row)
            validation({
                [field]: `Kurs ${key} untuk ${displayDate(date)} belum diisi. Atur di Sys Admin › Kurs.`,
            });
        const rate = Decimal.of(row.kurs);
        this.rates.set(`${key}:${date}`, rate);
        return rate;
    }
}

// Jumlah uang dibulatkan ke presisi jumlah mata uangnya (Round(x, Amount Rounding Precision) BC).
export function roundAmount(value: Decimal, precision: Precision): Decimal {
    return value.rounded(precision.amount_decimals);
}

// Harga satuan dibulatkan ke presisi harga satuan mata uangnya.
export function roundUnitAmount(value: Decimal, precision: Precision): Decimal {
    return value.rounded(precision.unit_amount_decimals);
}

// Jumlah valuta dalam mata uang lokal: jumlah kali kurs, dibulatkan ke presisi jumlah mata uang lokal (ExchangeAmtFCYToLCY
// lalu Round BC).
export function toLocalAmount(
    amount: Decimal,
    rate: Decimal,
    local: Precision,
): Decimal {
    return roundAmount(amount.multipliedBy(rate), local);
}

// Total tagihan: dibulatkan ke presisi jumlah, lalu ke kelipatan pembulatan tagihan menurut metodenya. Selisihnya kelak
// diposting finance ke akun pembulatan (Invoice Rounding Account BC, Rekening_Pembulatan sistem lama).
export function roundInvoice(value: Decimal, precision: Precision): Decimal {
    return roundToMultiple(
        roundAmount(value, precision),
        Decimal.of(precision.invoice_rounding_precision),
        precision.invoice_rounding_type,
    );
}
