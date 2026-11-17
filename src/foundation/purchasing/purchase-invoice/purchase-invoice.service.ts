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
import {
    dueDate,
    paymentTermsJson,
    paymentTermsOf,
} from '../payment-terms/payment-terms.service.ts';
import { lineAmountSql } from '../purchase-line.service.ts';
import { refusePaidEntry } from '../vendor-payment/vendor-payment.service.ts';
import {
    purchaseInvoiceInputSchema,
    purchaseInvoiceLineRowSchema,
    purchaseInvoiceRowSchema,
    purchaseInvoiceStatuses,
    receiptLineChoiceSchema,
} from './purchase-invoice.schema.ts';

const numberReference = 'core.purchase-invoice-number';
const sourceType = 'purchase_invoice';
const hundredPercent = 100n * 10n ** BigInt(quantityScale);
const quantityText = (value: bigint) => display(value, quantityScale);

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
    kind: 'barang' | 'biaya';
    receiptLineId: string | null;
    description: string | null;
    quantity: bigint;
    unitCost: bigint;
    discountPercent: bigint;
    vatPercent: bigint;
};

// Nilai dokumen: jumlah nilai baris dan PPN-nya, dibulatkan sekali, sama dengan purchase order dan penerimaan.
const totalsSql = (amountDecimals: number) => `left join lateral (
                        select sum(line.amount) as amount, sum(line.amount * line.tarif_ppn / 100) as vat
                        from (select ${lineAmountSql('d', amountDecimals)} as amount, d.tarif_ppn
                              from ap_tr_faktur_detail d
                              where d.tenant_id = h.tenant_id and d.faktur_id = h.id
                                and d.deleted_at is null) line) t on true`;

const rowSql = (amountDecimals: number) => `select * from (
                    select h.id, h.nomor as number, h.status, h.version,
                           json_build_object('id', v.id, 'number', v.number, 'name', p.name) as vendor,
                           p.name as vendor_name, h.no_faktur_vendor as vendor_invoice_number,
                           h.tanggal_faktur::text as document_date, h.tanggal::text as posting_date,
                           h.jatuh_tempo::text as due_date, ${paymentTermsJson('pt')} as payment_terms,
                           h.keterangan as description,
                           coalesce(trim_scale(t.amount)::text, '0') as amount,
                           coalesce(trim_scale(round(t.vat, ${amountDecimals}))::text, '0') as vat_amount,
                           ${isoSql('h.diposting_pada')} as posted_at, ${isoSql('h.dibatalkan_pada')} as reversed_at
                    from ap_tr_faktur h
                    join vendors v on v.tenant_id = h.tenant_id and v.id = h.vendor_id
                    join parties p on p.tenant_id = v.tenant_id and p.id = v.party_id
                    left join termin_pembayaran pt on pt.tenant_id = h.tenant_id and pt.id = h.termin_pembayaran_id
                    ${totalsSql(amountDecimals)}
                    where h.tenant_id = $1 and h.legal_entity_id = $2 and h.deleted_at is null) invoices
                where true`;

const messages = {
    vendor_id: 'Pilih vendor dari daftar.',
    vendor_invoice_number:
        'Isi nomor faktur dari vendor, paling banyak 35 karakter.',
    document_date: 'Isi tanggal faktur vendor yang benar.',
    posting_date: 'Isi tanggal posting yang benar.',
    due_date: 'Isi tanggal jatuh tempo yang benar.',
    payment_terms_id: 'Pilih termin pembayaran dari daftar.',
    description: 'Isi keterangan paling banyak 200 karakter.',
    lines: 'Satu faktur paling banyak 500 baris.',
    id: 'Baris ini sudah tidak ada. Muat ulang faktur, lalu ulangi perubahanmu.',
    kind: 'Pilih jenis baris barang atau biaya.',
    receipt_line_id:
        'Baris penerimaan ini tidak bisa difakturkan. Ambil lagi dari Ambil baris penerimaan.',
    quantity: `Isi jumlah lebih dari 0, ${quantityHint}.`,
    unit_cost: 'Isi harga satuan 0 atau lebih.',
    discount_percent: 'Isi diskon 0 sampai 100 persen.',
    vat_percent: percentHint(),
    version: 'Muat ulang faktur, lalu ulangi perubahanmu.',
};

// Baris penerimaan yang boleh difakturkan untuk satu vendor: penerimaan diposting, di lokasi yang boleh dilihat
// pengguna. on_drafts = jumlah yang sudah ada di draf faktur lain, supaya dua draf tidak menagih barang yang sama.
const receiptLinesSql = (location: string) => `
    select d.id as receipt_line_id,
           json_build_object('id', r.id, 'number', r.nomor, 'posting_date', r.tanggal::text,
                             'vendor_document_number', r.no_dokumen_vendor) as receipt,
           json_build_object('id', l.id, 'code', l.kode, 'name', l.nama) as location,
           json_build_object('id', b.id, 'code', b.kode, 'name', b.nama) as item,
           json_build_object('id', u.id, 'code', u.kode, 'name', u.nama) as unit,
           d.jumlah::text as received, d.jumlah_difaktur::text as invoiced,
           coalesce((select sum(f.jumlah) from ap_tr_faktur_detail f
                     join ap_tr_faktur fh on fh.tenant_id = f.tenant_id and fh.id = f.faktur_id
                     where f.tenant_id = d.tenant_id and f.penerimaan_detail_id = d.id and f.deleted_at is null
                       and fh.status = 'draf' and fh.deleted_at is null and fh.id is distinct from $4::uuid),
                    0)::text as on_drafts,
           d.harga_satuan::text as unit_cost, d.diskon_persen::text as discount_percent,
           d.tarif_ppn::text as vat_percent, r.lokasi_id as location_id
    from bl_tr_penerimaan_detail d
    join bl_tr_penerimaan r on r.tenant_id = d.tenant_id and r.id = d.penerimaan_id
    join gd_m_lokasi l on l.tenant_id = r.tenant_id and l.id = r.lokasi_id
    join gd_m_barang b on b.tenant_id = d.tenant_id and b.id = d.barang_id
    join gd_m_satuan u on u.tenant_id = d.tenant_id and u.id = d.satuan_id
    where d.tenant_id = $1 and r.legal_entity_id = $2 and r.vendor_id = $3 and r.status = 'diposting'
      and r.deleted_at is null and d.deleted_at is null and d.jumlah_difaktur < d.jumlah and ${location}`;

const storedReceiptLineSchema = z.object({
    receipt_line_id: z.string(),
    received: z.string(),
    invoiced: z.string(),
    on_drafts: z.string(),
    unit_cost: z.string(),
    discount_percent: z.string(),
    vat_percent: z.string(),
});

// Faktur pembelian (Purchase Invoice di BC) atas barang yang sudah diterima. Barisnya diambil dari baris penerimaan yang
// diposting dan belum selesai difakturkan (Get Receipt Lines), harga, diskon, dan PPN-nya boleh diubah mengikuti faktur
// vendor, dan biaya lain seperti ongkos angkut ditambahkan sebagai baris biaya. Posting menambah jumlah difakturkan di
// baris penerimaan dan menulis entri utang vendor dengan jatuh temponya. Batal posting membalik keduanya selama utangnya
// belum dibayar.
export class PurchaseInvoices {
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

    private async amountDecimals(): Promise<number> {
        return (await this.precision()).amount_decimals;
    }

    private permissions() {
        const has = (permission: string) =>
            this.workspace.permissions.has(`core.${permission}`);
        return {
            update: has('purchase-invoice.update'),
            post: has('purchase-invoice.post'),
            reverse: has('purchase-invoice.reverse'),
        };
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('purchase-invoice', 'read');
        const bindings: string[] = [
            this.scope.tenantId,
            this.scope.legalEntityId,
        ];
        const status = z
            .enum(purchaseInvoiceStatuses)
            .safeParse(parameters.get('status'));
        const filter = status.success
            ? ` and status = $${bindings.push(status.data)}`
            : '';
        const amountDecimals = await this.amountDecimals();
        const batch = await incrementalList(this.db, {
            query: `${rowSql(amountDecimals)}${filter}`,
            bindings,
            parameters,
            columns: {
                number: 'number',
                document_date: 'document_date',
                due_date: 'due_date',
                status: 'status',
                vendor: 'vendor_name',
            },
            searchColumns: ['number', 'vendor_name', 'vendor_invoice_number'],
            numericColumns: [],
            defaultSort: 'document_date',
            defaultDirection: 'desc',
        });
        return {
            data: batch.data.map((row) => purchaseInvoiceRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            permissions: this.permissions(),
            amount_decimals: amountDecimals,
        };
    }

    private async header(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  purchaseInvoiceRowSchema,
                  `${rowSql(await this.amountDecimals())} and invoices.id = $3`,
                  [this.scope.tenantId, this.scope.legalEntityId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private async document(id: string) {
        const header = await this.header(id);
        const decimals = await this.amountDecimals();
        const lines = await this.db.rows(
            purchaseInvoiceLineRowSchema,
            `select f.id, f.urutan as line_no, f.jenis as kind, f.keterangan as description,
                    f.penerimaan_detail_id as receipt_line_id,
                    case when r.id is null then null
                         else json_build_object('id', r.id, 'number', r.nomor) end as receipt,
                    case when b.id is null then null
                         else json_build_object('id', b.id, 'code', b.kode, 'name', b.nama) end as item,
                    case when u.id is null then null
                         else json_build_object('id', u.id, 'code', u.kode, 'name', u.nama) end as unit,
                    trim_scale(f.jumlah)::text as quantity, trim_scale(f.harga_satuan)::text as unit_cost,
                    trim_scale(f.diskon_persen)::text as discount_percent,
                    trim_scale(f.tarif_ppn)::text as vat_percent,
                    trim_scale(${lineAmountSql('f', decimals)})::text as amount,
                    trim_scale(d.harga_satuan)::text as receipt_unit_cost,
                    trim_scale(d.diskon_persen)::text as receipt_discount_percent,
                    trim_scale(d.tarif_ppn)::text as receipt_vat_percent,
                    trim_scale(round(f.jumlah * d.harga_satuan * (100 - d.diskon_persen) / 100, ${decimals}))::text
                        as receipt_amount,
                    trim_scale(d.jumlah)::text as received, trim_scale(d.jumlah_difaktur)::text as invoiced
             from ap_tr_faktur_detail f
             left join bl_tr_penerimaan_detail d on d.tenant_id = f.tenant_id and d.id = f.penerimaan_detail_id
             left join bl_tr_penerimaan r on r.tenant_id = d.tenant_id and r.id = d.penerimaan_id
             left join gd_m_barang b on b.tenant_id = d.tenant_id and b.id = d.barang_id
             left join gd_m_satuan u on u.tenant_id = d.tenant_id and u.id = d.satuan_id
             where f.tenant_id = $1 and f.faktur_id = $2 and f.deleted_at is null
             order by f.urutan, f.id`,
            [this.scope.tenantId, header.id],
        );
        return { ...header, lines };
    }

    async show(id: string) {
        this.workspace.guard('purchase-invoice', 'read');
        return {
            data: await this.document(id),
            permissions: this.permissions(),
            amount_decimals: await this.amountDecimals(),
        };
    }

    // Ambil baris penerimaan (Get Receipt Lines, codeunit 74): baris penerimaan diposting milik vendor itu yang masih
    // punya sisa belum difakturkan, di lokasi yang boleh dilihat pengguna.
    async receiptLines(parameters: URLSearchParams) {
        this.workspace.guard('purchase-invoice', 'read');
        const vendorId = parameters.get('vendor_id') ?? '';
        const invoiceId = parameters.get('invoice_id');
        if (!lookupId(vendorId)) validation({ vendor_id: messages.vendor_id });
        const bindings: (string | null)[] = [
            this.scope.tenantId,
            this.scope.legalEntityId,
            vendorId,
            invoiceId && lookupId(invoiceId) ? invoiceId : null,
        ];
        const rows = await this.db.rows(
            receiptLineChoiceSchema.omit({ open: true }),
            `${receiptLinesSql(allowedLocationsSql(this.workspace, bindings, ['r.lokasi_id']))}
             order by r.tanggal, r.nomor, d.urutan`,
            bindings,
        );
        return {
            data: rows.flatMap((row) => {
                const open =
                    fromNumeric(row.received, quantityScale) -
                    fromNumeric(row.invoiced, quantityScale) -
                    fromNumeric(row.on_drafts, quantityScale);
                if (open <= 0n) return [];
                const text = (value: string) =>
                    quantityText(fromNumeric(value, quantityScale));
                return [
                    {
                        ...row,
                        received: text(row.received),
                        invoiced: text(row.invoiced),
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

    private async vendorStatus(id: string) {
        return lookupId(id)
            ? await this.db.one(
                  z.object({
                      status: z.string(),
                      payment_terms_id: z.string().nullable(),
                  }),
                  `select status, termin_pembayaran_id as payment_terms_id from vendors
                       where tenant_id = $1 and legal_entity_id = $2 and id = $3`,
                  [this.scope.tenantId, this.scope.legalEntityId, id],
              )
            : undefined;
    }

    private async receiptLineMap(
        vendorId: string,
        invoiceId: string | null,
        ids: string[],
    ) {
        if (!ids.length) return new Map<string, ReceiptLineInfo>();
        const bindings: (string | null)[] = [
            this.scope.tenantId,
            this.scope.legalEntityId,
            vendorId,
            invoiceId,
            `{${ids.join(',')}}`,
        ];
        const rows = await this.db.rows(
            storedReceiptLineSchema.extend({ location_id: z.string() }),
            `select * from (${receiptLinesSql('true')}) lines where receipt_line_id = any($5::uuid[])`,
            bindings,
        );
        return new Map(
            rows.map((row) => [
                row.receipt_line_id,
                {
                    locationId: row.location_id,
                    open:
                        fromNumeric(row.received, quantityScale) -
                        fromNumeric(row.invoiced, quantityScale) -
                        fromNumeric(row.on_drafts, quantityScale),
                },
            ]),
        );
    }

    private async checked(body: unknown, invoiceId: string | null) {
        const data = parseInput(purchaseInvoiceInputSchema, body, messages);
        const errors: Record<string, string> = {};
        const vendor = await this.vendorStatus(data.vendor_id);
        if (!vendor) errors.vendor_id = messages.vendor_id;
        else if (vendor.status !== 'active')
            errors.vendor_id =
                'Vendor ini nonaktif. Pilih vendor aktif, atau aktifkan lagi vendornya.';
        const vendorInvoiceNumber = data.vendor_invoice_number.trim();
        if (!vendorInvoiceNumber || vendorInvoiceNumber.length > 35)
            errors.vendor_invoice_number = messages.vendor_invoice_number;
        const documentDateValid = dateSchema.safeParse(
            data.document_date,
        ).success;
        if (!documentDateValid) errors.document_date = messages.document_date;
        if (!dateSchema.safeParse(data.posting_date).success)
            errors.posting_date = messages.posting_date;
        const terms =
            data.payment_terms_id === undefined
                ? invoiceId
                    ? undefined
                    : await paymentTermsOf(
                          this.db,
                          this.scope,
                          vendor?.payment_terms_id,
                      )
                : await paymentTermsOf(
                      this.db,
                      this.scope,
                      data.payment_terms_id,
                  );
        if (terms === null) errors.payment_terms_id = messages.payment_terms_id;
        const due = data.due_date?.trim() || null;
        if (due !== null && !dateSchema.safeParse(due).success)
            errors.due_date = messages.due_date;
        else if (due !== null && documentDateValid && due < data.document_date)
            errors.due_date =
                'Jatuh tempo tidak boleh sebelum tanggal faktur vendor.';
        const description = data.description?.trim() || null;
        if (description && description.length > 200)
            errors.description = messages.description;
        const unitCostDecimals = unitAmountDecimals(await this.precision());
        const receiptLines = await this.receiptLineMap(
            data.vendor_id,
            invoiceId,
            [
                ...new Set(
                    data.lines.flatMap((line) =>
                        line.kind === 'barang' && lookupId(line.receipt_line_id)
                            ? [line.receipt_line_id]
                            : [],
                    ),
                ),
            ],
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
            let quantity = 10n ** BigInt(quantityScale);
            let receiptLineId: string | null = null;
            let lineDescription: string | null = null;
            if (line.kind === 'barang') {
                const found = receiptLines.get(line.receipt_line_id);
                const parsed = decimalInput(line.quantity);
                if (!found || taken.has(line.receipt_line_id))
                    fail('receipt_line_id', messages.receipt_line_id);
                else if (parsed === null || parsed <= 0n)
                    fail('quantity', messages.quantity);
                else if (parsed > found.open)
                    fail(
                        'quantity',
                        found.open > 0n
                            ? `Paling banyak ${quantityText(found.open)}: sisa yang diterima dan belum difakturkan.`
                            : 'Baris penerimaan ini sudah difakturkan seluruhnya, atau sudah ada di draf faktur lain.',
                    );
                else {
                    await requireLocationAccess(this.db, this.workspace, [
                        found.locationId,
                    ]);
                    taken.add(line.receipt_line_id);
                    receiptLineId = line.receipt_line_id;
                    quantity = parsed;
                }
            } else {
                lineDescription = line.description.trim() || null;
                if (!lineDescription || lineDescription.length > 200)
                    fail(
                        'description',
                        'Tulis keterangan biaya, misalnya ongkos angkut, paling banyak 200 karakter.',
                    );
            }
            lines.push({
                id: line.id ?? null,
                kind: line.kind,
                receiptLineId,
                description: lineDescription,
                quantity,
                unitCost: unitCost ?? 0n,
                discountPercent: discount ?? 0n,
                vatPercent: vat === null ? 0n : fromNumeric(vat, quantityScale),
            });
        }
        if (Object.keys(errors).length || !vendor) validation(errors);
        return {
            vendorId: data.vendor_id,
            vendorInvoiceNumber,
            documentDate: data.document_date,
            postingDate: data.posting_date,
            paymentTerms: terms,
            dueDate: due,
            description,
            lines,
        };
    }

    private vendorInvoiceTaken(error: unknown): void {
        if (violates(error, 'ap_tr_faktur_no_faktur_vendor_unique'))
            validation({
                vendor_invoice_number:
                    'Nomor faktur ini sudah dicatat untuk vendor yang sama. Periksa faktur vendor itu di daftar faktur pembelian.',
            });
    }

    private async saveLines(invoiceId: string, lines: LineDraft[]) {
        const existing = new Set(
            (
                await this.db.rows(
                    z.object({ id: z.string() }),
                    'select id from ap_tr_faktur_detail where tenant_id = $1 and faktur_id = $2 and deleted_at is null',
                    [this.scope.tenantId, invoiceId],
                )
            ).map((row) => row.id),
        );
        const kept = new Set<string>();
        const stamp = nowSql();
        for (const [index, line] of lines.entries()) {
            const values = {
                urutan: index + 1,
                jenis: line.kind,
                penerimaan_detail_id: line.receiptLineId,
                keterangan: line.description,
                jumlah: toNumeric(line.quantity, quantityScale),
                harga_satuan: toNumeric(line.unitCost, quantityScale),
                diskon_persen: toNumeric(line.discountPercent, quantityScale),
                tarif_ppn: toNumeric(line.vatPercent, quantityScale),
            };
            if (line.id && existing.has(line.id)) {
                kept.add(line.id);
                await this.db.execute(
                    `update ap_tr_faktur_detail set urutan = $1, jenis = $2, penerimaan_detail_id = $3,
                            keterangan = $4, jumlah = $5, harga_satuan = $6, diskon_persen = $7, tarif_ppn = $8,
                            updated_at = $9
                     where tenant_id = $10 and id = $11`,
                    [
                        values.urutan,
                        values.jenis,
                        values.penerimaan_detail_id,
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
                await this.db.insert('ap_tr_faktur_detail', {
                    id: Bun.randomUUIDv7(),
                    tenant_id: this.scope.tenantId,
                    legal_entity_id: this.scope.legalEntityId,
                    faktur_id: invoiceId,
                    ...values,
                    created_at: stamp,
                    updated_at: stamp,
                });
        }
        const removed = [...existing].filter((id) => !kept.has(id));
        if (removed.length)
            await this.db.execute(
                `update ap_tr_faktur_detail set deleted_at = $1, updated_at = $1
                 where tenant_id = $2 and id = any($3::uuid[])`,
                [stamp, this.scope.tenantId, `{${removed.join(',')}}`],
            );
    }

    async create(body: unknown) {
        this.workspace.guard('purchase-invoice', 'update');
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
                await this.db.insert('ap_tr_faktur', {
                    id,
                    tenant_id: this.scope.tenantId,
                    legal_entity_id: this.scope.legalEntityId,
                    vendor_id: data.vendorId,
                    nomor: number,
                    no_faktur_vendor: data.vendorInvoiceNumber,
                    tanggal_faktur: data.documentDate,
                    tanggal: data.postingDate,
                    termin_pembayaran_id: data.paymentTerms?.id ?? null,
                    jatuh_tempo:
                        data.dueDate ??
                        dueDate(
                            data.documentDate,
                            data.paymentTerms?.due_days ?? null,
                        ),
                    keterangan: data.description,
                    created_at: stamp,
                    updated_at: stamp,
                });
                await this.saveLines(id, data.lines);
            });
        } catch (error) {
            this.vendorInvoiceTaken(error);
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
                status: z.enum(purchaseInvoiceStatuses),
                version: z.number(),
                payment_terms_id: z.string().nullable(),
            }),
            `select status, version, termin_pembayaran_id as payment_terms_id from ap_tr_faktur
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
                _form: 'Faktur yang sudah diposting tidak bisa diubah atau dihapus.',
            });
        if (locked.version !== version)
            coded(409, 'stale_version', staleMessage);
        return locked;
    }

    // Jatuh tempo yang dikosongkan dihitung ulang dari tanggal faktur vendor dan termin, seperti Due Date yang ikut
    // berubah saat Document Date atau Payment Terms Code divalidasi di BC.
    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('purchase-invoice', 'update');
        const current = await this.header(id);
        const data = await this.checked(body, current.id);
        const version = expectedVersion(request, body);
        try {
            await this.db.transaction(async () => {
                const locked = await this.lockDraft(current.id, version);
                const termsId =
                    data.paymentTerms === undefined
                        ? locked.payment_terms_id
                        : (data.paymentTerms?.id ?? null);
                const terms =
                    data.paymentTerms === undefined
                        ? await paymentTermsOf(this.db, this.scope, termsId)
                        : data.paymentTerms;
                await this.db.execute(
                    `update ap_tr_faktur set vendor_id = $1, no_faktur_vendor = $2, tanggal_faktur = $3, tanggal = $4,
                            termin_pembayaran_id = $5, jatuh_tempo = $6, keterangan = $7, updated_at = $8
                     where tenant_id = $9 and id = $10`,
                    [
                        data.vendorId,
                        data.vendorInvoiceNumber,
                        data.documentDate,
                        data.postingDate,
                        termsId,
                        data.dueDate ??
                            dueDate(data.documentDate, terms?.due_days ?? null),
                        data.description,
                        nowSql(),
                        this.scope.tenantId,
                        current.id,
                    ],
                );
                await this.saveLines(current.id, data.lines);
            });
        } catch (error) {
            this.vendorInvoiceTaken(error);
            throw error;
        }
        return {
            status: 200,
            headers: {},
            body: { data: await this.document(current.id) },
        };
    }

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('purchase-invoice', 'update');
        const current = await this.header(id);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            await this.lockDraft(current.id, version);
            const stamp = nowSql();
            await this.db.execute(
                `update ap_tr_faktur_detail set deleted_at = $1, updated_at = $1
                 where tenant_id = $2 and faktur_id = $3 and deleted_at is null`,
                [stamp, this.scope.tenantId, current.id],
            );
            await this.db.execute(
                `update ap_tr_faktur set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3`,
                [stamp, this.scope.tenantId, current.id],
            );
        });
        return { status: 204, headers: {}, body: undefined };
    }

    // Status berpindah dengan compare-and-set di transaksi yang sama dengan postingnya. Permintaan yang diulang setelah
    // faktur sampai di status tujuan tidak menulis apa pun dan menjawab faktur yang sama.
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
                vendor_invoice_number: z.string(),
                posting_date: z.string(),
                due_date: z.string(),
            }),
            `update ap_tr_faktur set status = $3, ${stamp}, updated_at = $1
             where tenant_id = $4 and legal_entity_id = $5 and id = $6 and status = $7 and version = $8
               and deleted_at is null
             returning nomor as number, vendor_id, no_faktur_vendor as vendor_invoice_number,
                       tanggal::text as posting_date, jatuh_tempo::text as due_date`,
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
            validation({ _form: 'Posting faktur ini sudah dibatalkan.' });
        if (current.status === 'draf')
            validation({ _form: 'Faktur ini belum diposting.' });
        return coded(409, 'stale_version', staleMessage);
    }

    private async lockedLines(invoiceId: string) {
        return this.db.rows(
            z.object({
                index: z.number(),
                receipt_line_id: z.string(),
                quantity: z.string(),
                received: z.string(),
                invoiced: z.string(),
                receipt_status: z.string(),
                receipt_vendor_id: z.string(),
                receipt_number: z.string(),
                receipt_id: z.string(),
                location_id: z.string(),
            }),
            `select (f.urutan - 1)::int as index, f.penerimaan_detail_id as receipt_line_id, f.jumlah::text as quantity,
                    d.jumlah::text as received, d.jumlah_difaktur::text as invoiced, r.status as receipt_status,
                    r.vendor_id as receipt_vendor_id, r.nomor as receipt_number, r.id as receipt_id,
                    r.lokasi_id as location_id
             from ap_tr_faktur_detail f
             join bl_tr_penerimaan_detail d on d.tenant_id = f.tenant_id and d.id = f.penerimaan_detail_id
             join bl_tr_penerimaan r on r.tenant_id = d.tenant_id and r.id = d.penerimaan_id
             where f.tenant_id = $1 and f.faktur_id = $2 and f.deleted_at is null and f.jenis = 'barang'
             order by d.id
             for update of d`,
            [this.scope.tenantId, invoiceId],
        );
    }

    private async total(invoiceId: string): Promise<string> {
        const decimals = await this.amountDecimals();
        const found = await this.db.one(
            z.object({ lines: z.number(), total: z.string() }),
            `select count(*)::int as lines,
                    (coalesce(sum(t.amount), 0) + round(coalesce(sum(t.amount * t.tarif_ppn / 100), 0), ${decimals}))::text
                        as total
             from (select ${lineAmountSql('d', decimals)} as amount, d.tarif_ppn
                   from ap_tr_faktur_detail d
                   where d.tenant_id = $1 and d.faktur_id = $2 and d.deleted_at is null) t`,
            [this.scope.tenantId, invoiceId],
        );
        if (!found?.lines)
            validation({
                lines: 'Tambahkan sedikitnya satu baris sebelum posting.',
            });
        return found.total;
    }

    // Seperti Purch.-Post untuk faktur: vendor harus aktif, setiap baris barang masih punya sisa belum difakturkan di
    // penerimaan yang diposting, lalu Quantity Invoiced bertambah dan Vendor Ledger Entry ditulis dengan jatuh tempo.
    async post(request: Request, id: string, body: unknown) {
        this.workspace.guard('purchase-invoice', 'post');
        const current = await this.header(id);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            const claimed = await this.transition(current.id, version, 'post');
            if (!claimed) return;
            const vendor = await this.vendorStatus(claimed.vendor_id);
            if (vendor?.status !== 'active')
                validation({
                    vendor_id:
                        'Vendor ini nonaktif, jadi fakturnya tidak bisa diposting. Aktifkan lagi vendornya.',
                });
            const total = await this.total(current.id);
            const lines = await this.lockedLines(current.id);
            await requireLocationAccess(
                this.db,
                this.workspace,
                lines.map((line) => line.location_id),
            );
            const errors: Record<string, string> = {};
            for (const line of lines) {
                const field = `lines.${line.index}.quantity`;
                if (
                    line.receipt_status !== 'diposting' ||
                    line.receipt_vendor_id !== claimed.vendor_id
                ) {
                    errors[field] =
                        `Penerimaan ${line.receipt_number} tidak lagi diposting untuk vendor ini. Hapus baris ini dari faktur.`;
                    continue;
                }
                const open =
                    fromNumeric(line.received, quantityScale) -
                    fromNumeric(line.invoiced, quantityScale);
                if (fromNumeric(line.quantity, quantityScale) > open)
                    errors[field] =
                        open > 0n
                            ? `Paling banyak ${quantityText(open)}: sisa penerimaan ${line.receipt_number} yang belum difakturkan.`
                            : `Baris penerimaan ${line.receipt_number} ini sudah difakturkan seluruhnya.`;
            }
            if (Object.keys(errors).length) validation(errors);
            for (const line of lines)
                await this.db.execute(
                    `update bl_tr_penerimaan_detail set jumlah_difaktur = jumlah_difaktur + $1::numeric, updated_at = $2
                     where tenant_id = $3 and id = $4`,
                    [
                        line.quantity,
                        nowSql(),
                        this.scope.tenantId,
                        line.receipt_line_id,
                    ],
                );
            const stamp = nowSql();
            const closed = Number(total) === 0;
            await this.db.insert('ap_tr_entri_utang', {
                id: Bun.randomUUIDv7(),
                tenant_id: this.scope.tenantId,
                legal_entity_id: this.scope.legalEntityId,
                vendor_id: claimed.vendor_id,
                faktur_id: current.id,
                jenis: 'faktur',
                tanggal: claimed.posting_date,
                nomor_dokumen: claimed.number,
                no_faktur_vendor: claimed.vendor_invoice_number,
                jatuh_tempo: claimed.due_date,
                jumlah: total,
                sisa: total,
                ditutup_pada: closed ? stamp : null,
                created_at: stamp,
                updated_at: stamp,
            });
        });
        return {
            status: 200,
            headers: {},
            body: { data: await this.document(current.id) },
        };
    }

    // Batal posting, seperti Cancel pada Posted Purchase Invoice (codeunit "Correct Posted Purch. Invoice").
    async reverse(request: Request, id: string, body: unknown) {
        this.workspace.guard('purchase-invoice', 'reverse');
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
                 where tenant_id = $1 and faktur_id = $2 and jenis = 'faktur' for update`,
                [this.scope.tenantId, current.id],
            );
            if (!entry) abort(409, 'Entri utang faktur ini tidak ditemukan.');
            if (
                fromNumeric(entry.open, quantityScale) !==
                fromNumeric(entry.amount, quantityScale)
            )
                await refusePaidEntry(this.db, this.workspace, entry.id);
            const lines = await this.lockedLines(current.id);
            await requireLocationAccess(
                this.db,
                this.workspace,
                lines.map((line) => line.location_id),
            );
            const stamp = nowSql();
            for (const line of lines)
                await this.db.execute(
                    `update bl_tr_penerimaan_detail set jumlah_difaktur = jumlah_difaktur - $1::numeric, updated_at = $2
                     where tenant_id = $3 and id = $4`,
                    [
                        line.quantity,
                        stamp,
                        this.scope.tenantId,
                        line.receipt_line_id,
                    ],
                );
            const reversalId = Bun.randomUUIDv7();
            await this.db.insert('ap_tr_entri_utang', {
                id: reversalId,
                tenant_id: this.scope.tenantId,
                legal_entity_id: this.scope.legalEntityId,
                vendor_id: claimed.vendor_id,
                faktur_id: current.id,
                jenis: 'pembatalan',
                tanggal: claimed.posting_date,
                nomor_dokumen: claimed.number,
                no_faktur_vendor: claimed.vendor_invoice_number,
                jatuh_tempo: claimed.due_date,
                jumlah: toNumeric(
                    -fromNumeric(entry.amount, quantityScale),
                    quantityScale,
                ),
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
}

type ReceiptLineInfo = { locationId: string; open: bigint };

// Faktur pertama yang menagih barang dari sebuah penerimaan, untuk menolak Batal posting penerimaan yang sudah
// difakturkan (Undo Receipt di BC hanya untuk penerimaan yang belum difakturkan).
export async function refuseInvoicedReceipt(
    db: Database,
    workspace: Workspace,
    receiptId: string,
): Promise<void> {
    const invoice = await db.one(
        z.object({ id: z.string(), number: z.string() }),
        `select h.id, h.nomor as number
         from ap_tr_faktur_detail f
         join ap_tr_faktur h on h.tenant_id = f.tenant_id and h.id = f.faktur_id
         join bl_tr_penerimaan_detail d on d.tenant_id = f.tenant_id and d.id = f.penerimaan_detail_id
         where f.tenant_id = $1 and d.penerimaan_id = $2 and h.status = 'diposting'
           and f.deleted_at is null and h.deleted_at is null
         order by h.diposting_pada, h.id limit 1`,
        [workspace.tenantId, receiptId],
    );
    if (invoice)
        await refuse(db, workspace, {
            message: `Barang dari penerimaan ini sudah difakturkan di ${invoice.number}, jadi postingnya tidak bisa dibatalkan. Batalkan posting faktur itu lebih dulu.`,
            open: {
                page: 'core.purchase-invoice',
                recordId: invoice.id,
                label: `Buka faktur ${invoice.number}`,
            },
            otherwise: `Minta petugas pembelian membatalkan posting faktur ${invoice.number} lebih dulu.`,
        });
}
