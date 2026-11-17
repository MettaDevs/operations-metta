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
    lookupId,
    staleMessage,
    validation,
} from '../../../platform/http/index.ts';
import {
    activeLegalEntity,
    allowedLocationsSql,
    baseQuantity,
    decimalInput,
    display,
    fromNumeric,
    itemUnits,
    parseInput,
    postItemLines,
    quantityHint,
    quantityScale,
    reverseItemEntries,
    toNumeric,
    type ItemUnitOption,
    type OutboundLine,
} from '../../inventory/index.ts';
import { NumberIssuer } from '../../number-sequence/index.ts';
import { sourceType as receiptSource } from '../receipt/receipt.posting.ts';
import {
    purchaseReturnInputSchema,
    purchaseReturnReverseInputSchema,
    purchaseReturnStatuses,
} from './purchase-return.schema.ts';

export const purchaseReturnSource = 'retur_pembelian';
const numberReference = 'core.purchase-return-number';

const quantityOf = (text: string) => fromNumeric(text, quantityScale);
const quantityText = (value: bigint) => display(value, quantityScale);

const reference = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});

const receiptSchema = z.object({
    id: z.string(),
    number: z.string(),
    status: z.enum(['draf', 'diposting', 'dibatalkan']),
    posting_date: z.string(),
    location_id: z.string(),
    location_name: z.string(),
    operating_unit_id: z.string(),
});
type ReceiptHeader = z.infer<typeof receiptSchema>;

const receiptLineSchema = z.object({
    id: z.string(),
    line_no: z.number(),
    item_id: z.string(),
    item: reference,
    unit: reference,
    conversion: z.string(),
    base_unit: reference,
    batch_number: z.string().nullable(),
    expiry_date: z.string().nullable(),
    received: z.string(),
    returned: z.string(),
});
type ReceiptLine = z.infer<typeof receiptLineSchema> & {
    units: ItemUnitOption[];
    entries: string[];
    open: bigint;
};

const returnRowSchema = z.object({
    id: z.string(),
    number: z.string(),
    status: z.enum(purchaseReturnStatuses),
    posting_date: z.string(),
    reason: z.string(),
    posted_at: z.string(),
    version: z.number(),
    lines: z.array(
        z.object({
            item_name: z.string(),
            batch_number: z.string().nullable(),
            quantity: z.string(),
            unit_code: z.string(),
        }),
    ),
});

const messages = {
    posting_date: 'Isi tanggal retur yang benar.',
    reason: 'Tulis alasan barang dikembalikan ke vendor.',
    lines: 'Isi jumlah yang dikembalikan pada sedikitnya satu baris.',
    receipt_line_id:
        'Baris penerimaan ini sudah tidak ada. Muat ulang penerimaan, lalu ulangi returmu.',
    quantity: `Isi jumlah 0 atau lebih, ${quantityHint}.`,
    unit_id: 'Pilih satuan barang ini dari daftar.',
    version: 'Muat ulang penerimaan, lalu ulangi perubahanmu.',
};

// Satuan baris retur: bawaannya satuan baris penerimaan dengan isi yang disalin saat diterima; satuan lain harus satuan
// barang itu sendiri, dengan isinya sekarang.
function returnUnit(raw: string | null | undefined, line: ReceiptLine) {
    const unitId = raw || line.unit.id;
    if (unitId === line.unit.id)
        return {
            id: unitId,
            code: line.unit.code,
            quantityPerUnit: quantityOf(line.conversion),
        };
    const option = line.units.find((unit) => unit.id === unitId);
    return option
        ? {
              id: option.id,
              code: option.code,
              quantityPerUnit: quantityOf(option.quantity_per_unit),
          }
        : null;
}

// Retur ke vendor atas satu penerimaan yang sudah diposting (Purchase Return Order lalu Post Ship di BC, dengan baris dari
// Get Posted Document Lines to Reverse). Stok keluar dari lokasi penerimaan tepat dari baris kartu gudang penerimaan itu
// (Appl.-to Item Entry), jadi batch, harga satuan, dan sumber dananya sama dengan saat masuk, dan yang sudah terpakai
// dokumen lain tidak bisa diretur. Retur langsung diposting saat disimpan; Batal retur membaliknya selama stoknya belum
// terpakai, dan barang itu boleh diretur lagi sesudahnya.
export class PurchaseReturns {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
        private readonly receiptId: string,
    ) {}

    private get scope() {
        return {
            tenantId: this.workspace.tenantId,
            legalEntityId: activeLegalEntity(this.workspace),
        };
    }

    private async receipt(lock: boolean): Promise<ReceiptHeader> {
        const bindings = [
            this.scope.tenantId,
            this.scope.legalEntityId,
            this.receiptId,
        ];
        const found = lookupId(this.receiptId)
            ? await this.db.one(
                  receiptSchema,
                  `select h.id, h.nomor as number, h.status, h.tanggal::text as posting_date,
                          h.lokasi_id as location_id, l.nama as location_name, h.operating_unit_id
                   from bl_tr_penerimaan h
                   join gd_m_lokasi l on l.tenant_id = h.tenant_id and l.id = h.lokasi_id
                   where h.tenant_id = $1 and h.legal_entity_id = $2 and h.id = $3 and h.deleted_at is null
                     and ${allowedLocationsSql(this.workspace, bindings, ['h.lokasi_id'])}
                   ${lock ? 'for update of h' : ''}`,
                  bindings,
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    // Baris penerimaan beserta baris kartu gudang yang masih boleh diambil retur: baris masuk penerimaan itu, ditambah
    // baris yang kembali karena Batal retur atas baris itu. Sisanya adalah yang masih ada di lokasi dan bisa diretur.
    private async lines(receipt: ReceiptHeader): Promise<ReceiptLine[]> {
        const rows = await this.db.rows(
            receiptLineSchema,
            `select d.id, d.urutan as line_no, d.barang_id as item_id,
                    json_build_object('id', b.id, 'code', b.kode, 'name', b.nama) as item,
                    json_build_object('id', s.id, 'code', s.kode, 'name', s.nama) as unit,
                    trim_scale(d.konversi)::text as conversion,
                    json_build_object('id', bs.id, 'code', bs.kode, 'name', bs.nama) as base_unit,
                    d.no_batch as batch_number, d.kedaluwarsa::text as expiry_date,
                    trim_scale(d.jumlah * d.konversi)::text as received,
                    coalesce((select trim_scale(sum(r.jumlah * r.konversi))
                              from bl_tr_retur_detail r
                              join bl_tr_retur h on h.tenant_id = r.tenant_id and h.id = r.retur_id
                              where r.tenant_id = d.tenant_id and r.penerimaan_detail_id = d.id
                                and h.status = 'diposting' and r.deleted_at is null)::text, '0') as returned
             from bl_tr_penerimaan_detail d
             join gd_m_barang b on b.tenant_id = d.tenant_id and b.id = d.barang_id
             join gd_m_satuan s on s.tenant_id = d.tenant_id and s.id = d.satuan_id
             join gd_m_satuan bs on bs.tenant_id = b.tenant_id and bs.id = b.satuan_dasar_id
             where d.tenant_id = $1 and d.penerimaan_id = $2 and d.deleted_at is null
             order by d.urutan, d.id`,
            [this.scope.tenantId, receipt.id],
        );
        const entries = await this.db.rows(
            z.object({ line_id: z.string(), id: z.string(), open: z.string() }),
            `select d.id as line_id, k.id, k.sisa::text as open
             from bl_tr_penerimaan_detail d
             join gd_tr_kartu_gudang k on k.tenant_id = d.tenant_id and k.legal_entity_id = $3 and k.jumlah > 0
                  and k.sisa > 0
                  and ((k.sumber_jenis = $4 and k.sumber_id = d.penerimaan_id and k.sumber_baris_id = d.id
                        and k.dibalik_dari is null)
                       or (k.sumber_jenis = $5 and k.dibalik_dari is not null
                           and k.sumber_baris_id in (select r.id from bl_tr_retur_detail r
                                                     where r.tenant_id = d.tenant_id
                                                       and r.penerimaan_detail_id = d.id)))
             where d.tenant_id = $1 and d.penerimaan_id = $2 and d.deleted_at is null
             order by k.tanggal_posting, k.id`,
            [
                this.scope.tenantId,
                receipt.id,
                this.scope.legalEntityId,
                receiptSource,
                purchaseReturnSource,
            ],
        );
        const units = await itemUnits(
            this.db,
            this.scope,
            rows.map((row) => row.item_id),
        );
        return rows.map((row) => {
            const own = entries.filter((entry) => entry.line_id === row.id);
            return {
                ...row,
                units: units.get(row.item_id) ?? [],
                entries: own.map((entry) => entry.id),
                open: own.reduce(
                    (sum, entry) => sum + quantityOf(entry.open),
                    0n,
                ),
            };
        });
    }

    private permissions() {
        const has = (permission: string) =>
            this.workspace.permissions.has(`core.${permission}`);
        return {
            create: has('purchase-receipt.post'),
            reverse: has('purchase-receipt.reverse'),
        };
    }

    async show() {
        this.workspace.guard('purchase-receipt', 'read');
        const receipt = await this.receipt(false);
        const lines =
            receipt.status === 'diposting' ? await this.lines(receipt) : [];
        const returns = await this.db.rows(
            returnRowSchema,
            `select h.id, h.nomor as number, h.status, h.tanggal::text as posting_date, h.alasan as reason,
                    ${isoSql('h.diposting_pada')} as posted_at, h.version,
                    coalesce((select json_agg(json_build_object('item_name', b.nama, 'batch_number', p.no_batch,
                                                                'quantity', trim_scale(d.jumlah)::text,
                                                                'unit_code', s.kode)
                                              order by d.urutan)
                              from bl_tr_retur_detail d
                              join bl_tr_penerimaan_detail p on p.tenant_id = d.tenant_id
                                   and p.id = d.penerimaan_detail_id
                              join gd_m_barang b on b.tenant_id = d.tenant_id and b.id = d.barang_id
                              join gd_m_satuan s on s.tenant_id = d.tenant_id and s.id = d.satuan_id
                              where d.tenant_id = h.tenant_id and d.retur_id = h.id
                                and d.deleted_at is null), '[]') as lines
             from bl_tr_retur h
             where h.tenant_id = $1 and h.penerimaan_id = $2 and h.deleted_at is null
             order by h.diposting_pada, h.id`,
            [this.scope.tenantId, receipt.id],
        );
        return {
            data: {
                receipt_status: receipt.status,
                returnable: lines.map((line) => ({
                    receipt_line_id: line.id,
                    line_no: line.line_no,
                    item: line.item,
                    unit: line.unit,
                    quantity_per_unit: quantityText(
                        quantityOf(line.conversion),
                    ),
                    base_unit: line.base_unit,
                    units: line.units,
                    batch_number: line.batch_number,
                    expiry_date: line.expiry_date,
                    received: quantityText(quantityOf(line.received)),
                    returned: quantityText(quantityOf(line.returned)),
                    returnable: quantityText(line.open),
                })),
                returns,
            },
            permissions: this.permissions(),
        };
    }

    async create(body: unknown) {
        this.workspace.guard('purchase-receipt', 'post');
        const data = parseInput(purchaseReturnInputSchema, body, messages);
        await this.db.transaction(async () => {
            const receipt = await this.receipt(true);
            if (receipt.status === 'draf')
                validation({
                    _form: `Penerimaan ${receipt.number} belum diposting, jadi belum ada barang yang bisa diretur. Ubah atau hapus drafnya saja.`,
                });
            if (receipt.status === 'dibatalkan')
                validation({
                    _form: `Posting penerimaan ${receipt.number} sudah dibatalkan, jadi tidak ada barang yang bisa diretur.`,
                });
            const lines = new Map(
                (await this.lines(receipt)).map((line) => [line.id, line]),
            );
            const errors: Record<string, string> = {};
            if (!dateSchema.safeParse(data.posting_date).success)
                errors.posting_date = messages.posting_date;
            else if (data.posting_date < receipt.posting_date)
                errors.posting_date =
                    'Tanggal retur tidak boleh sebelum tanggal penerimaan.';
            const reason = data.reason.trim();
            if (!reason) errors.reason = messages.reason;
            else if (reason.length > 200)
                errors.reason = 'Alasan paling banyak 200 karakter.';
            const taken = new Set<string>();
            const chosen = data.lines.flatMap((input, index) => {
                const field = `lines.${index}`;
                const quantity = decimalInput(input.quantity);
                if (quantity === null || quantity < 0n) {
                    errors[`${field}.quantity`] = messages.quantity;
                    return [];
                }
                if (quantity === 0n) return [];
                const line = lookupId(input.receipt_line_id)
                    ? lines.get(input.receipt_line_id)
                    : undefined;
                if (!line || taken.has(line.id)) {
                    errors[`${field}.receipt_line_id`] =
                        messages.receipt_line_id;
                    return [];
                }
                taken.add(line.id);
                const unit = returnUnit(input.unit_id, line);
                if (!unit) {
                    errors[`${field}.unit_id`] = messages.unit_id;
                    return [];
                }
                const base = baseQuantity(quantity, unit.quantityPerUnit);
                if (base === null) {
                    errors[`${field}.quantity`] =
                        `Jumlah ini tidak bulat dalam ${line.base_unit.code}. Pilih satuan lain atau ubah jumlahnya.`;
                    return [];
                }
                if (base > line.open) {
                    errors[`${field}.quantity`] =
                        line.open > 0n
                            ? `Paling banyak ${quantityText(line.open)} ${line.base_unit.code}: barang dari penerimaan ini yang masih ada di ${receipt.location_name}.`
                            : `Barang dari baris ini sudah tidak ada di ${receipt.location_name}: sudah diretur atau sudah dipakai.`;
                    return [];
                }
                return [{ index, line, quantity, unit, base }];
            });
            if (!Object.keys(errors).length && !chosen.length)
                errors.lines = messages.lines;
            if (Object.keys(errors).length) validation(errors);
            const id = Bun.randomUUIDv7();
            const number = await new NumberIssuer(this.db, {
                tenantId: this.scope.tenantId,
                moduleId: 'core',
            }).issue({
                reference: numberReference,
                key: `${purchaseReturnSource}:${id}`,
                documentDate: data.posting_date,
                legalEntityId: this.scope.legalEntityId,
            });
            const stamp = nowSql();
            await this.db.insert('bl_tr_retur', {
                id,
                tenant_id: this.scope.tenantId,
                legal_entity_id: this.scope.legalEntityId,
                operating_unit_id: receipt.operating_unit_id,
                penerimaan_id: receipt.id,
                nomor: number,
                tanggal: data.posting_date,
                alasan: reason,
                diposting_pada: stamp,
                diposting_oleh_user_id: this.workspace.userId,
                created_at: stamp,
                updated_at: stamp,
            });
            const outbound: OutboundLine[] = [];
            for (const [order, entry] of chosen.entries()) {
                const detailId = Bun.randomUUIDv7();
                await this.db.insert('bl_tr_retur_detail', {
                    id: detailId,
                    tenant_id: this.scope.tenantId,
                    legal_entity_id: this.scope.legalEntityId,
                    retur_id: id,
                    penerimaan_detail_id: entry.line.id,
                    urutan: order + 1,
                    barang_id: entry.line.item_id,
                    satuan_id: entry.unit.id,
                    konversi: toNumeric(
                        entry.unit.quantityPerUnit,
                        quantityScale,
                    ),
                    jumlah: toNumeric(entry.quantity, quantityScale),
                    created_at: stamp,
                    updated_at: stamp,
                });
                outbound.push({
                    kind: 'outbound',
                    entryKind: 'penerimaan',
                    key: `${purchaseReturnSource}:${detailId}`,
                    field: `lines.${entry.index}`,
                    sourceLineId: detailId,
                    itemId: entry.line.item_id,
                    locationId: receipt.location_id,
                    batchId: null,
                    quantity: entry.base,
                    appliesTo: entry.line.entries,
                });
            }
            await postItemLines(
                this.db,
                {
                    tenantId: this.scope.tenantId,
                    legalEntityId: this.scope.legalEntityId,
                    userId: this.workspace.userId,
                    postingDate: data.posting_date,
                    source: { type: purchaseReturnSource, id, number },
                },
                outbound,
            );
        });
        return this.show();
    }

    // Batal retur: barang yang keluar lewat retur ini masuk lagi ke lokasi penerimaan dengan batch, harga, dan sumber dana
    // yang sama, bertanggal sama dengan returnya, jadi ditolak bila periodenya sudah ditutup.
    async reverse(returnId: string, body: unknown) {
        this.workspace.guard('purchase-receipt', 'reverse');
        const { version } = parseInput(purchaseReturnReverseInputSchema, body, {
            version: messages.version,
        });
        await this.db.transaction(async () => {
            const receipt = await this.receipt(true);
            const current = lookupId(returnId)
                ? await this.db.one(
                      z.object({ status: z.string(), version: z.number() }),
                      `select status, version from bl_tr_retur
                       where tenant_id = $1 and penerimaan_id = $2 and id = $3 and deleted_at is null`,
                      [this.scope.tenantId, receipt.id, returnId],
                  )
                : undefined;
            if (!current) abort(404, 'Not Found');
            if (current.status === 'dibatalkan') return;
            if (current.version !== version)
                coded(409, 'stale_version', staleMessage);
            const stamp = nowSql();
            await this.db.execute(
                `update bl_tr_retur set status = 'dibatalkan', dibatalkan_pada = $1, dibatalkan_oleh_user_id = $2,
                        updated_at = $1
                 where tenant_id = $3 and id = $4`,
                [stamp, this.workspace.userId, this.scope.tenantId, returnId],
            );
            await reverseItemEntries(
                this.db,
                {
                    tenantId: this.scope.tenantId,
                    legalEntityId: this.scope.legalEntityId,
                    userId: this.workspace.userId,
                },
                { type: purchaseReturnSource, id: returnId },
            );
        });
        return this.show();
    }
}

// Nomor retur pertama atas sebuah penerimaan, untuk menolak Batal posting penerimaan yang sudah pernah diretur.
export async function firstReturnNumber(
    db: Database,
    tenantId: string,
    receiptId: string,
): Promise<string | null> {
    const found = await db.one(
        z.object({ number: z.string() }),
        `select nomor as number from bl_tr_retur
         where tenant_id = $1 and penerimaan_id = $2 and deleted_at is null
         order by diposting_pada, id limit 1`,
        [tenantId, receiptId],
    );
    return found?.number ?? null;
}
