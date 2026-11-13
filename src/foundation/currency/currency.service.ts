import type { Workspace } from '../../platform/access/index.ts';
import {
    nowSql,
    sqlErrorCode,
    type Database,
} from '../../platform/database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    lookupId,
    staleMessage,
    validation,
} from '../../platform/http/index.ts';
import { roundingMethods } from '../../platform/money/index.ts';
import {
    amountDecimalOptions,
    amountInput,
    unitAmountDecimalOptions,
} from './currency.rules.ts';
import { currencyInputSchema, currencyRowSchema } from './currency.schema.ts';

const rowSql = `select id, currency_code, amount_decimals, unit_amount_decimals,
                       trim_scale(invoice_rounding_precision)::text as invoice_rounding_precision,
                       invoice_rounding_type, version
                from currency_precisions where tenant_id = $1`;

function checked(body: unknown) {
    const parsed = currencyInputSchema.safeParse(body);
    const data = parsed.success ? parsed.data : null;
    const errors: Record<string, string> = {};
    const code = data?.currency_code.trim().toUpperCase() ?? '';
    if (!/^[A-Z]{3}$/.test(code))
        errors.currency_code = 'Isi kode mata uang tiga huruf, misalnya IDR.';
    if (!amountDecimalOptions.some((value) => value === data?.amount_decimals))
        errors.amount_decimals = 'Pilih 0 sampai 4 angka di belakang koma.';
    if (
        !unitAmountDecimalOptions.some(
            (value) => value === data?.unit_amount_decimals,
        )
    )
        errors.unit_amount_decimals =
            'Pilih 0 sampai 6 angka di belakang koma.';
    if (
        data &&
        !errors.amount_decimals &&
        !errors.unit_amount_decimals &&
        data.unit_amount_decimals < data.amount_decimals
    )
        errors.unit_amount_decimals =
            'Harga satuan tidak boleh lebih sedikit angka di belakang komanya daripada jumlah.';
    const precision = amountInput(data?.invoice_rounding_precision, 4);
    if (precision === null)
        errors.invoice_rounding_precision =
            'Isi kelipatan 0 atau lebih, misalnya 1, 100, atau 1000. Isi 0 bila tagihan tidak dibulatkan.';
    if (
        !roundingMethods.some(
            (method) => method === data?.invoice_rounding_type,
        )
    )
        errors.invoice_rounding_type = 'Pilih metode dari daftar.';
    if (Object.keys(errors).length || !data || precision === null)
        validation(errors);
    return {
        currency_code: code,
        amount_decimals: data.amount_decimals,
        unit_amount_decimals: data.unit_amount_decimals,
        invoice_rounding_precision: precision,
        invoice_rounding_type: data.invoice_rounding_type,
    };
}

function codeTaken(error: unknown): void {
    if (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes(
            'currency_precisions_tenant_id_currency_code_unique',
        )
    )
        validation({ currency_code: 'Mata uang ini sudah disetel.' });
}

// Presisi mata uang tenant (Sys Admin › Mata uang). Baris rupiah ditulis saat tenant disiapkan.
export class Currencies {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    async list() {
        this.workspace.guard('reference-data', 'read');
        return {
            data: await this.db.rows(
                currencyRowSchema,
                `${rowSql} order by currency_code`,
                [this.workspace.tenantId],
            ),
            can_manage: this.workspace.permissions.has(
                'core.reference-data.update',
            ),
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(currencyRowSchema, `${rowSql} and id = $2`, [
                  this.workspace.tenantId,
                  id,
              ])
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    async create(body: unknown) {
        this.workspace.guard('reference-data', 'update');
        const data = checked(body);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('currency_precisions', {
                id,
                tenant_id: this.workspace.tenantId,
                ...data,
                created_at: stamp,
                updated_at: stamp,
            });
        } catch (error) {
            codeTaken(error);
            throw error;
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('reference-data', 'update');
        const current = await this.row(id);
        const data = checked(body);
        let updated = 0;
        try {
            updated = await this.db.execute(
                `update currency_precisions
                 set currency_code = $1, amount_decimals = $2, unit_amount_decimals = $3,
                     invoice_rounding_precision = $4, invoice_rounding_type = $5, updated_at = $6
                 where tenant_id = $7 and id = $8 and version = $9`,
                [
                    data.currency_code,
                    data.amount_decimals,
                    data.unit_amount_decimals,
                    data.invoice_rounding_precision,
                    data.invoice_rounding_type,
                    nowSql(),
                    this.workspace.tenantId,
                    current.id,
                    expectedVersion(request, body),
                ],
            );
        } catch (error) {
            codeTaken(error);
            throw error;
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }
}
