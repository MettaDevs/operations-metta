import { z } from 'zod';
import type { Database } from '../../platform/database/index.ts';
import { validation } from '../../platform/http/index.ts';
import {
    Decimal,
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

// Mata uang lokal tenant. Legal entity belum punya mata uang pembukuan sendiri (LCY Code BC), jadi kasir dan farmasi
// memakai rupiah; aset dan finance memakai mata uang dokumennya.
export const localCurrencyCode = 'IDR';

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

// Bawaan rupiah tanpa baris setelan: jumlah dua angka dan harga satuan tiga angka di belakang koma seperti CoreERP (aset
// dan finance diuji dengan angka ini), dan total tagihan dibulatkan ke rupiah terdekat, sama dengan round(..., 0) rumus
// total kasir Kuta 1 (Inv. Rounding Precision 1 BC).
const localDefault: Precision = {
    amount_decimals: 2,
    unit_amount_decimals: 3,
    invoice_rounding_precision: '1',
    invoice_rounding_type: 'nearest',
};

const isRoundingMethod = (value: string): value is RoundingMethod =>
    roundingMethods.some((method) => method === value);

export class Currency {
    private readonly cache = new Map<string, Precision>();

    constructor(
        private readonly db: Database,
        private readonly tenantId: string,
    ) {
        db.onTransactionBoundary(() => this.cache.clear());
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
}

// Jumlah uang dibulatkan ke presisi jumlah mata uangnya (Round(x, Amount Rounding Precision) BC).
export function roundAmount(value: Decimal, precision: Precision): Decimal {
    return value.rounded(precision.amount_decimals);
}

// Harga satuan dibulatkan ke presisi harga satuan mata uangnya.
export function roundUnitAmount(value: Decimal, precision: Precision): Decimal {
    return value.rounded(precision.unit_amount_decimals);
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
