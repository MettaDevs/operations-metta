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
import {
    decimalsHint,
    percentHint,
    percentInput,
} from '../../../platform/money/index.ts';
import {
    Currency,
    localCurrencyCode,
    unitAmountDecimals,
    type AmountDecimals,
} from '../../currency/index.ts';
import {
    activeLegalEntity,
    allowedLocationsSql,
    decimalInput,
    display,
    fromNumeric,
    parseInput,
    quantityHint,
    quantityScale,
    requireLocationAccess,
    toNumeric,
    unitCostInput,
    violates,
} from '../../inventory/index.ts';
import { NumberIssuer } from '../../number-sequence/index.ts';
import { documentTotals } from '../purchase-line.amounts.ts';
import {
    pricedLinesSchema,
    pricedLinesSql,
    withAmount,
    withTotals,
} from '../purchase-line.service.ts';
import {
    invoiceLineChoiceSchema,
    openInvoiceEntryChoiceSchema,
    purchaseCreditMemoInputSchema,
    purchaseCreditMemoLineRowSchema,
    purchaseCreditMemoRowSchema,
    purchaseCreditMemoStatuses,
    returnLineChoiceSchema,
} from './purchase-credit-memo.schema.ts';

const numberReference = 'core.purchase-credit-memo-number';
const sourceType = 'purchase_credit_memo';
const hundredPercent = 100n * 10n ** BigInt(quantityScale);
const quantityText = (value: bigint) => display(value, quantityScale);
const scaled = (value: string) => fromNumeric(value, quantityScale);

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

type LineDraft = {
    id: string | null;
    kind: 'retur' | 'potongan';
    returnLineId: string | null;
    invoiceLineId: string | null;
    description: string | null;
    quantity: bigint;
    unitCost: bigint;
    discountPercent: bigint;
    vatPercent: bigint;
};

const storedRowSchema = purchaseCreditMemoRowSchema
    .omit({ amount: true, vat_amount: true })
    .extend({ priced_lines: pricedLinesSchema });

const rowSql = `select * from (
                    select h.id, h.nomor as number, h.status, h.version,
                           json_build_object('id', v.id, 'number', v.number, 'name', p.name) as vendor,
                           p.name as vendor_name, h.no_nota_vendor as vendor_credit_memo_number,
                           h.tanggal_nota::text as document_date, h.tanggal::text as posting_date,
                           case when a.id is null then null else json_build_object(
                               'id', a.id, 'document_number', a.nomor_dokumen,
                               'vendor_invoice_number', a.no_dokumen_vendor, 'invoice_id', a.faktur_id) end
                               as applies_to,
                           h.keterangan as description,
                           ${pricedLinesSql('ap_tr_nota_kredit_detail', 'nota_kredit_id', 'h')} as priced_lines,
                           (select trim_scale(-e.sisa)::text from ap_tr_entri_utang e
                            where e.tenant_id = h.tenant_id and e.nota_kredit_id = h.id and e.jenis = 'nota_kredit')
                               as remaining,
                           ${isoSql('h.diposting_pada')} as posted_at, ${isoSql('h.dibatalkan_pada')} as reversed_at
                    from ap_tr_nota_kredit h
                    join vendors v on v.tenant_id = h.tenant_id and v.id = h.vendor_id
                    join parties p on p.tenant_id = v.tenant_id and p.id = v.party_id
                    left join ap_tr_entri_utang a on a.tenant_id = h.tenant_id and a.id = h.entri_utang_tujuan_id
                    where h.tenant_id = $1 and h.legal_entity_id = $2 and h.deleted_at is null) memos
                where true`;

const messages = {
    vendor_id: 'Pilih vendor dari daftar.',
    vendor_credit_memo_number:
        'Isi nomor nota kredit dari vendor, paling banyak 35 karakter.',
    document_date: 'Isi tanggal nota vendor yang benar.',
    posting_date: 'Isi tanggal posting yang benar.',
    applies_to_entry_id:
        'Pilih faktur yang masih punya sisa utang di vendor yang sama.',
    description: 'Isi keterangan paling banyak 200 karakter.',
    lines: 'Satu nota kredit paling banyak 500 baris.',
    id: 'Baris ini sudah tidak ada. Muat ulang nota kredit, lalu ulangi perubahanmu.',
    kind: 'Pilih jenis baris retur atau potongan harga.',
    return_line_id:
        'Baris retur ini tidak bisa dikreditkan. Ambil lagi dari Ambil baris retur.',
    invoice_line_id:
        'Baris faktur ini tidak bisa diberi potongan. Pilih lagi dari Potongan harga.',
    quantity: `Isi jumlah lebih dari 0, ${quantityHint}.`,
    unit_cost: 'Isi harga satuan 0 atau lebih.',
    discount_percent: 'Isi diskon 0 sampai 100 persen.',
    vat_percent: percentHint(),
    version: 'Muat ulang nota kredit, lalu ulangi perubahanmu.',
};

const returnLinesSql = (location: string) => `
    select rd.id as return_line_id,
           json_build_object('id', rt.id, 'number', rt.nomor, 'posting_date', rt.tanggal::text) as return,
           json_build_object('id', r.id, 'number', r.nomor) as receipt,
           json_build_object('id', b.id, 'code', b.kode, 'name', b.nama) as item,
           json_build_object('id', u.id, 'code', u.kode, 'name', u.nama) as unit,
           rd.jumlah::text as returned, rd.jumlah_dikredit::text as credited,
           coalesce((select sum(c.jumlah) from ap_tr_nota_kredit_detail c
                     join ap_tr_nota_kredit ch on ch.tenant_id = c.tenant_id and ch.id = c.nota_kredit_id
                     where c.tenant_id = rd.tenant_id and c.retur_detail_id = rd.id and c.deleted_at is null
                       and ch.status = 'draf' and ch.deleted_at is null and ch.id is distinct from $4::uuid),
                    0)::text as on_drafts,
           round(d.harga_satuan * rd.konversi / d.konversi, 4)::text as unit_cost,
           d.diskon_persen::text as discount_percent, d.tarif_ppn::text as vat_percent, r.lokasi_id as location_id
    from bl_tr_retur_detail rd
    join bl_tr_retur rt on rt.tenant_id = rd.tenant_id and rt.id = rd.retur_id
    join bl_tr_penerimaan_detail d on d.tenant_id = rd.tenant_id and d.id = rd.penerimaan_detail_id
    join bl_tr_penerimaan r on r.tenant_id = d.tenant_id and r.id = d.penerimaan_id
    join gd_m_barang b on b.tenant_id = rd.tenant_id and b.id = rd.barang_id
    join gd_m_satuan u on u.tenant_id = rd.tenant_id and u.id = rd.satuan_id
    where rd.tenant_id = $1 and rt.legal_entity_id = $2 and r.vendor_id = $3 and rt.status = 'diposting'
      and rt.deleted_at is null and rd.deleted_at is null and rd.jumlah_dikredit < rd.jumlah and ${location}`;

const invoiceLinesSql = `
    select f.id as invoice_line_id,
           json_build_object('id', h.id, 'number', h.nomor, 'vendor_invoice_number', h.no_faktur_vendor,
                             'posting_date', h.tanggal::text) as invoice,
           f.jenis as kind, coalesce(b.nama, f.keterangan) as description,
           case when u.id is null then null
                else json_build_object('id', u.id, 'code', u.kode, 'name', u.nama) end as unit,
           trim_scale(f.jumlah)::text as quantity, trim_scale(f.harga_satuan)::text as unit_cost,
           trim_scale(f.diskon_persen)::text as discount_percent, trim_scale(f.tarif_ppn)::text as vat_percent
    from ap_tr_faktur_detail f
    join ap_tr_faktur h on h.tenant_id = f.tenant_id and h.id = f.faktur_id
    left join bl_tr_penerimaan_detail d on d.tenant_id = f.tenant_id and d.id = f.penerimaan_detail_id
    left join gd_m_barang b on b.tenant_id = d.tenant_id and b.id = d.barang_id
    left join gd_m_satuan u on u.tenant_id = d.tenant_id and u.id = d.satuan_id
    where f.tenant_id = $1 and h.legal_entity_id = $2 and h.vendor_id = $3 and h.status = 'diposting'
      and h.deleted_at is null and f.deleted_at is null`;

const openInvoiceEntriesSql = `
    select e.id as entry_id, e.faktur_id as invoice_id, e.nomor_dokumen as document_number,
           e.no_dokumen_vendor as vendor_invoice_number, e.jatuh_tempo::text as due_date,
           trim_scale(e.sisa)::text as remaining, e.tanggal::text as posting_date
    from ap_tr_entri_utang e
    where e.tenant_id = $1 and e.legal_entity_id = $2 and e.vendor_id = $3 and e.jenis = 'faktur' and e.sisa > 0`;

const storedReturnLineSchema = z.object({
    return_line_id: z.string(),
    returned: z.string(),
    credited: z.string(),
    on_drafts: z.string(),
    location_id: z.string(),
});

// Purchase Credit Memo di BC.
export class PurchaseCreditMemos {
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

    private async precision() {
        return new Currency(this.db, this.scope.tenantId).precision(
            localCurrencyCode,
        );
    }

    private async amountDecimals(): Promise<AmountDecimals> {
        return (await this.precision()).amount_decimals;
    }

    private permissions() {
        const has = (permission: string) =>
            this.workspace.permissions.has(`core.${permission}`);
        return {
            update: has('purchase-credit-memo.update'),
            post: has('purchase-credit-memo.post'),
            reverse: has('purchase-credit-memo.reverse'),
        };
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('purchase-credit-memo', 'read');
        const bindings: string[] = [
            this.scope.tenantId,
            this.scope.legalEntityId,
        ];
        const status = z
            .enum(purchaseCreditMemoStatuses)
            .safeParse(parameters.get('status'));
        const filter = status.success
            ? ` and status = $${bindings.push(status.data)}`
            : '';
        const amountDecimals = await this.amountDecimals();
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${filter}`,
            bindings,
            parameters,
            columns: {
                number: 'number',
                document_date: 'document_date',
                status: 'status',
                vendor: 'vendor_name',
            },
            searchColumns: [
                'number',
                'vendor_name',
                'vendor_credit_memo_number',
            ],
            numericColumns: [],
            defaultSort: 'document_date',
            defaultDirection: 'desc',
        });
        return {
            data: batch.data.map((row) =>
                withTotals(storedRowSchema.parse(row), amountDecimals),
            ),
            next_cursor: batch.next_cursor,
            permissions: this.permissions(),
            amount_decimals: amountDecimals,
        };
    }

    private async header(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  storedRowSchema,
                  `${rowSql} and memos.id = $3`,
                  [this.scope.tenantId, this.scope.legalEntityId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return withTotals(found, await this.amountDecimals());
    }

    private async document(id: string) {
        const header = await this.header(id);
        const decimals = await this.amountDecimals();
        const lines = await this.db.rows(
            purchaseCreditMemoLineRowSchema.omit({ amount: true }),
            `select c.id, c.urutan as line_no, c.jenis as kind, c.keterangan as description,
                    c.retur_detail_id as return_line_id,
                    case when rt.id is null then null
                         else json_build_object('id', rt.id, 'number', rt.nomor) end as return,
                    c.faktur_detail_id as invoice_line_id,
                    case when fh.id is null then null
                         else json_build_object('id', fh.id, 'number', fh.nomor) end as invoice,
                    case when b.id is null then null
                         else json_build_object('id', b.id, 'code', b.kode, 'name', b.nama) end as item,
                    case when u.id is null then null
                         else json_build_object('id', u.id, 'code', u.kode, 'name', u.nama) end as unit,
                    trim_scale(c.jumlah)::text as quantity, trim_scale(c.harga_satuan)::text as unit_cost,
                    trim_scale(c.diskon_persen)::text as discount_percent,
                    trim_scale(c.tarif_ppn)::text as vat_percent
             from ap_tr_nota_kredit_detail c
             left join bl_tr_retur_detail rd on rd.tenant_id = c.tenant_id and rd.id = c.retur_detail_id
             left join bl_tr_retur rt on rt.tenant_id = rd.tenant_id and rt.id = rd.retur_id
             left join ap_tr_faktur_detail f on f.tenant_id = c.tenant_id and f.id = c.faktur_detail_id
             left join ap_tr_faktur fh on fh.tenant_id = f.tenant_id and fh.id = f.faktur_id
             left join bl_tr_penerimaan_detail d on d.tenant_id = c.tenant_id
                                                and d.id = coalesce(rd.penerimaan_detail_id, f.penerimaan_detail_id)
             left join gd_m_barang b on b.tenant_id = c.tenant_id and b.id = coalesce(rd.barang_id, d.barang_id)
             left join gd_m_satuan u on u.tenant_id = c.tenant_id and u.id = coalesce(rd.satuan_id, d.satuan_id)
             where c.tenant_id = $1 and c.nota_kredit_id = $2 and c.deleted_at is null
             order by c.urutan, c.id`,
            [this.scope.tenantId, header.id],
        );
        return {
            ...header,
            lines: lines.map((line) => withAmount(line, decimals)),
        };
    }

    async show(id: string) {
        this.workspace.guard('purchase-credit-memo', 'read');
        return {
            data: await this.document(id),
            permissions: this.permissions(),
            amount_decimals: await this.amountDecimals(),
        };
    }

    private sourceBindings(parameters: URLSearchParams) {
        const vendorId = parameters.get('vendor_id') ?? '';
        const memoId = parameters.get('credit_memo_id');
        if (!lookupId(vendorId)) validation({ vendor_id: messages.vendor_id });
        return [
            this.scope.tenantId,
            this.scope.legalEntityId,
            vendorId,
            memoId && lookupId(memoId) ? memoId : null,
        ];
    }

    // Get Return Shipment Lines (codeunit 6648 "Purch.-Get Return Shipments").
    async returnLines(parameters: URLSearchParams) {
        this.workspace.guard('purchase-credit-memo', 'read');
        const bindings = this.sourceBindings(parameters);
        const rows = await this.db.rows(
            returnLineChoiceSchema.omit({ open: true }),
            `${returnLinesSql(allowedLocationsSql(this.workspace, bindings, ['r.lokasi_id']))}
             order by rt.tanggal, rt.nomor, rd.urutan`,
            bindings,
        );
        const text = (value: string) => quantityText(scaled(value));
        return {
            data: rows.flatMap((row) => {
                const open =
                    scaled(row.returned) -
                    scaled(row.credited) -
                    scaled(row.on_drafts);
                if (open <= 0n) return [];
                return [
                    {
                        ...row,
                        returned: text(row.returned),
                        credited: text(row.credited),
                        on_drafts: text(row.on_drafts),
                        unit_cost: text(row.unit_cost),
                        discount_percent: text(row.discount_percent),
                        vat_percent: text(row.vat_percent),
                        open: quantityText(open),
                    },
                ];
            }),
        };
    }

    async invoiceLines(parameters: URLSearchParams) {
        this.workspace.guard('purchase-credit-memo', 'read');
        const bindings = this.sourceBindings(parameters).slice(0, 3);
        return {
            data: await this.db.rows(
                invoiceLineChoiceSchema,
                `${invoiceLinesSql} order by h.tanggal desc, h.nomor desc, f.urutan`,
                bindings,
            ),
        };
    }

    async openInvoiceEntries(parameters: URLSearchParams) {
        this.workspace.guard('purchase-credit-memo', 'read');
        const bindings = this.sourceBindings(parameters).slice(0, 3);
        return {
            data: await this.db.rows(
                openInvoiceEntryChoiceSchema,
                `${openInvoiceEntriesSql} order by e.jatuh_tempo, e.tanggal, e.nomor_dokumen`,
                bindings,
            ),
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

    private async returnLineMap(
        vendorId: string,
        memoId: string | null,
        ids: string[],
    ) {
        if (!ids.length) return new Map<string, ReturnLineInfo>();
        const rows = await this.db.rows(
            storedReturnLineSchema,
            `select * from (${returnLinesSql('true')}) lines where return_line_id = any($5::uuid[])`,
            [
                this.scope.tenantId,
                this.scope.legalEntityId,
                vendorId,
                memoId,
                `{${ids.join(',')}}`,
            ],
        );
        return new Map(
            rows.map((row) => [
                row.return_line_id,
                {
                    locationId: row.location_id,
                    open:
                        scaled(row.returned) -
                        scaled(row.credited) -
                        scaled(row.on_drafts),
                },
            ]),
        );
    }

    private async invoiceLineMap(vendorId: string, ids: string[]) {
        if (!ids.length) return new Map<string, bigint>();
        const rows = await this.db.rows(
            z.object({ invoice_line_id: z.string(), quantity: z.string() }),
            `select * from (${invoiceLinesSql}) lines where invoice_line_id = any($4::uuid[])`,
            [
                this.scope.tenantId,
                this.scope.legalEntityId,
                vendorId,
                `{${ids.join(',')}}`,
            ],
        );
        return new Map(
            rows.map((row) => [row.invoice_line_id, scaled(row.quantity)]),
        );
    }

    private async appliesToEntry(vendorId: string, entryId: string) {
        return lookupId(entryId)
            ? await this.db.one(
                  z.object({ entry_id: z.string(), posting_date: z.string() }),
                  `select * from (${openInvoiceEntriesSql}) entries where entry_id = $4`,
                  [
                      this.scope.tenantId,
                      this.scope.legalEntityId,
                      vendorId,
                      entryId,
                  ],
              )
            : undefined;
    }

    private async checked(body: unknown, memoId: string | null) {
        const data = parseInput(purchaseCreditMemoInputSchema, body, messages);
        const errors: Record<string, string> = {};
        const vendor = await this.vendorStatus(data.vendor_id);
        if (!vendor) errors.vendor_id = messages.vendor_id;
        else if (vendor.status !== 'active')
            errors.vendor_id =
                'Vendor ini nonaktif. Pilih vendor aktif, atau aktifkan lagi vendornya.';
        const vendorNumber = data.vendor_credit_memo_number.trim();
        if (!vendorNumber || vendorNumber.length > 35)
            errors.vendor_credit_memo_number =
                messages.vendor_credit_memo_number;
        if (!dateSchema.safeParse(data.document_date).success)
            errors.document_date = messages.document_date;
        if (!dateSchema.safeParse(data.posting_date).success)
            errors.posting_date = messages.posting_date;
        const appliesTo = data.applies_to_entry_id || null;
        if (
            appliesTo &&
            !(await this.appliesToEntry(data.vendor_id, appliesTo))
        )
            errors.applies_to_entry_id = messages.applies_to_entry_id;
        const description = data.description?.trim() || null;
        if (description && description.length > 200)
            errors.description = messages.description;
        const unitCostDecimals = unitAmountDecimals(await this.precision());
        const ids = (kind: 'retur' | 'potongan') => [
            ...new Set(
                data.lines.flatMap((line) => {
                    if (line.kind !== kind) return [];
                    const id =
                        line.kind === 'retur'
                            ? line.return_line_id
                            : line.invoice_line_id;
                    return lookupId(id) ? [id] : [];
                }),
            ),
        ];
        const returnLines = await this.returnLineMap(
            data.vendor_id,
            memoId,
            ids('retur'),
        );
        const invoiceLines = await this.invoiceLineMap(
            data.vendor_id,
            ids('potongan'),
        );
        const taken = new Set<string>();
        const lines: LineDraft[] = [];
        for (const [index, line] of data.lines.entries()) {
            const fail = (name: string, message: string) => {
                errors[`lines.${index}.${name}`] = message;
            };
            const unitCost = unitCostInput(line.unit_cost, unitCostDecimals);
            if (unitCost === null)
                fail(
                    'unit_cost',
                    `Isi harga satuan 0 atau lebih, ${decimalsHint(unitCostDecimals)}.`,
                );
            const discount =
                line.discount_percent === null ||
                line.discount_percent === undefined ||
                line.discount_percent === ''
                    ? 0n
                    : decimalInput(line.discount_percent);
            if (discount === null || discount < 0n || discount > hundredPercent)
                fail('discount_percent', messages.discount_percent);
            const vat = percentInput(line.vat_percent || 0);
            if (vat === null) fail('vat_percent', messages.vat_percent);
            const quantity = decimalInput(line.quantity);
            const quantityValid = quantity !== null && quantity > 0n;
            if (!quantityValid) fail('quantity', messages.quantity);
            let returnLineId: string | null = null;
            let invoiceLineId: string | null = null;
            let lineDescription: string | null = null;
            if (line.kind === 'retur') {
                const found = returnLines.get(line.return_line_id);
                if (!found || taken.has(line.return_line_id))
                    fail('return_line_id', messages.return_line_id);
                else if (quantityValid && quantity > found.open)
                    fail(
                        'quantity',
                        found.open > 0n
                            ? `Paling banyak ${quantityText(found.open)}: sisa yang diretur dan belum dikreditkan.`
                            : 'Baris retur ini sudah dikreditkan seluruhnya, atau sudah ada di draf nota kredit lain.',
                    );
                else {
                    await requireLocationAccess(this.db, this.workspace, [
                        found.locationId,
                    ]);
                    taken.add(line.return_line_id);
                    returnLineId = line.return_line_id;
                }
            } else {
                const invoiced = invoiceLines.get(line.invoice_line_id);
                if (invoiced === undefined)
                    fail('invoice_line_id', messages.invoice_line_id);
                else if (quantityValid && quantity > invoiced)
                    fail(
                        'quantity',
                        `Paling banyak ${quantityText(invoiced)}: jumlah di baris faktur.`,
                    );
                else invoiceLineId = line.invoice_line_id;
                lineDescription = line.description.trim() || null;
                if (!lineDescription || lineDescription.length > 200)
                    fail(
                        'description',
                        'Tulis alasan potongan, misalnya selisih harga, paling banyak 200 karakter.',
                    );
            }
            lines.push({
                id: line.id ?? null,
                kind: line.kind,
                returnLineId,
                invoiceLineId,
                description: lineDescription,
                quantity: quantity ?? 0n,
                unitCost: unitCost ?? 0n,
                discountPercent: discount ?? 0n,
                vatPercent: vat === null ? 0n : scaled(vat),
            });
        }
        if (Object.keys(errors).length || !vendor) validation(errors);
        return {
            vendorId: data.vendor_id,
            vendorNumber,
            documentDate: data.document_date,
            postingDate: data.posting_date,
            appliesTo,
            description,
            lines,
        };
    }

    private vendorNumberTaken(error: unknown): void {
        if (violates(error, 'ap_tr_nota_kredit_no_nota_vendor_unique'))
            validation({
                vendor_credit_memo_number:
                    'Nomor nota kredit ini sudah dicatat untuk vendor yang sama. Periksa daftar nota kredit pembelian.',
            });
    }

    private async saveLines(memoId: string, lines: LineDraft[]) {
        const existing = new Set(
            (
                await this.db.rows(
                    z.object({ id: z.string() }),
                    'select id from ap_tr_nota_kredit_detail where tenant_id = $1 and nota_kredit_id = $2 and deleted_at is null',
                    [this.scope.tenantId, memoId],
                )
            ).map((row) => row.id),
        );
        const kept = new Set<string>();
        const stamp = nowSql();
        for (const [index, line] of lines.entries()) {
            const values = {
                urutan: index + 1,
                jenis: line.kind,
                retur_detail_id: line.returnLineId,
                faktur_detail_id: line.invoiceLineId,
                keterangan: line.description,
                jumlah: toNumeric(line.quantity, quantityScale),
                harga_satuan: toNumeric(line.unitCost, quantityScale),
                diskon_persen: toNumeric(line.discountPercent, quantityScale),
                tarif_ppn: toNumeric(line.vatPercent, quantityScale),
            };
            if (line.id && existing.has(line.id)) {
                kept.add(line.id);
                await this.db.execute(
                    `update ap_tr_nota_kredit_detail set urutan = $1, jenis = $2, retur_detail_id = $3,
                            faktur_detail_id = $4, keterangan = $5, jumlah = $6, harga_satuan = $7,
                            diskon_persen = $8, tarif_ppn = $9, updated_at = $10
                     where tenant_id = $11 and id = $12`,
                    [
                        values.urutan,
                        values.jenis,
                        values.retur_detail_id,
                        values.faktur_detail_id,
                        values.keterangan,
                        values.jumlah,
                        values.harga_satuan,
                        values.diskon_persen,
                        values.tarif_ppn,
                        stamp,
                        this.scope.tenantId,
                        line.id,
                    ],
                );
            } else if (line.id)
                validation({ [`lines.${index}.id`]: messages.id });
            else
                await this.db.insert('ap_tr_nota_kredit_detail', {
                    id: Bun.randomUUIDv7(),
                    tenant_id: this.scope.tenantId,
                    legal_entity_id: this.scope.legalEntityId,
                    nota_kredit_id: memoId,
                    ...values,
                    created_at: stamp,
                    updated_at: stamp,
                });
        }
        const removed = [...existing].filter((id) => !kept.has(id));
        if (removed.length)
            await this.db.execute(
                `update ap_tr_nota_kredit_detail set deleted_at = $1, updated_at = $1
                 where tenant_id = $2 and id = any($3::uuid[])`,
                [stamp, this.scope.tenantId, `{${removed.join(',')}}`],
            );
    }

    async create(body: unknown) {
        this.workspace.guard('purchase-credit-memo', 'update');
        const data = await this.checked(body, null);
        const id = Bun.randomUUIDv7();
        try {
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
                await this.db.insert('ap_tr_nota_kredit', {
                    id,
                    tenant_id: this.scope.tenantId,
                    legal_entity_id: this.scope.legalEntityId,
                    vendor_id: data.vendorId,
                    nomor: number,
                    no_nota_vendor: data.vendorNumber,
                    tanggal_nota: data.documentDate,
                    tanggal: data.postingDate,
                    entri_utang_tujuan_id: data.appliesTo,
                    keterangan: data.description,
                    created_at: stamp,
                    updated_at: stamp,
                });
                await this.saveLines(id, data.lines);
            });
        } catch (error) {
            this.vendorNumberTaken(error);
            throw error;
        }
        return {
            status: 201,
            headers: {},
            body: { data: await this.document(id) },
        };
    }

    private async lockHeader(id: string) {
        const locked = await this.db.one(
            z.object({
                status: z.enum(purchaseCreditMemoStatuses),
                version: z.number(),
            }),
            `select status, version from ap_tr_nota_kredit
             where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null for update`,
            [this.scope.tenantId, this.scope.legalEntityId, id],
        );
        if (!locked) abort(404, 'Not Found');
        return locked;
    }

    private async lockDraft(id: string, version: number) {
        const locked = await this.lockHeader(id);
        if (locked.status !== 'draf')
            validation({
                _form: 'Nota kredit yang sudah diposting tidak bisa diubah atau dihapus.',
            });
        if (locked.version !== version)
            coded(409, 'stale_version', staleMessage);
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('purchase-credit-memo', 'update');
        const current = await this.header(id);
        const data = await this.checked(body, current.id);
        const version = expectedVersion(request, body);
        try {
            await this.db.transaction(async () => {
                await this.lockDraft(current.id, version);
                await this.db.execute(
                    `update ap_tr_nota_kredit set vendor_id = $1, no_nota_vendor = $2, tanggal_nota = $3, tanggal = $4,
                            entri_utang_tujuan_id = $5, keterangan = $6, updated_at = $7
                     where tenant_id = $8 and id = $9`,
                    [
                        data.vendorId,
                        data.vendorNumber,
                        data.documentDate,
                        data.postingDate,
                        data.appliesTo,
                        data.description,
                        nowSql(),
                        this.scope.tenantId,
                        current.id,
                    ],
                );
                await this.saveLines(current.id, data.lines);
            });
        } catch (error) {
            this.vendorNumberTaken(error);
            throw error;
        }
        return {
            status: 200,
            headers: {},
            body: { data: await this.document(current.id) },
        };
    }

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('purchase-credit-memo', 'update');
        const current = await this.header(id);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            await this.lockDraft(current.id, version);
            const stamp = nowSql();
            await this.db.execute(
                `update ap_tr_nota_kredit_detail set deleted_at = $1, updated_at = $1
                 where tenant_id = $2 and nota_kredit_id = $3 and deleted_at is null`,
                [stamp, this.scope.tenantId, current.id],
            );
            await this.db.execute(
                `update ap_tr_nota_kredit set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3`,
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
                vendor_credit_memo_number: z.string(),
                document_date: z.string(),
                posting_date: z.string(),
                applies_to_entry_id: z.string().nullable(),
            }),
            `update ap_tr_nota_kredit set status = $3, ${stamp}, updated_at = $1
             where tenant_id = $4 and legal_entity_id = $5 and id = $6 and status = $7 and version = $8
               and deleted_at is null
             returning nomor as number, vendor_id, no_nota_vendor as vendor_credit_memo_number,
                       tanggal_nota::text as document_date, tanggal::text as posting_date,
                       entri_utang_tujuan_id as applies_to_entry_id`,
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
        const current = await this.lockHeader(id);
        if (current.status === to) return null;
        if (current.status === 'dibatalkan')
            validation({ _form: 'Posting nota kredit ini sudah dibatalkan.' });
        if (current.status === 'draf')
            validation({ _form: 'Nota kredit ini belum diposting.' });
        return coded(409, 'stale_version', staleMessage);
    }

    private async lockedReturnLines(memoId: string) {
        return this.db.rows(
            z.object({
                index: z.number(),
                return_line_id: z.string(),
                quantity: z.string(),
                returned: z.string(),
                credited: z.string(),
                return_status: z.string(),
                return_number: z.string(),
                receipt_vendor_id: z.string(),
                location_id: z.string(),
            }),
            `select (c.urutan - 1)::int as index, c.retur_detail_id as return_line_id, c.jumlah::text as quantity,
                    rd.jumlah::text as returned, rd.jumlah_dikredit::text as credited, rt.status as return_status,
                    rt.nomor as return_number, r.vendor_id as receipt_vendor_id, r.lokasi_id as location_id
             from ap_tr_nota_kredit_detail c
             join bl_tr_retur_detail rd on rd.tenant_id = c.tenant_id and rd.id = c.retur_detail_id
             join bl_tr_retur rt on rt.tenant_id = rd.tenant_id and rt.id = rd.retur_id
             join bl_tr_penerimaan r on r.tenant_id = rt.tenant_id and r.id = rt.penerimaan_id
             where c.tenant_id = $1 and c.nota_kredit_id = $2 and c.deleted_at is null and c.jenis = 'retur'
             order by rd.id
             for update of rd`,
            [this.scope.tenantId, memoId],
        );
    }

    private async total(memoId: string): Promise<string> {
        const lines = await this.db.rows(
            pricedLinesSchema.element,
            `select jumlah::text as quantity, harga_satuan::text as unit_cost,
                    diskon_persen::text as discount_percent, tarif_ppn::text as vat_percent
             from ap_tr_nota_kredit_detail
             where tenant_id = $1 and nota_kredit_id = $2 and deleted_at is null`,
            [this.scope.tenantId, memoId],
        );
        if (!lines.length)
            validation({
                lines: 'Tambahkan sedikitnya satu baris sebelum posting.',
            });
        const { subtotal, vat } = documentTotals(
            lines,
            await this.amountDecimals(),
        );
        const total = subtotal.plus(vat).normalized();
        if (scaled(total) <= 0n)
            validation({
                lines: 'Nilai nota kredit harus lebih dari 0. Periksa jumlah dan harga barisnya.',
            });
        return total;
    }

    private async refuseStaleAllowanceLines(memoId: string, vendorId: string) {
        const stale = await this.db.one(
            z.object({ index: z.number(), number: z.string() }),
            `select (c.urutan - 1)::int as index, h.nomor as number
             from ap_tr_nota_kredit_detail c
             join ap_tr_faktur_detail f on f.tenant_id = c.tenant_id and f.id = c.faktur_detail_id
             join ap_tr_faktur h on h.tenant_id = f.tenant_id and h.id = f.faktur_id
             where c.tenant_id = $1 and c.nota_kredit_id = $2 and c.deleted_at is null and c.jenis = 'potongan'
               and (h.status <> 'diposting' or h.vendor_id <> $3)
             order by c.urutan limit 1`,
            [this.scope.tenantId, memoId, vendorId],
        );
        if (stale)
            validation({
                [`lines.${stale.index}.invoice_line_id`]: `Faktur ${stale.number} tidak lagi diposting untuk vendor ini. Hapus baris ini dari nota kredit.`,
            });
    }

    // Purch.-Post untuk credit memo.
    async post(request: Request, id: string, body: unknown) {
        this.workspace.guard('purchase-credit-memo', 'post');
        const current = await this.header(id);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            const claimed = await this.transition(current.id, version, 'post');
            if (!claimed) return;
            const vendor = await this.vendorStatus(claimed.vendor_id);
            if (vendor?.status !== 'active')
                validation({
                    vendor_id:
                        'Vendor ini nonaktif, jadi nota kreditnya tidak bisa diposting. Aktifkan lagi vendornya.',
                });
            const total = await this.total(current.id);
            await this.refuseStaleAllowanceLines(current.id, claimed.vendor_id);
            const lines = await this.lockedReturnLines(current.id);
            await requireLocationAccess(
                this.db,
                this.workspace,
                lines.map((line) => line.location_id),
            );
            const errors: Record<string, string> = {};
            for (const line of lines) {
                const field = `lines.${line.index}.quantity`;
                if (
                    line.return_status !== 'diposting' ||
                    line.receipt_vendor_id !== claimed.vendor_id
                ) {
                    errors[field] =
                        `Retur ${line.return_number} tidak lagi diposting untuk vendor ini. Hapus baris ini dari nota kredit.`;
                    continue;
                }
                const open = scaled(line.returned) - scaled(line.credited);
                if (scaled(line.quantity) > open)
                    errors[field] =
                        open > 0n
                            ? `Paling banyak ${quantityText(open)}: sisa retur ${line.return_number} yang belum dikreditkan.`
                            : `Baris retur ${line.return_number} ini sudah dikreditkan seluruhnya.`;
            }
            if (Object.keys(errors).length) validation(errors);
            const stamp = nowSql();
            for (const line of lines)
                await this.db.execute(
                    `update bl_tr_retur_detail set jumlah_dikredit = jumlah_dikredit + $1::numeric, updated_at = $2
                     where tenant_id = $3 and id = $4`,
                    [
                        line.quantity,
                        stamp,
                        this.scope.tenantId,
                        line.return_line_id,
                    ],
                );
            const credit = scaled(total);
            const target = claimed.applies_to_entry_id
                ? await this.lockAppliesTo(
                      claimed.applies_to_entry_id,
                      claimed.vendor_id,
                      claimed.posting_date,
                  )
                : null;
            const applied =
                target === null
                    ? 0n
                    : credit < target.remaining
                      ? credit
                      : target.remaining;
            const entryId = Bun.randomUUIDv7();
            const remaining = applied - credit;
            await this.db.insert('ap_tr_entri_utang', {
                id: entryId,
                tenant_id: this.scope.tenantId,
                legal_entity_id: this.scope.legalEntityId,
                vendor_id: claimed.vendor_id,
                nota_kredit_id: current.id,
                jenis: 'nota_kredit',
                tanggal: claimed.posting_date,
                nomor_dokumen: claimed.number,
                no_dokumen_vendor: claimed.vendor_credit_memo_number,
                jatuh_tempo: claimed.document_date,
                jumlah: toNumeric(-credit, quantityScale),
                sisa: toNumeric(remaining, quantityScale),
                ditutup_oleh_entri_id:
                    remaining === 0n ? (target?.id ?? null) : null,
                ditutup_pada: remaining === 0n ? stamp : null,
                created_at: stamp,
                updated_at: stamp,
            });
            if (target && applied > 0n)
                await this.db.execute(
                    `update ap_tr_entri_utang
                     set sisa = sisa - $1::numeric,
                         ditutup_oleh_entri_id = case when sisa = $1::numeric then $2::uuid end,
                         ditutup_pada = case when sisa = $1::numeric then $3::timestamp end,
                         updated_at = $3
                     where tenant_id = $4 and id = $5`,
                    [
                        toNumeric(applied, quantityScale),
                        entryId,
                        stamp,
                        this.scope.tenantId,
                        target.id,
                    ],
                );
        });
        return {
            status: 200,
            headers: {},
            body: { data: await this.document(current.id) },
        };
    }

    private async lockAppliesTo(
        entryId: string,
        vendorId: string,
        postingDate: string,
    ) {
        const entry = await this.db.one(
            z.object({
                id: z.string(),
                kind: z.string(),
                vendor_id: z.string(),
                remaining: z.string(),
                posting_date: z.string(),
                document_number: z.string(),
            }),
            `select id, jenis as kind, vendor_id, sisa::text as remaining, tanggal::text as posting_date,
                    nomor_dokumen as document_number
             from ap_tr_entri_utang where tenant_id = $1 and id = $2 for update`,
            [this.scope.tenantId, entryId],
        );
        if (
            entry?.kind !== 'faktur' ||
            entry.vendor_id !== vendorId ||
            scaled(entry.remaining) <= 0n
        )
            validation({
                applies_to_entry_id: entry
                    ? `Utang ${entry.document_number} sudah lunas atau bukan milik vendor ini. Pilih faktur lain, atau kosongkan.`
                    : messages.applies_to_entry_id,
            });
        if (postingDate < entry.posting_date)
            validation({
                posting_date: `Tanggal posting tidak boleh sebelum tanggal posting ${entry.document_number}.`,
            });
        return { id: entry.id, remaining: scaled(entry.remaining) };
    }

    // Cancel pada Posted Purchase Credit Memo (codeunit "Cancel Posted Purch. Cr. Memo"): hanya selama kreditnya belum
    // dipakai (UnappliedErr).
    async reverse(request: Request, id: string, body: unknown) {
        this.workspace.guard('purchase-credit-memo', 'reverse');
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
                z.object({
                    id: z.string(),
                    amount: z.string(),
                    open: z.string(),
                }),
                `select id, jumlah::text as amount, sisa::text as open from ap_tr_entri_utang
                 where tenant_id = $1 and nota_kredit_id = $2 and jenis = 'nota_kredit' for update`,
                [this.scope.tenantId, current.id],
            );
            if (!entry)
                abort(409, 'Entri utang nota kredit ini tidak ditemukan.');
            if (scaled(entry.open) !== scaled(entry.amount))
                await this.refuseApplied(entry.id, claimed.applies_to_entry_id);
            const lines = await this.lockedReturnLines(current.id);
            await requireLocationAccess(
                this.db,
                this.workspace,
                lines.map((line) => line.location_id),
            );
            const stamp = nowSql();
            for (const line of lines)
                await this.db.execute(
                    `update bl_tr_retur_detail set jumlah_dikredit = jumlah_dikredit - $1::numeric, updated_at = $2
                     where tenant_id = $3 and id = $4`,
                    [
                        line.quantity,
                        stamp,
                        this.scope.tenantId,
                        line.return_line_id,
                    ],
                );
            const reversalId = Bun.randomUUIDv7();
            await this.db.insert('ap_tr_entri_utang', {
                id: reversalId,
                tenant_id: this.scope.tenantId,
                legal_entity_id: this.scope.legalEntityId,
                vendor_id: claimed.vendor_id,
                nota_kredit_id: current.id,
                jenis: 'pembatalan_nota_kredit',
                tanggal: claimed.posting_date,
                nomor_dokumen: claimed.number,
                no_dokumen_vendor: claimed.vendor_credit_memo_number,
                jatuh_tempo: claimed.document_date,
                jumlah: toNumeric(-scaled(entry.amount), quantityScale),
                sisa: 0,
                ditutup_oleh_entri_id: entry.id,
                ditutup_pada: stamp,
                created_at: stamp,
                updated_at: stamp,
            });
            await this.db.execute(
                `update ap_tr_entri_utang set sisa = 0, ditutup_oleh_entri_id = $1, ditutup_pada = $2,
                        updated_at = $2
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

    private async refuseApplied(
        entryId: string,
        appliesToEntryId: string | null,
    ): Promise<never> {
        const message =
            'Kredit nota ini sudah dipakai, jadi postingnya tidak bisa dibatalkan.';
        const payment = await this.db.one(
            z.object({ id: z.string(), number: z.string() }),
            `select h.id, h.nomor as number
             from ap_tr_pembayaran_detail d
             join ap_tr_pembayaran h on h.tenant_id = d.tenant_id and h.id = d.pembayaran_id
             where d.tenant_id = $1 and d.entri_utang_id = $2 and d.deleted_at is null and h.status = 'diposting'
             order by h.diposting_pada desc, h.id desc limit 1`,
            [this.scope.tenantId, entryId],
        );
        if (payment)
            return refuse(this.db, this.workspace, {
                message: `${message} Batalkan posting pembayaran ${payment.number} yang memakainya lebih dulu.`,
                open: {
                    page: 'core.vendor-payment',
                    recordId: payment.id,
                    label: `Buka pembayaran ${payment.number}`,
                },
                otherwise: `Minta petugas pembelian membatalkan posting pembayaran ${payment.number} lebih dulu.`,
            });
        const invoice = appliesToEntryId
            ? await this.db.one(
                  z.object({ id: z.string(), number: z.string() }),
                  `select faktur_id as id, nomor_dokumen as number from ap_tr_entri_utang
                   where tenant_id = $1 and id = $2`,
                  [this.scope.tenantId, appliesToEntryId],
              )
            : undefined;
        return validation({
            _form: invoice
                ? `${message} Kreditnya sudah mengurangi utang faktur ${invoice.number} saat diposting.`
                : message,
        });
    }
}

type ReturnLineInfo = { locationId: string; open: bigint };

// Undo Return Shipment di BC hanya untuk baris yang belum di-invoice.
export async function refuseCreditedReturn(
    db: Database,
    workspace: Workspace,
    returnId: string,
): Promise<void> {
    const memo = await db.one(
        z.object({ id: z.string(), number: z.string() }),
        `select h.id, h.nomor as number
         from ap_tr_nota_kredit_detail c
         join ap_tr_nota_kredit h on h.tenant_id = c.tenant_id and h.id = c.nota_kredit_id
         join bl_tr_retur_detail rd on rd.tenant_id = c.tenant_id and rd.id = c.retur_detail_id
         where c.tenant_id = $1 and rd.retur_id = $2 and h.status = 'diposting'
           and c.deleted_at is null and h.deleted_at is null
         order by h.diposting_pada, h.id limit 1`,
        [workspace.tenantId, returnId],
    );
    if (memo)
        await refuse(db, workspace, {
            message: `Barang retur ini sudah dikreditkan di ${memo.number}, jadi returnya tidak bisa dibatalkan. Batalkan posting nota kredit itu lebih dulu.`,
            open: {
                page: 'core.purchase-credit-memo',
                recordId: memo.id,
                label: `Buka nota kredit ${memo.number}`,
            },
            otherwise: `Minta petugas pembelian membatalkan posting nota kredit ${memo.number} lebih dulu.`,
        });
}

export async function appliedCreditMemo(
    db: Database,
    tenantId: string,
    entryId: string,
): Promise<{ id: string; number: string } | undefined> {
    return db.one(
        z.object({ id: z.string(), number: z.string() }),
        `select id, nomor as number from ap_tr_nota_kredit
         where tenant_id = $1 and entri_utang_tujuan_id = $2 and status = 'diposting' and deleted_at is null
         order by diposting_pada desc, id desc limit 1`,
        [tenantId, entryId],
    );
}
