import { z } from 'zod';
import type { Workspace } from '../../../platform/access/index.ts';
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
    activeLegalEntity,
    baseQuantity,
    decimalInput,
    defaultUnit,
    exists,
    parseInput,
    postItemLines,
    quantityHint,
    quantityScale,
    raiseBasePrices,
    reverseItemEntries,
    toNumeric,
    unitConversion,
    unitCostInput,
} from '../../inventory/index.ts';
import { decimalsHint } from '../../../platform/money/index.ts';
import {
    Currency,
    localCurrencyCode,
    unitAmountDecimals,
} from '../../currency/index.ts';
import { NumberIssuer } from '../../number-sequence/index.ts';
import {
    receiptBasePrices,
    receiptItemLine,
    sourceType,
    type StoredReceiptLine,
} from './receipt.posting.ts';
import {
    receiptInputSchema,
    receiptLineRowSchema,
    receiptRowSchema,
    receiptStatuses,
} from './receipt.schema.ts';

const numberReference = 'core.purchase-receipt-number';
const one = 10n ** BigInt(quantityScale);
const hundredPercent = 100n * one;

// Dua perpindahan status yang sah, beserta kolom yang mencatat kapan dan oleh siapa.
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

type LineDraft = {
    id: string | null;
    itemId: string;
    unitId: string;
    conversion: bigint;
    quantity: bigint;
    unitCost: bigint;
    discountPercent: bigint;
    batchNumber: string | null;
    expiry: string | null;
    fundingSourceId: string | null;
    programId: string | null;
    budgetYear: number | null;
};

// Nilai baris = jumlah x harga satuan x (100 - diskon) / 100, dibulatkan ke rupiah sen.
const lineAmountSql = (alias: string) =>
    `round(${alias}.jumlah * ${alias}.harga_satuan * (100 - ${alias}.diskon_persen) / 100, 2)`;

const rowSql = `select * from (
                    select h.id, h.nomor as number, h.tanggal::text as posting_date, h.status, h.version,
                           h.no_dokumen_vendor as vendor_document_number, h.keterangan as description,
                           p.name as vendor_name, l.kode as location_code,
                           json_build_object('id', v.id, 'number', v.number, 'name', p.name) as vendor,
                           json_build_object('id', l.id, 'code', l.kode, 'name', l.nama) as location,
                           coalesce((select trim_scale(sum(${lineAmountSql('d')}))::text
                                     from bl_tr_penerimaan_detail d
                                     where d.tenant_id = h.tenant_id and d.penerimaan_id = h.id
                                       and d.deleted_at is null), '0') as amount,
                           ${isoSql('h.diposting_pada')} as posted_at, ${isoSql('h.dibatalkan_pada')} as reversed_at
                    from bl_tr_penerimaan h
                    join vendors v on v.tenant_id = h.tenant_id and v.id = h.vendor_id
                    join parties p on p.tenant_id = v.tenant_id and p.id = v.party_id
                    join gd_m_lokasi l on l.tenant_id = h.tenant_id and l.id = h.lokasi_id
                    where h.tenant_id = $1 and h.legal_entity_id = $2 and h.deleted_at is null) receipts
                where true`;

const reference = (alias: string) =>
    `case when ${alias}.id is null then null else json_build_object(
         'id', ${alias}.id, 'code', ${alias}.kode, 'name', ${alias}.nama) end`;

const storedLineSchema = z.object({
    id: z.string(),
    item_id: z.string(),
    conversion: z.string(),
    quantity: z.string(),
    unit_cost: z.string(),
    discount_percent: z.string(),
    batch_number: z.string().nullable(),
    expiry: z.string().nullable(),
    funding_source_id: z.string().nullable(),
    procurement_program_id: z.string().nullable(),
    budget_year: z.number().nullable(),
}) satisfies z.ZodType<StoredReceiptLine>;

const messages = {
    vendor_id: 'Pilih vendor dari daftar.',
    location_id: 'Pilih lokasi dari daftar.',
    posting_date: 'Isi tanggal yang benar.',
    vendor_document_number:
        'Isi nomor dokumen vendor paling banyak 50 karakter.',
    description: 'Isi keterangan paling banyak 200 karakter.',
    lines: 'Satu dokumen paling banyak 500 baris.',
    id: 'Baris ini sudah tidak ada. Muat ulang dokumen, lalu ulangi perubahanmu.',
    item_id: 'Pilih barang dari daftar.',
    unit_id: 'Pilih satuan barang ini dari daftar.',
    quantity: 'Isi jumlah lebih dari 0.',
    unit_cost: 'Isi harga satuan 0 atau lebih.',
    discount_percent: 'Isi diskon 0 sampai 100 persen.',
    batch_number: 'Isi nomor batch yang benar.',
    expiry_date: 'Isi tanggal kedaluwarsa yang benar.',
    funding_source_id: 'Pilih sumber dana dari daftar.',
    procurement_program_id: 'Pilih program dari daftar.',
    budget_year: 'Isi tahun anggaran empat angka, misalnya 2026.',
};

// Penerimaan barang dari vendor (Purchase Receipt di BC, tanpa purchase order). Posting menulis stok masuk ke kartu
// gudang lewat mesin posting persediaan dalam satuan dasar; batal posting membaliknya selama stok itu belum dipakai.
export class Receipts {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private get scope() {
        return {
            tenantId: this.workspace.tenantId,
            legalEntityId: activeLegalEntity(this.workspace),
        };
    }

    private async unitCostDecimals(): Promise<number> {
        return unitAmountDecimals(
            await new Currency(this.db, this.scope.tenantId).precision(
                localCurrencyCode,
            ),
        );
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('purchase-receipt', 'read');
        const bindings: string[] = [
            this.scope.tenantId,
            this.scope.legalEntityId,
        ];
        const status = z
            .enum(receiptStatuses)
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
                location: 'location_code',
            },
            searchColumns: [
                'number',
                'vendor_name',
                'location_code',
                'vendor_document_number',
            ],
            numericColumns: [],
            defaultSort: 'posting_date',
            defaultDirection: 'desc',
        });
        return {
            data: batch.data.map((row) => receiptRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            permissions: this.permissions(),
        };
    }

    // Izin dokumen, ditambah izin membuat master yang dirujuknya untuk pilihan Baru di layar.
    private permissions() {
        const has = (permission: string) =>
            this.workspace.permissions.has(`core.${permission}`);
        return {
            update: has('purchase-receipt.update'),
            post: has('purchase-receipt.post'),
            reverse: has('purchase-receipt.reverse'),
            create_vendor: has('vendor.update'),
            create_funding_source: has('inventory-funding-source.update'),
            create_procurement_program: has(
                'inventory-procurement-program.update',
            ),
        };
    }

    private async header(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  receiptRowSchema,
                  `${rowSql} and receipts.id = $3`,
                  [this.scope.tenantId, this.scope.legalEntityId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private async document(id: string) {
        const header = await this.header(id);
        const lines = await this.db.rows(
            receiptLineRowSchema,
            `select d.id, d.urutan as line_no,
                    json_build_object('id', b.id, 'code', b.kode, 'name', b.nama, 'base_unit', base.kode,
                                      'batch_required', coalesce(t.wajib_batch, false),
                                      'expiry_required', coalesce(t.wajib_kedaluwarsa, false)) as item,
                    json_build_object('id', u.id, 'code', u.kode, 'name', u.nama) as unit,
                    trim_scale(d.konversi)::text as quantity_per_unit, trim_scale(d.jumlah)::text as quantity,
                    trim_scale(d.harga_satuan)::text as unit_cost,
                    trim_scale(d.diskon_persen)::text as discount_percent,
                    trim_scale(${lineAmountSql('d')})::text as amount,
                    d.no_batch as batch_number, d.kedaluwarsa::text as expiry_date,
                    ${reference('f')} as funding_source, ${reference('g')} as procurement_program,
                    d.tahun_anggaran as budget_year
             from bl_tr_penerimaan_detail d
             join gd_m_barang b on b.tenant_id = d.tenant_id and b.id = d.barang_id
             join gd_m_satuan base on base.tenant_id = b.tenant_id and base.id = b.satuan_dasar_id
             join gd_m_satuan u on u.tenant_id = d.tenant_id and u.id = d.satuan_id
             left join gd_m_profil_pelacakan t on t.tenant_id = b.tenant_id and t.id = b.profil_pelacakan_id
             left join gd_m_sumber_dana f on f.tenant_id = d.tenant_id and f.id = d.sumber_dana_id
             left join gd_m_program_pengadaan g on g.tenant_id = d.tenant_id and g.id = d.program_pengadaan_id
             where d.tenant_id = $1 and d.penerimaan_id = $2 and d.deleted_at is null
             order by d.urutan, d.id`,
            [this.scope.tenantId, header.id],
        );
        return { ...header, lines };
    }

    async show(id: string) {
        this.workspace.guard('purchase-receipt', 'read');
        return {
            data: await this.document(id),
            permissions: this.permissions(),
        };
    }

    private async activeVendor(id: string) {
        return lookupId(id)
            ? await this.db.one(
                  z.object({ status: z.string() }),
                  `select status from vendors where tenant_id = $1 and legal_entity_id = $2 and id = $3`,
                  [this.scope.tenantId, this.scope.legalEntityId, id],
              )
            : undefined;
    }

    // Isian dokumen. Kecocokan batch dan kedaluwarsa dengan profil pelacakan barang diperiksa saat posting, oleh mesin
    // posting, supaya draf boleh disimpan setengah jadi.
    private async checked(body: unknown) {
        const data = parseInput(receiptInputSchema, body, messages);
        const errors: Record<string, string> = {};
        if (!dateSchema.safeParse(data.posting_date).success)
            errors.posting_date = messages.posting_date;
        const vendor = await this.activeVendor(data.vendor_id);
        if (!vendor) errors.vendor_id = messages.vendor_id;
        else if (vendor.status !== 'active')
            errors.vendor_id =
                'Vendor ini nonaktif. Pilih vendor aktif, atau aktifkan lagi vendornya.';
        const location = lookupId(data.location_id)
            ? await this.db.one(
                  z.object({
                      id: z.string(),
                      operating_unit_id: z.string(),
                      transit: z.boolean(),
                  }),
                  `select id, operating_unit_id, transit from gd_m_lokasi
                   where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null`,
                  [
                      this.scope.tenantId,
                      this.scope.legalEntityId,
                      data.location_id,
                  ],
              )
            : undefined;
        if (!location) errors.location_id = messages.location_id;
        else if (location.transit)
            errors.location_id =
                'Pilih lokasi yang bukan lokasi transit. Lokasi transit hanya dipakai mutasi.';
        const vendorDocument = data.vendor_document_number?.trim() || null;
        if (vendorDocument && vendorDocument.length > 50)
            errors.vendor_document_number = messages.vendor_document_number;
        const description = data.description?.trim() || null;
        if (description && description.length > 200)
            errors.description = messages.description;
        const unitCostDecimals = await this.unitCostDecimals();
        const lines: LineDraft[] = [];
        for (const [index, line] of data.lines.entries()) {
            const field = `lines.${index}`;
            const fail = (name: string, message: string) => {
                errors[`${field}.${name}`] = message;
            };
            if (
                !(await exists(
                    this.db,
                    'gd_m_barang',
                    this.scope,
                    line.item_id,
                ))
            )
                fail('item_id', messages.item_id);
            // Seperti baris pembelian BC yang mengisi Unit of Measure Code dari Purch. Unit of Measure barang.
            const unit = line.unit_id
                ? {
                      unitId: line.unit_id,
                      conversion: await unitConversion(
                          this.db,
                          this.scope,
                          line.item_id,
                          line.unit_id,
                      ),
                  }
                : await defaultUnit(
                      this.db,
                      this.scope,
                      line.item_id,
                      'purchase',
                  );
            const conversion = unit?.conversion ?? null;
            if (conversion === null) fail('unit_id', messages.unit_id);
            const quantity = decimalInput(line.quantity);
            if (quantity === null || quantity <= 0n)
                fail('quantity', `Isi jumlah lebih dari 0, ${quantityHint}.`);
            else if (
                conversion !== null &&
                baseQuantity(quantity, conversion) === null
            )
                fail(
                    'quantity',
                    `Jumlah ini dalam satuan dasar harus ${quantityHint} dan tidak terlalu besar. Ubah jumlah atau satuannya.`,
                );
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
            const batchNumber = line.batch_number?.trim().toUpperCase() || null;
            if (batchNumber && batchNumber.length > 50)
                fail('batch_number', 'Nomor batch paling banyak 50 karakter.');
            const expiry = line.expiry_date?.trim() || null;
            if (expiry !== null && !dateSchema.safeParse(expiry).success)
                fail('expiry_date', messages.expiry_date);
            else if (expiry !== null && !batchNumber)
                fail(
                    'batch_number',
                    'Isi nomor batch. Tanggal kedaluwarsa dicatat per batch.',
                );
            const fundingSourceId = line.funding_source_id || null;
            if (
                fundingSourceId !== null &&
                !(await exists(
                    this.db,
                    'gd_m_sumber_dana',
                    this.scope,
                    fundingSourceId,
                ))
            )
                fail('funding_source_id', messages.funding_source_id);
            const programId = line.procurement_program_id || null;
            if (
                programId !== null &&
                !(await exists(
                    this.db,
                    'gd_m_program_pengadaan',
                    this.scope,
                    programId,
                ))
            )
                fail('procurement_program_id', messages.procurement_program_id);
            const budgetYear = line.budget_year ?? null;
            if (
                budgetYear !== null &&
                (!Number.isInteger(budgetYear) ||
                    budgetYear < 1900 ||
                    budgetYear > 2999)
            )
                fail('budget_year', messages.budget_year);
            lines.push({
                id: line.id ?? null,
                itemId: line.item_id,
                unitId: unit?.unitId ?? '',
                conversion: conversion ?? one,
                quantity: quantity ?? 0n,
                unitCost: unitCost ?? 0n,
                discountPercent: discount ?? 0n,
                batchNumber,
                expiry,
                fundingSourceId,
                programId,
                budgetYear,
            });
        }
        if (Object.keys(errors).length || !location) validation(errors);
        return {
            vendorId: data.vendor_id,
            location,
            postingDate: data.posting_date,
            vendorDocument,
            description,
            lines,
        };
    }

    private async saveLines(documentId: string, lines: LineDraft[]) {
        const existing = new Set(
            (
                await this.db.rows(
                    z.object({ id: z.string() }),
                    `select id from bl_tr_penerimaan_detail
                     where tenant_id = $1 and penerimaan_id = $2 and deleted_at is null`,
                    [this.scope.tenantId, documentId],
                )
            ).map((line) => line.id),
        );
        const kept = new Set<string>();
        const stamp = nowSql();
        for (const [index, line] of lines.entries()) {
            const values = {
                urutan: index + 1,
                barang_id: line.itemId,
                satuan_id: line.unitId,
                konversi: toNumeric(line.conversion, quantityScale),
                jumlah: toNumeric(line.quantity, quantityScale),
                harga_satuan: toNumeric(line.unitCost, quantityScale),
                diskon_persen: toNumeric(line.discountPercent, quantityScale),
                no_batch: line.batchNumber,
                kedaluwarsa: line.expiry,
                sumber_dana_id: line.fundingSourceId,
                program_pengadaan_id: line.programId,
                tahun_anggaran: line.budgetYear,
            };
            if (line.id === null) {
                await this.db.insert('bl_tr_penerimaan_detail', {
                    id: Bun.randomUUIDv7(),
                    tenant_id: this.scope.tenantId,
                    legal_entity_id: this.scope.legalEntityId,
                    penerimaan_id: documentId,
                    ...values,
                    created_at: stamp,
                    updated_at: stamp,
                });
                continue;
            }
            if (!existing.has(line.id) || kept.has(line.id))
                validation({ [`lines.${index}.id`]: messages.id });
            kept.add(line.id);
            await this.db.execute(
                `update bl_tr_penerimaan_detail set urutan = $1, barang_id = $2, satuan_id = $3, konversi = $4,
                        jumlah = $5, harga_satuan = $6, diskon_persen = $7, no_batch = $8, kedaluwarsa = $9,
                        sumber_dana_id = $10, program_pengadaan_id = $11, tahun_anggaran = $12, updated_at = $13
                 where tenant_id = $14 and id = $15`,
                [
                    values.urutan,
                    values.barang_id,
                    values.satuan_id,
                    values.konversi,
                    values.jumlah,
                    values.harga_satuan,
                    values.diskon_persen,
                    values.no_batch,
                    values.kedaluwarsa,
                    values.sumber_dana_id,
                    values.program_pengadaan_id,
                    values.tahun_anggaran,
                    stamp,
                    this.scope.tenantId,
                    line.id,
                ],
            );
        }
        for (const id of existing)
            if (!kept.has(id))
                await this.db.execute(
                    'update bl_tr_penerimaan_detail set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3',
                    [stamp, this.scope.tenantId, id],
                );
    }

    async create(body: unknown) {
        this.workspace.guard('purchase-receipt', 'update');
        const data = await this.checked(body);
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
            await this.db.insert('bl_tr_penerimaan', {
                id,
                tenant_id: this.scope.tenantId,
                legal_entity_id: this.scope.legalEntityId,
                operating_unit_id: data.location.operating_unit_id,
                lokasi_id: data.location.id,
                vendor_id: data.vendorId,
                nomor: number,
                tanggal: data.postingDate,
                no_dokumen_vendor: data.vendorDocument,
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

    // Kepala dokumen dikunci lebih dulu, supaya dua penyimpanan bersamaan tidak menyatukan dua set baris.
    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('purchase-receipt', 'update');
        const current = await this.header(id);
        const data = await this.checked(body);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            const locked = await this.lockHeader(current.id);
            if (locked.status !== 'draf')
                validation({
                    _form: 'Dokumen yang sudah diposting tidak bisa diubah.',
                });
            if (locked.version !== version)
                coded(409, 'stale_version', staleMessage);
            await this.db.execute(
                `update bl_tr_penerimaan set operating_unit_id = $1, lokasi_id = $2, vendor_id = $3, tanggal = $4,
                        no_dokumen_vendor = $5, keterangan = $6, updated_at = $7
                 where tenant_id = $8 and id = $9`,
                [
                    data.location.operating_unit_id,
                    data.location.id,
                    data.vendorId,
                    data.postingDate,
                    data.vendorDocument,
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

    private async lockHeader(id: string) {
        const locked = await this.db.one(
            z.object({
                status: z.enum(receiptStatuses),
                version: z.number(),
            }),
            `select status, version from bl_tr_penerimaan
             where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null for update`,
            [this.scope.tenantId, this.scope.legalEntityId, id],
        );
        if (!locked) abort(404, 'Not Found');
        return locked;
    }

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('purchase-receipt', 'update');
        const current = await this.header(id);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            const locked = await this.lockHeader(current.id);
            if (locked.status !== 'draf')
                validation({
                    _form: 'Dokumen yang sudah diposting tidak bisa dihapus. Batalkan postingnya bila perlu.',
                });
            if (locked.version !== version)
                coded(409, 'stale_version', staleMessage);
            const stamp = nowSql();
            await this.db.execute(
                'update bl_tr_penerimaan set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3',
                [stamp, this.scope.tenantId, current.id],
            );
            await this.db.execute(
                `update bl_tr_penerimaan_detail set deleted_at = $1, updated_at = $1
                 where tenant_id = $2 and penerimaan_id = $3 and deleted_at is null`,
                [stamp, this.scope.tenantId, current.id],
            );
        });
        return { status: 204, headers: {}, body: undefined };
    }

    // Status berpindah dengan compare-and-set di transaksi yang sama dengan postingnya. Permintaan yang diulang setelah
    // dokumennya sampai di status tujuan tidak menulis apa pun dan menjawab dokumen yang sama.
    private async transition(
        id: string,
        version: number,
        move: keyof typeof transitions,
    ) {
        const { from, to, stamp } = transitions[move];
        const claimed = await this.db.one(
            z.object({
                number: z.string(),
                posting_date: z.string(),
                location_id: z.string(),
                vendor_id: z.string(),
            }),
            `update bl_tr_penerimaan set status = $3, ${stamp}, updated_at = $1
             where tenant_id = $4 and legal_entity_id = $5 and id = $6 and status = $7 and version = $8
               and deleted_at is null
             returning nomor as number, tanggal::text as posting_date, lokasi_id as location_id, vendor_id`,
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
            validation({ _form: 'Posting dokumen ini sudah dibatalkan.' });
        if (current.status === 'draf')
            validation({ _form: 'Dokumen ini belum diposting.' });
        return coded(409, 'stale_version', staleMessage);
    }

    async post(request: Request, id: string, body: unknown) {
        this.workspace.guard('purchase-receipt', 'post');
        const current = await this.header(id);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            const claimed = await this.transition(current.id, version, 'post');
            if (!claimed) return;
            const vendor = await this.activeVendor(claimed.vendor_id);
            if (vendor?.status !== 'active')
                validation({
                    vendor_id:
                        'Vendor ini nonaktif, jadi penerimaannya tidak bisa diposting. Aktifkan lagi vendornya atau pilih vendor lain.',
                });
            const location = await this.db.one(
                z.object({ transit: z.boolean() }),
                'select transit from gd_m_lokasi where tenant_id = $1 and id = $2',
                [this.scope.tenantId, claimed.location_id],
            );
            if (location?.transit)
                validation({
                    location_id:
                        'Pilih lokasi yang bukan lokasi transit. Lokasi transit hanya dipakai mutasi.',
                });
            const lines = await this.db.rows(
                storedLineSchema,
                `select id, barang_id as item_id, konversi::text as conversion, jumlah::text as quantity,
                        harga_satuan::text as unit_cost, diskon_persen::text as discount_percent,
                        no_batch as batch_number, kedaluwarsa::text as expiry, sumber_dana_id as funding_source_id,
                        program_pengadaan_id as procurement_program_id, tahun_anggaran as budget_year
                 from bl_tr_penerimaan_detail
                 where tenant_id = $1 and penerimaan_id = $2 and deleted_at is null
                 order by urutan, id`,
                [this.scope.tenantId, current.id],
            );
            if (!lines.length)
                validation({
                    lines: 'Tambahkan sedikitnya satu baris sebelum posting.',
                });
            const unitCostDecimals = await this.unitCostDecimals();
            await raiseBasePrices(
                this.db,
                this.scope,
                receiptBasePrices(lines, unitCostDecimals),
            );
            await postItemLines(
                this.db,
                {
                    tenantId: this.scope.tenantId,
                    legalEntityId: this.scope.legalEntityId,
                    userId: this.workspace.userId,
                    postingDate: claimed.posting_date,
                    source: {
                        type: sourceType,
                        id: current.id,
                        number: claimed.number,
                    },
                },
                lines.map((line, index) =>
                    receiptItemLine(
                        line,
                        claimed.location_id,
                        index,
                        unitCostDecimals,
                    ),
                ),
            );
        });
        return {
            status: 200,
            headers: {},
            body: { data: await this.document(current.id) },
        };
    }

    // Dokumen yang dibatalkan tidak kembali ke draf: kunci idempoten barisnya sudah terpakai di kartu gudang, jadi
    // penerimaan ulang dibuat sebagai dokumen baru. Mesin posting menolak bila stok yang masuk sudah dipakai.
    async reverse(request: Request, id: string, body: unknown) {
        this.workspace.guard('purchase-receipt', 'reverse');
        const current = await this.header(id);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            const claimed = await this.transition(
                current.id,
                version,
                'reverse',
            );
            if (!claimed) return;
            await reverseItemEntries(
                this.db,
                {
                    tenantId: this.scope.tenantId,
                    legalEntityId: this.scope.legalEntityId,
                    userId: this.workspace.userId,
                },
                { type: sourceType, id: current.id },
            );
        });
        return {
            status: 200,
            headers: {},
            body: { data: await this.document(current.id) },
        };
    }
}
