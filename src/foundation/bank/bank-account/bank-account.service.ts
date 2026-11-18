import { z } from 'zod';
import type { Workspace } from '../../../platform/access/index.ts';
import { nowSql, type Database } from '../../../platform/database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '../../../platform/http/index.ts';
import { localCurrencyCode } from '../../currency/index.ts';
import {
    activeLegalEntity,
    codeAndName,
    codeAndNameMessages,
    inUse,
    parseInput,
    violates,
} from '../../inventory/index.ts';
import {
    bankAccountInputSchema,
    bankAccountRowSchema,
} from './bank-account.schema.ts';

type Scope = { tenantId: string; legalEntityId: string };

const rowSql = `select * from (
                    select b.id, b.kode as code, b.nama as name, b.nama_bank as bank_name,
                           b.nomor_rekening as account_number, b.mata_uang as currency_code, b.diblokir as blocked,
                           b.version
                    from rekening_bank b
                    where b.tenant_id = $1 and b.legal_entity_id = $2 and b.deleted_at is null) accounts
                where true`;

const label = 'rekening';

const messages = {
    ...codeAndNameMessages(label),
    bank_name: 'Isi nama bank.',
    account_number: 'Isi nomor rekening.',
    currency_code: 'Pilih mata uang dari daftar.',
    blocked: 'Pilih diblokir atau tidak.',
};

export const bankAccountJson = (alias: string) =>
    `case when ${alias}.id is null then null else json_build_object(
         'id', ${alias}.id, 'code', ${alias}.kode, 'name', ${alias}.nama, 'bank_name', ${alias}.nama_bank,
         'account_number', ${alias}.nomor_rekening) end`;

// Seperti PostBankAcc di codeunit "Gen. Jnl.-Post Line": TestField Blocked false, lalu Currency Code kosong untuk
// jurnal tanpa mata uang.
export async function localBankAccountRefusal(
    db: Database,
    scope: Scope,
    id: string,
): Promise<string | null> {
    const account = lookupId(id)
        ? await db.one(
              z.object({
                  code: z.string(),
                  blocked: z.boolean(),
                  currency_code: z.string().nullable(),
              }),
              `select kode as code, diblokir as blocked, mata_uang as currency_code from rekening_bank
               where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null`,
              [scope.tenantId, scope.legalEntityId, id],
          )
        : undefined;
    if (!account) return 'Pilih rekening bank dari daftar.';
    if (account.blocked)
        return `Rekening ${account.code} diblokir. Pilih rekening lain, atau buka blokirnya di Sys Admin › Bank › Rekening bank.`;
    if (account.currency_code && account.currency_code !== localCurrencyCode)
        return `Rekening ${account.code} dalam ${account.currency_code}. Pilih rekening dalam mata uang lokal.`;
    return null;
}

// Rekening bank (Bank Account BC) per legal entity. Kodenya pendek dan diketik pengguna, seperti No. tanpa number
// series.
export class BankAccounts {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private get bindings() {
        return [this.workspace.tenantId, activeLegalEntity(this.workspace)];
    }

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

    private async checked(body: unknown) {
        const data = parseInput(bankAccountInputSchema, body, messages);
        const errors: Record<string, string> = {};
        const values = codeAndName(data, errors, label, {
            code: 20,
            name: 100,
        });
        const bankName = data.bank_name.trim();
        if (!bankName) errors.bank_name = messages.bank_name;
        else if (bankName.length > 100)
            errors.bank_name = 'Nama bank paling banyak 100 karakter.';
        const accountNumber = data.account_number.trim();
        if (!accountNumber) errors.account_number = messages.account_number;
        else if (accountNumber.length > 30)
            errors.account_number = 'Nomor rekening paling banyak 30 karakter.';
        const currency = data.currency_code?.trim().toUpperCase() || null;
        if (currency && !(await this.foreignCurrencies()).includes(currency))
            errors.currency_code =
                'Pilih mata uang asing yang sudah disetel di Sys Admin › Mata uang, atau kosongkan untuk mata uang lokal.';
        if (Object.keys(errors).length) validation(errors);
        return {
            kode: values.code,
            nama: values.name,
            nama_bank: bankName,
            nomor_rekening: accountNumber,
            mata_uang: currency,
            diblokir: data.blocked ?? false,
        };
    }

    private codeTaken(error: unknown): void {
        if (violates(error, 'rekening_bank_kode_unique'))
            validation({ code: 'Kode ini sudah dipakai rekening lain.' });
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('bank-account', 'read');
        const bindings = this.bindings;
        const usable =
            parameters.get('usable') === '1'
                ? ` and not blocked and coalesce(currency_code, $${bindings.push(localCurrencyCode)}) = $${bindings.length}`
                : '';
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${usable}`,
            bindings,
            parameters,
            columns: {
                code: 'code',
                name: 'name',
                bank_name: 'bank_name',
                account_number: 'account_number',
            },
            searchColumns: ['code', 'name', 'bank_name', 'account_number'],
            numericColumns: [],
            defaultSort: 'code',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => bankAccountRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has(
                'core.bank-account.update',
            ),
            local_currency: localCurrencyCode,
            currencies: await this.foreignCurrencies(),
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  bankAccountRowSchema,
                  `${rowSql} and accounts.id = $3`,
                  [...this.bindings, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    async create(body: unknown) {
        this.workspace.guard('bank-account', 'update');
        const data = await this.checked(body);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('rekening_bank', {
                id,
                tenant_id: this.workspace.tenantId,
                legal_entity_id: activeLegalEntity(this.workspace),
                ...data,
                created_at: stamp,
                updated_at: stamp,
            });
        } catch (error) {
            this.codeTaken(error);
            throw error;
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('bank-account', 'update');
        const current = await this.row(id);
        const data = await this.checked(body);
        let updated = 0;
        try {
            updated = await this.db.execute(
                `update rekening_bank
                 set kode = $1, nama = $2, nama_bank = $3, nomor_rekening = $4, mata_uang = $5, diblokir = $6,
                     updated_at = $7
                 where tenant_id = $8 and id = $9 and version = $10 and deleted_at is null`,
                [
                    data.kode,
                    data.nama,
                    data.nama_bank,
                    data.nomor_rekening,
                    data.mata_uang,
                    data.diblokir,
                    nowSql(),
                    this.workspace.tenantId,
                    current.id,
                    expectedVersion(request, body),
                ],
            );
        } catch (error) {
            this.codeTaken(error);
            throw error;
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('bank-account', 'update');
        const current = await this.row(id);
        await inUse(
            this.db,
            [
                {
                    sql: 'select 1 as found from ap_tr_pembayaran where tenant_id = $1 and rekening_bank_id = $2 and deleted_at is null limit 1',
                    message:
                        'Rekening ini sudah dipakai pembayaran ke vendor, jadi tidak bisa dihapus. Centang Diblokir bila rekening ini tidak dipakai lagi.',
                },
            ],
            [this.workspace.tenantId, current.id],
        );
        const deleted = await this.db.execute(
            `update rekening_bank set deleted_at = $1, updated_at = $1
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
