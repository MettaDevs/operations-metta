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
import { decimalsHint } from '../../../platform/money/index.ts';
import {
    Currency,
    localCurrencyCode,
    unitAmountDecimals,
} from '../../currency/index.ts';
import { NumberIssuer } from '../../number-sequence/index.ts';
import { activeLegalEntity, exists, parseInput } from '../inventory.service.ts';
import {
    postItemLines,
    reverseItemEntries,
    type ItemLine,
} from '../item-ledger/item-ledger.posting.ts';
import {
    decimalInput,
    fromNumeric,
    quantityHint,
    quantityScale,
    toNumeric,
    unitCostInput,
} from '../quantity.ts';
import {
    adjustmentDirections,
    adjustmentEntryRowSchema,
    adjustmentInputSchema,
    adjustmentLineRowSchema,
    adjustmentRowSchema,
    adjustmentStatuses,
} from './adjustment.schema.ts';

const sourceType = 'penyesuaian';
export const adjustmentNumberReference = 'core.inventory-adjustment-number';

type Direction = (typeof adjustmentDirections)[number];

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
    quantity: bigint;
    batchNumber: string | null;
    expiry: string | null;
    unitCost: bigint | null;
    batchId: string | null;
};

const rowSql = `select * from (
                    select h.id, h.nomor as number, h.arah as direction, h.tanggal::text as posting_date, h.status,
                           h.version, l.kode as location_code, a.kode as reason_code,
                           json_build_object('id', l.id, 'code', l.kode, 'name', l.nama) as location,
                           json_build_object('id', a.id, 'code', a.kode, 'name', a.nama) as reason,
                           ${isoSql('h.diposting_pada')} as posted_at, ${isoSql('h.dibatalkan_pada')} as reversed_at
                    from gd_tr_penyesuaian h
                    join gd_m_lokasi l on l.tenant_id = h.tenant_id and l.id = h.lokasi_id
                    join gd_m_alasan a on a.tenant_id = h.tenant_id and a.id = h.alasan_id
                    where h.tenant_id = $1 and h.legal_entity_id = $2 and h.deleted_at is null) adjustments
                where true`;

const storedLineSchema = z.object({
    id: z.string(),
    item_id: z.string(),
    quantity: z.string(),
    batch_number: z.string().nullable(),
    expiry: z.string().nullable(),
    unit_cost: z.string().nullable(),
    batch_id: z.string().nullable(),
});
type StoredLine = z.infer<typeof storedLineSchema>;

const messages = {
    direction: 'Pilih stok masuk atau stok keluar.',
    location_id: 'Pilih lokasi dari daftar.',
    posting_date: 'Isi tanggal yang benar.',
    reason_id: 'Pilih alasan dari daftar.',
    lines: 'Satu dokumen paling banyak 500 baris.',
    id: 'Baris ini sudah tidak ada. Muat ulang dokumen, lalu ulangi perubahanmu.',
    item_id: 'Pilih barang dari daftar.',
    quantity: 'Isi jumlah lebih dari 0.',
    batch_number: 'Isi nomor batch yang benar.',
    expiry_date: 'Isi tanggal kedaluwarsa yang benar.',
    unit_cost: 'Isi harga satuan 0 atau lebih.',
    batch_id: 'Pilih batch dari daftar.',
};

// Alasan yang dicatat sebagai pemakaian menulis jenis pemakaian ke dua arah (Consumption di BC; masuk berarti
// pengembalian sisa pemakaian). Alasan lain menulis penyesuaian tambah atau kurang.
function itemLine(
    direction: Direction,
    consumption: boolean,
    locationId: string,
    line: StoredLine,
    index: number,
): ItemLine {
    const base = {
        key: `${sourceType}:${line.id}`,
        field: `lines.${index}`,
        sourceLineId: line.id,
        itemId: line.item_id,
        quantity: fromNumeric(line.quantity, quantityScale),
    };
    switch (direction) {
        case 'masuk':
            if (line.unit_cost === null)
                throw new Error(
                    `Inbound adjustment line ${line.id} has no unit cost.`,
                );
            return {
                ...base,
                kind: 'inbound',
                entryKind: consumption ? 'pemakaian' : 'penyesuaian_tambah',
                locationId,
                unitCost: fromNumeric(line.unit_cost, quantityScale),
                batchNumber: line.batch_number,
                expiry: line.expiry,
            };
        case 'keluar':
            return {
                ...base,
                kind: 'outbound',
                entryKind: consumption ? 'pemakaian' : 'penyesuaian_kurang',
                locationId,
                batchId: line.batch_id,
            };
        default: {
            const unknown: never = direction;
            throw new Error(`Unknown direction: ${String(unknown)}`);
        }
    }
}

export class Adjustments {
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

    async list(parameters: URLSearchParams) {
        this.workspace.guard('inventory-adjustment', 'read');
        const bindings: string[] = [
            this.scope.tenantId,
            this.scope.legalEntityId,
        ];
        let filter = '';
        const status = z
            .enum(adjustmentStatuses)
            .safeParse(parameters.get('status'));
        if (status.success)
            filter += ` and status = $${bindings.push(status.data)}`;
        const direction = z
            .enum(adjustmentDirections)
            .safeParse(parameters.get('stock_direction'));
        if (direction.success)
            filter += ` and direction = $${bindings.push(direction.data)}`;
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${filter}`,
            bindings,
            parameters,
            columns: {
                number: 'number',
                posting_date: 'posting_date',
                status: 'status',
                location: 'location_code',
                reason: 'reason_code',
            },
            searchColumns: ['number', 'location_code', 'reason_code'],
            numericColumns: [],
            defaultSort: 'posting_date',
            defaultDirection: 'desc',
        });
        return {
            data: batch.data.map((row) => adjustmentRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            permissions: this.permissions(),
        };
    }

    private permissions() {
        const has = (action: string) =>
            this.workspace.permissions.has(
                `core.inventory-adjustment.${action}`,
            );
        return {
            update: has('update'),
            post: has('post'),
            reverse: has('reverse'),
        };
    }

    private async header(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  adjustmentRowSchema,
                  `${rowSql} and adjustments.id = $3`,
                  [this.scope.tenantId, this.scope.legalEntityId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private async document(id: string) {
        const header = await this.header(id);
        const lines = await this.db.rows(
            adjustmentLineRowSchema,
            `select d.id, d.urutan as line_no,
                    json_build_object('id', b.id, 'code', b.kode, 'name', b.nama, 'unit', s.kode,
                                      'batch_required', coalesce(p.wajib_batch, false),
                                      'expiry_required', coalesce(p.wajib_kedaluwarsa, false)) as item,
                    trim_scale(d.jumlah)::text as quantity, d.no_batch as batch_number,
                    d.kedaluwarsa::text as expiry_date, trim_scale(d.harga_satuan)::text as unit_cost,
                    case when t.id is null then null else json_build_object(
                        'id', t.id, 'batch_number', t.no_batch, 'expiry_date', t.kedaluwarsa) end as batch
             from gd_tr_penyesuaian_detail d
             join gd_m_barang b on b.tenant_id = d.tenant_id and b.id = d.barang_id
             join gd_m_satuan s on s.tenant_id = b.tenant_id and s.id = b.satuan_dasar_id
             left join gd_m_profil_pelacakan p on p.tenant_id = b.tenant_id and p.id = b.profil_pelacakan_id
             left join gd_m_batch t on t.tenant_id = d.tenant_id and t.id = d.batch_id
             where d.tenant_id = $1 and d.penyesuaian_id = $2 and d.deleted_at is null
             order by d.urutan, d.id`,
            [this.scope.tenantId, header.id],
        );
        return { ...header, lines };
    }

    async show(id: string) {
        this.workspace.guard('inventory-adjustment', 'read');
        return {
            data: await this.document(id),
            permissions: this.permissions(),
        };
    }

    async entries(id: string) {
        this.workspace.guard('inventory-adjustment', 'read');
        const header = await this.header(id);
        return {
            amount_decimals: (
                await new Currency(this.db, this.scope.tenantId).precision(
                    localCurrencyCode,
                )
            ).amount_decimals,
            data: await this.db.rows(
                adjustmentEntryRowSchema,
                `select k.id, json_build_object('id', b.id, 'code', b.kode, 'name', b.nama, 'unit', s.kode) as item,
                        case when t.id is null then null else json_build_object(
                            'id', t.id, 'batch_number', t.no_batch, 'expiry_date', t.kedaluwarsa) end as batch,
                        trim_scale(k.jumlah)::text as quantity, trim_scale(k.nilai)::text as cost_amount,
                        k.dibalik_dari as reversed_entry_id
                 from gd_tr_kartu_gudang k
                 join gd_m_barang b on b.tenant_id = k.tenant_id and b.id = k.barang_id
                 join gd_m_satuan s on s.tenant_id = b.tenant_id and s.id = b.satuan_dasar_id
                 left join gd_m_batch t on t.tenant_id = k.tenant_id and t.id = k.batch_id
                 where k.tenant_id = $1 and k.legal_entity_id = $2 and k.sumber_jenis = $3 and k.sumber_id = $4
                 order by k.created_at, k.id`,
                [
                    this.scope.tenantId,
                    this.scope.legalEntityId,
                    sourceType,
                    header.id,
                ],
            ),
        };
    }

    // Isian dokumen. Kecocokan batch dan kedaluwarsa dengan profil pelacakan barang diperiksa saat posting, oleh mesin
    // posting, supaya draf boleh disimpan setengah jadi.
    private async checked(body: unknown) {
        const data = parseInput(adjustmentInputSchema, body, messages);
        const errors: Record<string, string> = {};
        if (!dateSchema.safeParse(data.posting_date).success)
            errors.posting_date = messages.posting_date;
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
        if (!(await exists(this.db, 'gd_m_alasan', this.scope, data.reason_id)))
            errors.reason_id = messages.reason_id;
        const unitCostDecimals = unitAmountDecimals(
            await new Currency(this.db, this.scope.tenantId).precision(
                localCurrencyCode,
            ),
        );
        const lines: LineDraft[] = [];
        for (const [index, line] of data.lines.entries()) {
            const field = `lines.${index}`;
            if (
                !(await exists(
                    this.db,
                    'gd_m_barang',
                    this.scope,
                    line.item_id,
                ))
            )
                errors[`${field}.item_id`] = messages.item_id;
            const quantity = decimalInput(line.quantity);
            if (quantity === null || quantity <= 0n)
                errors[`${field}.quantity`] =
                    `Isi jumlah lebih dari 0, ${quantityHint}.`;
            const draft: LineDraft = {
                id: line.id ?? null,
                itemId: line.item_id,
                quantity: quantity ?? 0n,
                batchNumber: null,
                expiry: null,
                unitCost: null,
                batchId: null,
            };
            switch (data.direction) {
                case 'masuk': {
                    if (line.batch_id)
                        errors[`${field}.batch_id`] =
                            'Batch dipilih hanya untuk stok keluar. Untuk stok masuk, isi nomor batch.';
                    draft.batchNumber =
                        line.batch_number?.trim().toUpperCase() || null;
                    if (draft.batchNumber && draft.batchNumber.length > 50)
                        errors[`${field}.batch_number`] =
                            'Nomor batch paling banyak 50 karakter.';
                    draft.expiry = line.expiry_date?.trim() || null;
                    if (
                        draft.expiry !== null &&
                        !dateSchema.safeParse(draft.expiry).success
                    )
                        errors[`${field}.expiry_date`] = messages.expiry_date;
                    else if (draft.expiry !== null && !draft.batchNumber)
                        errors[`${field}.batch_number`] =
                            'Isi nomor batch. Tanggal kedaluwarsa dicatat per batch.';
                    draft.unitCost =
                        line.unit_cost === null || line.unit_cost === undefined
                            ? null
                            : unitCostInput(line.unit_cost, unitCostDecimals);
                    if (draft.unitCost === null)
                        errors[`${field}.unit_cost`] =
                            `Isi harga satuan 0 atau lebih, ${decimalsHint(unitCostDecimals)}.`;
                    break;
                }
                case 'keluar': {
                    if (line.batch_number)
                        errors[`${field}.batch_number`] =
                            'Nomor batch baru hanya untuk stok masuk. Untuk stok keluar, pilih batch yang diambil.';
                    if (line.expiry_date)
                        errors[`${field}.expiry_date`] =
                            'Tanggal kedaluwarsa hanya diisi untuk stok masuk.';
                    if (line.unit_cost !== null && line.unit_cost !== undefined)
                        errors[`${field}.unit_cost`] =
                            'Harga satuan hanya diisi untuk stok masuk. Stok keluar memakai harga stok yang diambil.';
                    draft.batchId = line.batch_id ?? null;
                    if (
                        draft.batchId !== null &&
                        !(await this.batchOf(draft.batchId, line.item_id))
                    )
                        errors[`${field}.batch_id`] = messages.batch_id;
                    break;
                }
                default: {
                    const unknown: never = data.direction;
                    throw new Error(`Unknown direction: ${String(unknown)}`);
                }
            }
            lines.push(draft);
        }
        if (Object.keys(errors).length || !location) validation(errors);
        return {
            direction: data.direction,
            location,
            postingDate: data.posting_date,
            reasonId: data.reason_id,
            lines,
        };
    }

    private async batchOf(batchId: string, itemId: string) {
        if (!lookupId(batchId) || !lookupId(itemId)) return false;
        return (
            (await this.db.one(
                z.object({ id: z.string() }),
                `select id from gd_m_batch
                 where tenant_id = $1 and legal_entity_id = $2 and id = $3 and barang_id = $4`,
                [
                    this.scope.tenantId,
                    this.scope.legalEntityId,
                    batchId,
                    itemId,
                ],
            )) !== undefined
        );
    }

    private async saveLines(documentId: string, lines: LineDraft[]) {
        const existing = new Set(
            (
                await this.db.rows(
                    z.object({ id: z.string() }),
                    `select id from gd_tr_penyesuaian_detail
                     where tenant_id = $1 and penyesuaian_id = $2 and deleted_at is null`,
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
                jumlah: toNumeric(line.quantity, quantityScale),
                no_batch: line.batchNumber,
                kedaluwarsa: line.expiry,
                harga_satuan:
                    line.unitCost === null
                        ? null
                        : toNumeric(line.unitCost, quantityScale),
                batch_id: line.batchId,
            };
            if (line.id === null) {
                await this.db.insert('gd_tr_penyesuaian_detail', {
                    id: Bun.randomUUIDv7(),
                    tenant_id: this.scope.tenantId,
                    legal_entity_id: this.scope.legalEntityId,
                    penyesuaian_id: documentId,
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
                `update gd_tr_penyesuaian_detail set urutan = $1, barang_id = $2, jumlah = $3, no_batch = $4,
                        kedaluwarsa = $5, harga_satuan = $6, batch_id = $7, updated_at = $8
                 where tenant_id = $9 and id = $10`,
                [
                    values.urutan,
                    values.barang_id,
                    values.jumlah,
                    values.no_batch,
                    values.kedaluwarsa,
                    values.harga_satuan,
                    values.batch_id,
                    stamp,
                    this.scope.tenantId,
                    line.id,
                ],
            );
        }
        for (const id of existing)
            if (!kept.has(id))
                await this.db.execute(
                    'update gd_tr_penyesuaian_detail set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3',
                    [stamp, this.scope.tenantId, id],
                );
    }

    async create(body: unknown) {
        this.workspace.guard('inventory-adjustment', 'update');
        const data = await this.checked(body);
        const id = Bun.randomUUIDv7();
        await this.db.transaction(async () => {
            const number = await new NumberIssuer(this.db, {
                tenantId: this.scope.tenantId,
                moduleId: 'core',
            }).issue({
                reference: adjustmentNumberReference,
                key: `${sourceType}:${id}`,
                documentDate: data.postingDate,
                legalEntityId: this.scope.legalEntityId,
            });
            const stamp = nowSql();
            await this.db.insert('gd_tr_penyesuaian', {
                id,
                tenant_id: this.scope.tenantId,
                legal_entity_id: this.scope.legalEntityId,
                operating_unit_id: data.location.operating_unit_id,
                lokasi_id: data.location.id,
                nomor: number,
                arah: data.direction,
                tanggal: data.postingDate,
                alasan_id: data.reasonId,
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
        this.workspace.guard('inventory-adjustment', 'update');
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
                `update gd_tr_penyesuaian set operating_unit_id = $1, lokasi_id = $2, arah = $3, tanggal = $4,
                        alasan_id = $5, updated_at = $6
                 where tenant_id = $7 and id = $8`,
                [
                    data.location.operating_unit_id,
                    data.location.id,
                    data.direction,
                    data.postingDate,
                    data.reasonId,
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
                status: z.enum(adjustmentStatuses),
                version: z.number(),
            }),
            `select status, version from gd_tr_penyesuaian
             where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null for update`,
            [this.scope.tenantId, this.scope.legalEntityId, id],
        );
        if (!locked) abort(404, 'Not Found');
        return locked;
    }

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-adjustment', 'update');
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
                'update gd_tr_penyesuaian set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3',
                [stamp, this.scope.tenantId, current.id],
            );
            await this.db.execute(
                `update gd_tr_penyesuaian_detail set deleted_at = $1, updated_at = $1
                 where tenant_id = $2 and penyesuaian_id = $3 and deleted_at is null`,
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
                direction: z.enum(adjustmentDirections),
                posting_date: z.string(),
                location_id: z.string(),
                consumption: z.boolean(),
            }),
            `update gd_tr_penyesuaian h set status = $3, ${stamp}, updated_at = $1
             where tenant_id = $4 and legal_entity_id = $5 and id = $6 and status = $7 and version = $8
               and deleted_at is null
             returning nomor as number, arah as direction, tanggal::text as posting_date, lokasi_id as location_id,
                       (select a.pemakaian from gd_m_alasan a where a.tenant_id = h.tenant_id and a.id = h.alasan_id)
                           as consumption`,
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
        this.workspace.guard('inventory-adjustment', 'post');
        const current = await this.header(id);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            const claimed = await this.transition(current.id, version, 'post');
            if (!claimed) return;
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
                `select id, barang_id as item_id, jumlah::text as quantity, no_batch as batch_number,
                        kedaluwarsa::text as expiry, harga_satuan::text as unit_cost, batch_id
                 from gd_tr_penyesuaian_detail
                 where tenant_id = $1 and penyesuaian_id = $2 and deleted_at is null
                 order by urutan, id`,
                [this.scope.tenantId, current.id],
            );
            if (!lines.length)
                validation({
                    lines: 'Tambahkan sedikitnya satu baris sebelum posting.',
                });
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
                    itemLine(
                        claimed.direction,
                        claimed.consumption,
                        claimed.location_id,
                        line,
                        index,
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
    // posting ulang dibuat sebagai dokumen baru.
    async reverse(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-adjustment', 'reverse');
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
