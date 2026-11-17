import { z } from 'zod';
import { refuse, type Workspace } from '../../../platform/access/index.ts';
import {
    isoSql,
    nowSql,
    type Database,
} from '../../../platform/database/index.ts';
import {
    abort,
    coded,
    dateSchema,
    expectedVersion,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '../../../platform/http/index.ts';
import { Decimal, decimalsHint } from '../../../platform/money/index.ts';
import { behaviorsSettledAs } from '../../billing/index.ts';
import {
    amountInput,
    Currency,
    localCurrencyCode,
} from '../../currency/index.ts';
import { activeLegalEntity, parseInput } from '../../inventory/index.ts';
import { NumberIssuer } from '../../number-sequence/index.ts';
import {
    openEntryChoiceSchema,
    paymentMethodChoiceSchema,
    vendorPaymentInputSchema,
    vendorPaymentLineRowSchema,
    vendorPaymentRowSchema,
    vendorPaymentStatuses,
} from './vendor-payment.schema.ts';

const numberReference = 'core.vendor-payment-number';
const sourceType = 'vendor_payment';
const zero = Decimal.of('0');

const transitions = {
    post: {
        from: 'draf',
        to: 'diposting',
        stamp: 'diposting_pada = $1, diposting_oleh_user_id = $2',
    },
    reverse: {
        from: 'diposting',
        to: 'dibatalkan',
        stamp: 'dibatalkan_pada = $1, dibatalkan_oleh_user_id = $2',
    },
} as const;

type Scope = { tenantId: string; legalEntityId: string };
type LineDraft = { id: string | null; entryId: string; amount: string };

const rowSql = `select * from (
                    select h.id, h.nomor as number, h.status, h.version,
                           json_build_object('id', v.id, 'number', v.number, 'name', p.name) as vendor,
                           p.name as vendor_name, h.tanggal::text as posting_date,
                           json_build_object('id', j.id, 'code', j.kode, 'name', j.nama) as payment_method,
                           h.bank, h.no_referensi as reference, h.keterangan as description,
                           coalesce((select trim_scale(sum(d.jumlah)) from ap_tr_pembayaran_detail d
                                     where d.tenant_id = h.tenant_id and d.pembayaran_id = h.id
                                       and d.deleted_at is null), 0)::text as amount,
                           ${isoSql('h.diposting_pada')} as posted_at, ${isoSql('h.dibatalkan_pada')} as reversed_at
                    from ap_tr_pembayaran h
                    join vendors v on v.tenant_id = h.tenant_id and v.id = h.vendor_id
                    join parties p on p.tenant_id = v.tenant_id and p.id = v.party_id
                    join jenis_bayar j on j.tenant_id = h.tenant_id and j.id = h.jenis_bayar_id
                    where h.tenant_id = $1 and h.legal_entity_id = $2 and h.deleted_at is null) payments
                where true`;

const paymentMethodSql = `select id, kode as code, nama as name from jenis_bayar
                          where tenant_id = $1 and legal_entity_id = $2 and perilaku = any($3::text[]) and aktif
                            and deleted_at is null`;

const openEntriesSql = `
    select e.id as entry_id, e.faktur_id as invoice_id, e.nomor_dokumen as document_number,
           e.no_faktur_vendor as vendor_invoice_number, e.tanggal::text as posting_date,
           e.jatuh_tempo::text as due_date, trim_scale(e.jumlah)::text as amount,
           trim_scale(e.sisa)::text as remaining,
           coalesce((select trim_scale(sum(d.jumlah)) from ap_tr_pembayaran_detail d
                     join ap_tr_pembayaran h on h.tenant_id = d.tenant_id and h.id = d.pembayaran_id
                     where d.tenant_id = e.tenant_id and d.entri_utang_id = e.id and d.deleted_at is null
                       and h.status = 'draf' and h.deleted_at is null and h.id is distinct from $4::uuid),
                    0)::text as on_drafts
    from ap_tr_entri_utang e
    where e.tenant_id = $1 and e.legal_entity_id = $2 and e.vendor_id = $3 and e.jenis = 'faktur' and e.sisa > 0`;

const messages = {
    vendor_id: 'Pilih vendor dari daftar.',
    posting_date: 'Isi tanggal bayar yang benar.',
    payment_method_id: 'Pilih cara bayar dari daftar.',
    bank: 'Isi bank paling banyak 60 karakter.',
    reference: 'Isi nomor referensi paling banyak 35 karakter.',
    description: 'Isi keterangan paling banyak 200 karakter.',
    lines: 'Satu pembayaran paling banyak 500 baris.',
    id: 'Baris ini sudah tidak ada. Muat ulang pembayaran, lalu ulangi perubahanmu.',
    entry_id:
        'Utang ini tidak bisa dibayar di sini. Ambil lagi dari Ambil utang terbuka.',
    amount: 'Isi jumlah bayar lebih dari 0.',
    version: 'Muat ulang pembayaran, lalu ulangi perubahanmu.',
};

const lockedLineSchema = z.object({
    index: z.number(),
    entry_id: z.string(),
    amount: z.string(),
    remaining: z.string(),
    kind: z.string(),
    vendor_id: z.string(),
    entry_posting_date: z.string(),
    document_number: z.string(),
});

// Pembayaran ke vendor: Payment Journal BC yang diterapkan ke entri utang vendor (Apply Entries, Applies-to ID).
export class VendorPayments {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private get scope(): Scope {
        return {
            tenantId: this.workspace.tenantId,
            legalEntityId: activeLegalEntity(this.workspace),
        };
    }

    private async amountDecimals(): Promise<number> {
        return (
            await new Currency(this.db, this.scope.tenantId).precision(
                localCurrencyCode,
            )
        ).amount_decimals;
    }

    private permissions() {
        const has = (permission: string) =>
            this.workspace.permissions.has(`core.${permission}`);
        return {
            update: has('vendor-payment.update'),
            post: has('vendor-payment.post'),
            reverse: has('vendor-payment.reverse'),
        };
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('vendor-payment', 'read');
        const bindings: string[] = [
            this.scope.tenantId,
            this.scope.legalEntityId,
        ];
        const status = z
            .enum(vendorPaymentStatuses)
            .safeParse(parameters.get('status'));
        const filter = status.success
            ? ` and status = $${bindings.push(status.data)}`
            : '';
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${filter}`,
            bindings,
            parameters,
            columns: {
                number: 'number',
                posting_date: 'posting_date',
                status: 'status',
                vendor: 'vendor_name',
            },
            searchColumns: ['number', 'vendor_name', 'reference'],
            numericColumns: [],
            defaultSort: 'posting_date',
            defaultDirection: 'desc',
        });
        return {
            data: batch.data.map((row) => vendorPaymentRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            permissions: this.permissions(),
            amount_decimals: await this.amountDecimals(),
        };
    }

    async paymentMethods() {
        this.workspace.guard('vendor-payment', 'read');
        return {
            data: await this.db.rows(
                paymentMethodChoiceSchema,
                `${paymentMethodSql} order by urutan, kode`,
                [
                    this.scope.tenantId,
                    this.scope.legalEntityId,
                    `{${behaviorsSettledAs('received').join(',')}}`,
                ],
            ),
        };
    }

    private async header(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  vendorPaymentRowSchema,
                  `${rowSql} and payments.id = $3`,
                  [this.scope.tenantId, this.scope.legalEntityId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private async document(id: string) {
        const header = await this.header(id);
        const lines = await this.db.rows(
            vendorPaymentLineRowSchema,
            `select d.id, d.urutan as line_no, d.entri_utang_id as entry_id, e.faktur_id as invoice_id,
                    e.nomor_dokumen as document_number, e.no_faktur_vendor as vendor_invoice_number,
                    e.tanggal::text as entry_posting_date, e.jatuh_tempo::text as due_date,
                    trim_scale(e.jumlah)::text as entry_amount, trim_scale(e.sisa)::text as remaining,
                    trim_scale(d.jumlah)::text as amount
             from ap_tr_pembayaran_detail d
             join ap_tr_entri_utang e on e.tenant_id = d.tenant_id and e.id = d.entri_utang_id
             where d.tenant_id = $1 and d.pembayaran_id = $2 and d.deleted_at is null
             order by d.urutan, d.id`,
            [this.scope.tenantId, header.id],
        );
        return { ...header, lines };
    }

    async show(id: string) {
        this.workspace.guard('vendor-payment', 'read');
        return {
            data: await this.document(id),
            permissions: this.permissions(),
            amount_decimals: await this.amountDecimals(),
        };
    }

    // Apply Vendor Entries.
    async openEntries(parameters: URLSearchParams) {
        this.workspace.guard('vendor-payment', 'read');
        const vendorId = parameters.get('vendor_id') ?? '';
        const paymentId = parameters.get('payment_id');
        if (!lookupId(vendorId)) validation({ vendor_id: messages.vendor_id });
        const rows = await this.db.rows(
            openEntryChoiceSchema.omit({ open: true }),
            `${openEntriesSql} order by e.jatuh_tempo, e.tanggal, e.nomor_dokumen`,
            [
                this.scope.tenantId,
                this.scope.legalEntityId,
                vendorId,
                paymentId && lookupId(paymentId) ? paymentId : null,
            ],
        );
        return {
            data: rows.flatMap((row) => {
                const open = Decimal.of(row.remaining).minus(
                    Decimal.of(row.on_drafts),
                );
                return open.compare(zero) > 0
                    ? [{ ...row, open: open.normalized() }]
                    : [];
            }),
        };
    }

    private async vendorStatus(id: string) {
        return lookupId(id)
            ? await this.db.one(
                  z.object({ status: z.string() }),
                  'select status from vendors where tenant_id = $1 and legal_entity_id = $2 and id = $3',
                  [this.scope.tenantId, this.scope.legalEntityId, id],
              )
            : undefined;
    }

    private async checked(body: unknown, paymentId: string | null) {
        const data = parseInput(vendorPaymentInputSchema, body, messages);
        const errors: Record<string, string> = {};
        const vendor = await this.vendorStatus(data.vendor_id);
        if (!vendor) errors.vendor_id = messages.vendor_id;
        else if (vendor.status !== 'active')
            errors.vendor_id =
                'Vendor ini nonaktif. Pilih vendor aktif, atau aktifkan lagi vendornya.';
        if (!dateSchema.safeParse(data.posting_date).success)
            errors.posting_date = messages.posting_date;
        const method = lookupId(data.payment_method_id)
            ? await this.db.one(
                  paymentMethodChoiceSchema,
                  `${paymentMethodSql} and id = $4`,
                  [
                      this.scope.tenantId,
                      this.scope.legalEntityId,
                      `{${behaviorsSettledAs('received').join(',')}}`,
                      data.payment_method_id,
                  ],
              )
            : undefined;
        if (!method) errors.payment_method_id = messages.payment_method_id;
        const text = (value: string | null | undefined) =>
            value?.trim() || null;
        const bank = text(data.bank);
        if (bank && bank.length > 60) errors.bank = messages.bank;
        const reference = text(data.reference);
        if (reference && reference.length > 35)
            errors.reference = messages.reference;
        const description = text(data.description);
        if (description && description.length > 200)
            errors.description = messages.description;
        const decimals = await this.amountDecimals();
        const entryIds = [
            ...new Set(
                data.lines.flatMap((line) =>
                    lookupId(line.entry_id) ? [line.entry_id] : [],
                ),
            ),
        ];
        const entries = new Map(
            entryIds.length
                ? (
                      await this.db.rows(
                          openEntryChoiceSchema.pick({
                              entry_id: true,
                              remaining: true,
                              on_drafts: true,
                          }),
                          `select * from (${openEntriesSql}) entries where entry_id = any($5::uuid[])`,
                          [
                              this.scope.tenantId,
                              this.scope.legalEntityId,
                              data.vendor_id,
                              paymentId,
                              `{${entryIds.join(',')}}`,
                          ],
                      )
                  ).map((row) => [
                      row.entry_id,
                      Decimal.of(row.remaining).minus(
                          Decimal.of(row.on_drafts),
                      ),
                  ])
                : [],
        );
        const taken = new Set<string>();
        const lines: LineDraft[] = [];
        for (const [index, line] of data.lines.entries()) {
            const fail = (name: string, message: string) => {
                errors[`lines.${index}.${name}`] = message;
            };
            const open = entries.get(line.entry_id);
            const value = amountInput(line.amount, decimals);
            if (open === undefined || taken.has(line.entry_id)) {
                fail('entry_id', messages.entry_id);
                continue;
            }
            taken.add(line.entry_id);
            if (value === null || Decimal.of(value).compare(zero) <= 0)
                fail(
                    'amount',
                    `Isi jumlah bayar lebih dari 0, ${decimalsHint(decimals)}.`,
                );
            else if (Decimal.of(value).compare(open) > 0)
                fail(
                    'amount',
                    open.compare(zero) > 0
                        ? `Paling banyak ${open.normalized()}: sisa utang yang belum dibayar.`
                        : 'Utang ini sudah ada di draf pembayaran lain.',
                );
            lines.push({
                id: line.id ?? null,
                entryId: line.entry_id,
                amount: value ?? '0',
            });
        }
        if (Object.keys(errors).length || !method) validation(errors);
        return {
            vendorId: data.vendor_id,
            postingDate: data.posting_date,
            paymentMethodId: method.id,
            bank,
            reference,
            description,
            lines,
        };
    }

    private async saveLines(paymentId: string, lines: LineDraft[]) {
        const existing = new Set(
            (
                await this.db.rows(
                    z.object({ id: z.string() }),
                    'select id from ap_tr_pembayaran_detail where tenant_id = $1 and pembayaran_id = $2 and deleted_at is null',
                    [this.scope.tenantId, paymentId],
                )
            ).map((row) => row.id),
        );
        const kept = new Set<string>();
        const stamp = nowSql();
        for (const [index, line] of lines.entries()) {
            if (line.id && existing.has(line.id)) {
                kept.add(line.id);
                await this.db.execute(
                    `update ap_tr_pembayaran_detail set urutan = $1, entri_utang_id = $2, jumlah = $3, updated_at = $4
                     where tenant_id = $5 and id = $6`,
                    [
                        index + 1,
                        line.entryId,
                        line.amount,
                        stamp,
                        this.scope.tenantId,
                        line.id,
                    ],
                );
            } else if (line.id)
                validation({ [`lines.${index}.id`]: messages.id });
            else
                await this.db.insert('ap_tr_pembayaran_detail', {
                    id: Bun.randomUUIDv7(),
                    tenant_id: this.scope.tenantId,
                    legal_entity_id: this.scope.legalEntityId,
                    pembayaran_id: paymentId,
                    urutan: index + 1,
                    entri_utang_id: line.entryId,
                    jumlah: line.amount,
                    created_at: stamp,
                    updated_at: stamp,
                });
        }
        const removed = [...existing].filter((id) => !kept.has(id));
        if (removed.length)
            await this.db.execute(
                `update ap_tr_pembayaran_detail set deleted_at = $1, updated_at = $1
                 where tenant_id = $2 and id = any($3::uuid[])`,
                [stamp, this.scope.tenantId, `{${removed.join(',')}}`],
            );
    }

    async create(body: unknown) {
        this.workspace.guard('vendor-payment', 'update');
        const data = await this.checked(body, null);
        const id = Bun.randomUUIDv7();
        await this.db.transaction(async () => {
            const number = await new NumberIssuer(this.db, {
                tenantId: this.scope.tenantId,
                moduleId: 'core',
            }).issue({
                reference: numberReference,
                key: `${sourceType}:${id}`,
                documentDate: data.postingDate,
                legalEntityId: this.scope.legalEntityId,
            });
            const stamp = nowSql();
            await this.db.insert('ap_tr_pembayaran', {
                id,
                tenant_id: this.scope.tenantId,
                legal_entity_id: this.scope.legalEntityId,
                vendor_id: data.vendorId,
                nomor: number,
                tanggal: data.postingDate,
                jenis_bayar_id: data.paymentMethodId,
                bank: data.bank,
                no_referensi: data.reference,
                keterangan: data.description,
                created_at: stamp,
                updated_at: stamp,
            });
            await this.saveLines(id, data.lines);
        });
        return {
            status: 201,
            headers: {},
            body: { data: await this.document(id) },
        };
    }

    private async lockDraft(id: string, version: number) {
        const locked = await this.db.one(
            z.object({
                status: z.enum(vendorPaymentStatuses),
                version: z.number(),
            }),
            `select status, version from ap_tr_pembayaran
             where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null for update`,
            [this.scope.tenantId, this.scope.legalEntityId, id],
        );
        if (!locked) abort(404, 'Not Found');
        if (locked.status !== 'draf')
            validation({
                _form: 'Pembayaran yang sudah diposting tidak bisa diubah atau dihapus.',
            });
        if (locked.version !== version)
            coded(409, 'stale_version', staleMessage);
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('vendor-payment', 'update');
        const current = await this.header(id);
        const data = await this.checked(body, current.id);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            await this.lockDraft(current.id, version);
            await this.db.execute(
                `update ap_tr_pembayaran set vendor_id = $1, tanggal = $2, jenis_bayar_id = $3, bank = $4,
                        no_referensi = $5, keterangan = $6, updated_at = $7
                 where tenant_id = $8 and id = $9`,
                [
                    data.vendorId,
                    data.postingDate,
                    data.paymentMethodId,
                    data.bank,
                    data.reference,
                    data.description,
                    nowSql(),
                    this.scope.tenantId,
                    current.id,
                ],
            );
            await this.saveLines(current.id, data.lines);
        });
        return {
            status: 200,
            headers: {},
            body: { data: await this.document(current.id) },
        };
    }

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('vendor-payment', 'update');
        const current = await this.header(id);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            await this.lockDraft(current.id, version);
            const stamp = nowSql();
            await this.db.execute(
                `update ap_tr_pembayaran_detail set deleted_at = $1, updated_at = $1
                 where tenant_id = $2 and pembayaran_id = $3 and deleted_at is null`,
                [stamp, this.scope.tenantId, current.id],
            );
            await this.db.execute(
                `update ap_tr_pembayaran set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3`,
                [stamp, this.scope.tenantId, current.id],
            );
        });
        return { status: 204, headers: {}, body: undefined };
    }

    private async transition(
        id: string,
        version: number,
        move: keyof typeof transitions,
    ) {
        const { from, to, stamp } = transitions[move];
        const claimed = await this.db.one(
            z.object({
                number: z.string(),
                vendor_id: z.string(),
                posting_date: z.string(),
            }),
            `update ap_tr_pembayaran set status = $3, ${stamp}, updated_at = $1
             where tenant_id = $4 and legal_entity_id = $5 and id = $6 and status = $7 and version = $8
               and deleted_at is null
             returning nomor as number, vendor_id, tanggal::text as posting_date`,
            [
                nowSql(),
                this.workspace.userId,
                to,
                this.scope.tenantId,
                this.scope.legalEntityId,
                id,
                from,
                version,
            ],
        );
        if (claimed) return claimed;
        const current = await this.db.one(
            z.object({ status: z.enum(vendorPaymentStatuses) }),
            `select status from ap_tr_pembayaran
             where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null`,
            [this.scope.tenantId, this.scope.legalEntityId, id],
        );
        if (!current) abort(404, 'Not Found');
        if (current.status === to) return null;
        if (current.status === 'dibatalkan')
            validation({ _form: 'Posting pembayaran ini sudah dibatalkan.' });
        if (current.status === 'draf')
            validation({ _form: 'Pembayaran ini belum diposting.' });
        return coded(409, 'stale_version', staleMessage);
    }

    private async lockedLines(paymentId: string) {
        return this.db.rows(
            lockedLineSchema,
            `select (d.urutan - 1)::int as index, d.entri_utang_id as entry_id, d.jumlah::text as amount,
                    e.sisa::text as remaining, e.jenis as kind, e.vendor_id, e.tanggal::text as entry_posting_date,
                    e.nomor_dokumen as document_number
             from ap_tr_pembayaran_detail d
             join ap_tr_entri_utang e on e.tenant_id = d.tenant_id and e.id = d.entri_utang_id
             where d.tenant_id = $1 and d.pembayaran_id = $2 and d.deleted_at is null
             order by e.id
             for update of e`,
            [this.scope.tenantId, paymentId],
        );
    }

    // Posting Payment Journal dengan Applies-to ID (codeunit "Gen. Jnl.-Post Line", ApplyVendLedgEntry).
    async post(request: Request, id: string, body: unknown) {
        this.workspace.guard('vendor-payment', 'post');
        const current = await this.header(id);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            const claimed = await this.transition(current.id, version, 'post');
            if (!claimed) return;
            const vendor = await this.vendorStatus(claimed.vendor_id);
            if (vendor?.status !== 'active')
                validation({
                    vendor_id:
                        'Vendor ini nonaktif, jadi pembayarannya tidak bisa diposting. Aktifkan lagi vendornya.',
                });
            const lines = await this.lockedLines(current.id);
            if (!lines.length)
                validation({
                    lines: 'Ambil sedikitnya satu utang terbuka sebelum posting.',
                });
            const errors: Record<string, string> = {};
            let total = zero;
            for (const line of lines) {
                const field = `lines.${line.index}.amount`;
                const remaining = Decimal.of(line.remaining);
                total = total.plus(Decimal.of(line.amount));
                if (
                    line.kind !== 'faktur' ||
                    line.vendor_id !== claimed.vendor_id
                )
                    errors[`lines.${line.index}.entry_id`] =
                        `${line.document_number} bukan utang vendor ini. Hapus baris ini dari pembayaran.`;
                else if (Decimal.of(line.amount).compare(remaining) > 0)
                    errors[field] =
                        remaining.compare(zero) > 0
                            ? `Paling banyak ${remaining.normalized()}: sisa utang ${line.document_number} yang belum dibayar.`
                            : `Utang ${line.document_number} sudah lunas.`;
                else if (claimed.posting_date < line.entry_posting_date)
                    errors.posting_date = `Tanggal bayar tidak boleh sebelum tanggal posting ${line.document_number}.`;
            }
            if (Object.keys(errors).length) validation(errors);
            const stamp = nowSql();
            const paymentEntryId = Bun.randomUUIDv7();
            await this.db.insert('ap_tr_entri_utang', {
                id: paymentEntryId,
                tenant_id: this.scope.tenantId,
                legal_entity_id: this.scope.legalEntityId,
                vendor_id: claimed.vendor_id,
                pembayaran_id: current.id,
                jenis: 'pembayaran',
                tanggal: claimed.posting_date,
                nomor_dokumen: claimed.number,
                jatuh_tempo: claimed.posting_date,
                jumlah: zero.minus(total).normalized(),
                sisa: 0,
                ditutup_pada: stamp,
                created_at: stamp,
                updated_at: stamp,
            });
            for (const line of lines)
                await this.db.execute(
                    `update ap_tr_entri_utang
                     set sisa = sisa - $1::numeric,
                         ditutup_oleh_entri_id = case when sisa = $1::numeric then $2::uuid end,
                         ditutup_pada = case when sisa = $1::numeric then $3::timestamp end,
                         updated_at = $3
                     where tenant_id = $4 and id = $5`,
                    [
                        line.amount,
                        paymentEntryId,
                        stamp,
                        this.scope.tenantId,
                        line.entry_id,
                    ],
                );
        });
        return {
            status: 200,
            headers: {},
            body: { data: await this.document(current.id) },
        };
    }

    // Unapply Entries lalu Reverse Transaction di BC (UnapplyAllPostedAfterThisEntryErr, codeunit 227
    // "VendEntry-Apply Posted Entries").
    async reverse(request: Request, id: string, body: unknown) {
        this.workspace.guard('vendor-payment', 'reverse');
        const current = await this.header(id);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            const claimed = await this.transition(
                current.id,
                version,
                'reverse',
            );
            if (!claimed) return;
            const entry = await this.db.one(
                z.object({ id: z.string(), amount: z.string() }),
                `select id, jumlah::text as amount from ap_tr_entri_utang
                 where tenant_id = $1 and pembayaran_id = $2 and jenis = 'pembayaran' for update`,
                [this.scope.tenantId, current.id],
            );
            if (!entry)
                abort(409, 'Entri utang pembayaran ini tidak ditemukan.');
            const lines = await this.lockedLines(current.id);
            const later = await this.db.one(
                z.object({ id: z.string(), number: z.string() }),
                `select h.id, h.nomor as number
                 from ap_tr_pembayaran_detail d
                 join ap_tr_pembayaran h on h.tenant_id = d.tenant_id and h.id = d.pembayaran_id
                 join ap_tr_entri_utang p on p.tenant_id = h.tenant_id and p.pembayaran_id = h.id
                                         and p.jenis = 'pembayaran'
                 where d.tenant_id = $1 and d.entri_utang_id = any($2::uuid[]) and d.deleted_at is null
                   and h.status = 'diposting' and h.id <> $3 and p.id > $4
                 order by p.id desc limit 1`,
                [
                    this.scope.tenantId,
                    `{${lines.map((line) => line.entry_id).join(',')}}`,
                    current.id,
                    entry.id,
                ],
            );
            if (later)
                await refuse(this.db, this.workspace, {
                    message: `Utang yang dibayar di sini sudah dibayar lagi di ${later.number}, jadi pembayaran ini belum bisa dibatalkan. Batalkan posting ${later.number} lebih dulu.`,
                    open: {
                        page: 'core.vendor-payment',
                        recordId: later.id,
                        label: `Buka pembayaran ${later.number}`,
                    },
                    otherwise: `Minta petugas pembelian membatalkan posting pembayaran ${later.number} lebih dulu.`,
                });
            const stamp = nowSql();
            for (const line of lines)
                await this.db.execute(
                    `update ap_tr_entri_utang
                     set sisa = sisa + $1::numeric, ditutup_oleh_entri_id = null, ditutup_pada = null, updated_at = $2
                     where tenant_id = $3 and id = $4`,
                    [line.amount, stamp, this.scope.tenantId, line.entry_id],
                );
            const reversalId = Bun.randomUUIDv7();
            await this.db.insert('ap_tr_entri_utang', {
                id: reversalId,
                tenant_id: this.scope.tenantId,
                legal_entity_id: this.scope.legalEntityId,
                vendor_id: claimed.vendor_id,
                pembayaran_id: current.id,
                jenis: 'pembatalan_pembayaran',
                tanggal: claimed.posting_date,
                nomor_dokumen: claimed.number,
                jatuh_tempo: claimed.posting_date,
                jumlah: zero.minus(Decimal.of(entry.amount)).normalized(),
                sisa: 0,
                ditutup_oleh_entri_id: entry.id,
                ditutup_pada: stamp,
                created_at: stamp,
                updated_at: stamp,
            });
            await this.db.execute(
                `update ap_tr_entri_utang set ditutup_oleh_entri_id = $1, updated_at = $2
                 where tenant_id = $3 and id = $4`,
                [reversalId, stamp, this.scope.tenantId, entry.id],
            );
        });
        return {
            status: 200,
            headers: {},
            body: { data: await this.document(current.id) },
        };
    }
}

// TestIfInvoiceIsPaid di codeunit "Correct Posted Purch. Invoice".
export async function refusePaidEntry(
    db: Database,
    workspace: Workspace,
    entryId: string,
): Promise<void> {
    const payment = await db.one(
        z.object({ id: z.string(), number: z.string() }),
        `select h.id, h.nomor as number
         from ap_tr_pembayaran_detail d
         join ap_tr_pembayaran h on h.tenant_id = d.tenant_id and h.id = d.pembayaran_id
         where d.tenant_id = $1 and d.entri_utang_id = $2 and d.deleted_at is null and h.status = 'diposting'
         order by h.diposting_pada desc, h.id desc limit 1`,
        [workspace.tenantId, entryId],
    );
    const message =
        'Utang faktur ini sudah dibayar sebagian atau lunas, jadi postingnya tidak bisa dibatalkan.';
    if (!payment) validation({ _form: message });
    await refuse(db, workspace, {
        message: `${message} Batalkan posting pembayaran ${payment.number} lebih dulu.`,
        open: {
            page: 'core.vendor-payment',
            recordId: payment.id,
            label: `Buka pembayaran ${payment.number}`,
        },
        otherwise: `Minta petugas pembelian membatalkan posting pembayaran ${payment.number} lebih dulu.`,
    });
}
