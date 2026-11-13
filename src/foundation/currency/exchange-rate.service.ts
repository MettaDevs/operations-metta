import { z } from 'zod';
import type { Workspace } from '../../platform/access/index.ts';
import {
    nowSql,
    sqlErrorCode,
    type Database,
} from '../../platform/database/index.ts';
import {
    abort,
    coded,
    dateSchema,
    expectedVersion,
    lookupId,
    staleMessage,
    validation,
} from '../../platform/http/index.ts';
import { Decimal, localCurrencyCode } from '../../platform/money/index.ts';
import { amountInput } from './currency.rules.ts';
import {
    exchangeRateInputSchema,
    exchangeRateRowSchema,
} from './exchange-rate.schema.ts';

// Kurs disimpan dengan enam angka di belakang koma (kolom numeric(19,6)), cukup untuk mata uang yang satu satuannya
// bernilai kurang dari satu rupiah.
const rateDecimals = 6;

const rowSql = `select id, currency_code, tanggal_berlaku::text as starting_date, trim_scale(kurs)::text as rate, version
                from tbj_his_currency where tenant_id = $1 and deleted_at is null`;

function taken(error: unknown): void {
    if (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes('tbj_his_currency_tanggal_unique')
    )
        validation({
            starting_date:
                'Kurs mata uang ini untuk tanggal itu sudah ada. Ubah baris yang ada saja.',
        });
}

// Kurs mata uang asing tenant (Sys Admin › Kurs). Mata uangnya wajib sudah disetel di Mata uang, dan mata uang lokal
// tidak punya kurs karena nilainya selalu 1.
export class ExchangeRates {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    // Mata uang asing yang sudah disetel, pilihan isian Mata uang di kartu kurs.
    private async foreignCurrencies(): Promise<string[]> {
        return (
            await this.db.rows(
                z.object({ currency_code: z.string() }),
                `select currency_code from currency_precisions
                 where tenant_id = $1 and currency_code <> $2 order by currency_code`,
                [this.workspace.tenantId, localCurrencyCode],
            )
        ).map((row) => row.currency_code);
    }

    async list() {
        this.workspace.guard('reference-data', 'read');
        return {
            data: await this.db.rows(
                exchangeRateRowSchema,
                `${rowSql} order by currency_code, tanggal_berlaku desc`,
                [this.workspace.tenantId],
            ),
            currencies: await this.foreignCurrencies(),
            can_manage: this.workspace.permissions.has(
                'core.reference-data.update',
            ),
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  exchangeRateRowSchema,
                  `${rowSql} and id = $2`,
                  [this.workspace.tenantId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private async checked(body: unknown) {
        const parsed = exchangeRateInputSchema.safeParse(body);
        const data = parsed.success ? parsed.data : null;
        const errors: Record<string, string> = {};
        const code = data?.currency_code.trim().toUpperCase() ?? '';
        if (code === localCurrencyCode)
            errors.currency_code =
                'Mata uang lokal tidak punya kurs; nilainya selalu 1.';
        else if (!(await this.foreignCurrencies()).includes(code))
            errors.currency_code =
                'Pilih mata uang yang sudah disetel di Sys Admin › Mata uang.';
        if (!dateSchema.safeParse(data?.starting_date).success)
            errors.starting_date = 'Isi tanggal yang benar.';
        const rate = amountInput(data?.rate, rateDecimals);
        if (rate === null || Decimal.of(rate).compare(Decimal.of('0')) <= 0)
            errors.rate = `Isi kurs lebih dari 0, paling banyak ${rateDecimals} angka di belakang koma.`;
        if (Object.keys(errors).length || !data || rate === null)
            validation(errors);
        return {
            currency_code: code,
            tanggal_berlaku: data.starting_date,
            kurs: rate,
        };
    }

    async create(body: unknown) {
        this.workspace.guard('reference-data', 'update');
        const data = await this.checked(body);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('tbj_his_currency', {
                id,
                tenant_id: this.workspace.tenantId,
                ...data,
                created_at: stamp,
                updated_at: stamp,
            });
        } catch (error) {
            taken(error);
            throw error;
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('reference-data', 'update');
        const current = await this.row(id);
        const data = await this.checked(body);
        let updated = 0;
        try {
            updated = await this.db.execute(
                `update tbj_his_currency
                 set currency_code = $1, tanggal_berlaku = $2, kurs = $3, updated_at = $4
                 where tenant_id = $5 and id = $6 and version = $7 and deleted_at is null`,
                [
                    data.currency_code,
                    data.tanggal_berlaku,
                    data.kurs,
                    nowSql(),
                    this.workspace.tenantId,
                    current.id,
                    expectedVersion(request, body),
                ],
            );
        } catch (error) {
            taken(error);
            throw error;
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    // Pembayaran menyalin kurs yang dipakainya, jadi kurs yang dihapus tidak mengubah pembayaran yang sudah ada.
    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('reference-data', 'update');
        const current = await this.row(id);
        const deleted = await this.db.execute(
            `update tbj_his_currency set deleted_at = $1, updated_at = $1
             where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null`,
            [
                nowSql(),
                this.workspace.tenantId,
                current.id,
                expectedVersion(request, body),
            ],
        );
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }
}
