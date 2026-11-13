import { z } from 'zod';
import type { Workspace } from '@core/platform/access/index.ts';
import {
    isoSql,
    nowSql,
    type Database,
} from '@core/platform/database/index.ts';
import {
    abort,
    coded,
    lookupId,
    staleMessage,
    validation,
} from '@core/platform/http/index.ts';
import {
    activeLegalEntity,
    baseQuantity,
    decimalInput,
    issuedSlices,
    itemUnits,
    parseInput,
    postItemLines,
    quantityHint,
    quantityScale,
    reverseItemEntries,
    toNumeric,
    type InboundLine,
    type IssuedSlice,
    type ItemUnitOption,
} from '@core/foundation/inventory/index.ts';
import { NumberIssuer } from '@core/foundation/number-sequence/index.ts';
import { moduleId } from '../../module.ts';
import {
    dispensingSource,
    inexactBaseMessage,
} from '../dispensing/dispensing.service.ts';
import {
    baseQuantityText,
    quantityOf,
    quantityText,
} from '../dispensing/dispensing.units.ts';
import {
    publishReturn,
    returnPosted,
    returnReversed,
} from './dispensing-return.events.ts';
import {
    returnInputSchema,
    returnReverseInputSchema,
} from './dispensing-return.schema.ts';

const returnSource = 'retur_farmasi';
const returnNumberReference = 'pharmacy.return-number';

const batchKey = (lineId: string, batchId: string | null) =>
    `${lineId}:${batchId ?? '-'}`;

const reference = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});

const dispensedLineSchema = z.object({
    id: z.string(),
    item_id: z.string(),
    code: z.string(),
    name: z.string(),
    unit: reference,
    conversion: z.string(),
    base_unit: reference,
});
type DispensedLine = z.infer<typeof dispensedLineSchema> & {
    units: ItemUnitOption[];
};

// Bawaannya satuan saat diserahkan, dengan isi yang disalin waktu itu; satuan lain harus satuan barang itu sendiri,
// dengan isinya sekarang.
function returnUnit(raw: string | null | undefined, line: DispensedLine) {
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

const messages = {
    reason: 'Tulis alasan obat dikembalikan.',
    lines: 'Pilih sedikitnya satu obat yang dikembalikan.',
    dispensing_line_id: 'Muat ulang resep ini, lalu ulangi returmu.',
    batch_id: 'Muat ulang resep ini, lalu ulangi returmu.',
    quantity: 'Isi jumlah lebih dari 0.',
    unit_id: 'Pilih satuan obat ini dari daftar.',
    version: 'Muat ulang resep ini, lalu ulangi perubahanmu.',
};

// Retur obat pasien dari penyerahan yang sudah diserahkan: stok kembali ke lokasi asalnya dengan batch, kedaluwarsa,
// harga satuan, dan sumber dana yang sama dengan saat keluar. Bagian yang diretur diambil dari bagian stok keluar
// sesuai urutannya, dan retur berikutnya melanjutkan dari bagian yang belum diretur, jadi jumlah retur tidak pernah
// melebihi yang diserahkan.
export class DispensingReturns {
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

    // Penyerahan yang diserahkan untuk resep ini, dikunci lewat baris resepnya seperti setiap perubahan penyerahan.
    private async handedOver(prescriptionId: string, lock: boolean) {
        const prescription = lookupId(prescriptionId)
            ? await this.db.one(
                  z.object({ id: z.string() }),
                  `select id from far_tr_resep
                   where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null
                   ${lock ? 'for update' : ''}`,
                  [
                      this.scope.tenantId,
                      this.scope.legalEntityId,
                      prescriptionId,
                  ],
              )
            : undefined;
        if (!prescription) abort(404, 'Not Found');
        return this.db.one(
            z.object({
                id: z.string(),
                operating_unit_id: z.string(),
                location_id: z.string(),
                handed_over_at: z.string(),
            }),
            `select id, operating_unit_id, lokasi_id as location_id, diserahkan_pada::text as handed_over_at
             from bill_farmasi
             where tenant_id = $1 and resep_id = $2 and status = 'diserahkan' and deleted_at is null`,
            [this.scope.tenantId, prescription.id],
        );
    }

    private async dispensingLines(
        dispensingId: string,
    ): Promise<Map<string, DispensedLine>> {
        const rows = await this.db.rows(
            dispensedLineSchema,
            `select d.id, d.barang_id as item_id, b.kode as code, b.nama as name,
                    json_build_object('id', s.id, 'code', s.kode, 'name', s.nama) as unit,
                    d.konversi::text as conversion,
                    json_build_object('id', bs.id, 'code', bs.kode, 'name', bs.nama) as base_unit
             from bill_farmasi_detail d
             join gd_m_barang b on b.tenant_id = d.tenant_id and b.id = d.barang_id
             join gd_m_satuan s on s.tenant_id = d.tenant_id and s.id = d.satuan_id
             join gd_m_satuan bs on bs.tenant_id = b.tenant_id and bs.id = b.satuan_dasar_id
             where d.tenant_id = $1 and d.bill_farmasi_id = $2`,
            [this.scope.tenantId, dispensingId],
        );
        const units = await itemUnits(
            this.db,
            this.scope,
            rows.map((row) => row.item_id),
        );
        return new Map(
            rows.map((row) => [
                row.id,
                { ...row, units: units.get(row.item_id) ?? [] },
            ]),
        );
    }

    // Bagian stok yang keluar per baris dan batch, dikurangi yang sudah masuk kembali lewat retur yang masih berlaku.
    // Pengurangannya mencocokkan batch, harga satuan, dan sumber dana baris kartu gudang retur itu, jadi retur
    // berikutnya mengambil bagian yang memang belum kembali, juga sesudah ada retur yang dibatalkan.
    private async remaining(dispensingId: string) {
        const slices = await issuedSlices(this.db, this.scope, {
            type: dispensingSource,
            id: dispensingId,
        });
        const partKey = (
            lineId: string,
            batchId: string | null,
            unitCost: bigint,
            funding: IssuedSlice['funding'],
        ) =>
            JSON.stringify([
                lineId,
                batchId,
                String(unitCost),
                funding.sourceId,
                funding.programId,
                funding.budgetYear,
            ]);
        const back = new Map<string, bigint>();
        for (const row of await this.db.rows(
            z.object({
                line_id: z.string(),
                batch_id: z.string().nullable(),
                unit_cost: z.string(),
                funding_source_id: z.string().nullable(),
                program_id: z.string().nullable(),
                budget_year: z.number().nullable(),
                quantity: z.string(),
            }),
            `select d.bill_farmasi_detail_id as line_id, k.batch_id, k.harga_satuan::text as unit_cost,
                    k.sumber_dana_id as funding_source_id, k.program_pengadaan_id as program_id,
                    k.tahun_anggaran as budget_year, sum(k.jumlah)::text as quantity
             from gd_tr_kartu_gudang k
             join retur_farmasi_detail d on d.tenant_id = k.tenant_id and d.id = k.sumber_baris_id
             join retur_farmasi h on h.tenant_id = d.tenant_id and h.id = d.retur_farmasi_id
             where k.tenant_id = $1 and k.sumber_jenis = $2 and h.bill_farmasi_id = $3 and h.status = 'diposting'
               and k.jumlah > 0 and k.dibalik_dari is null
             group by d.bill_farmasi_detail_id, k.batch_id, k.harga_satuan, k.sumber_dana_id,
                      k.program_pengadaan_id, k.tahun_anggaran`,
            [this.scope.tenantId, returnSource, dispensingId],
        )) {
            const key = partKey(
                row.line_id,
                row.batch_id,
                quantityOf(row.unit_cost),
                {
                    sourceId: row.funding_source_id,
                    programId: row.program_id,
                    budgetYear: row.budget_year,
                },
            );
            back.set(key, (back.get(key) ?? 0n) + quantityOf(row.quantity));
        }
        const groups = new Map<
            string,
            {
                lineId: string;
                batch: IssuedSlice['batch'];
                itemId: string;
                dispensed: bigint;
                returned: bigint;
                open: { slice: IssuedSlice; quantity: bigint }[];
            }
        >();
        for (const slice of slices) {
            if (slice.sourceLineId === null) continue;
            const key = batchKey(slice.sourceLineId, slice.batch?.id ?? null);
            const group = groups.get(key) ?? {
                lineId: slice.sourceLineId,
                batch: slice.batch,
                itemId: slice.itemId,
                dispensed: 0n,
                returned: 0n,
                open: [],
            };
            const part = partKey(
                slice.sourceLineId,
                slice.batch?.id ?? null,
                slice.unitCost,
                slice.funding,
            );
            const returned = back.get(part) ?? 0n;
            const used = returned < slice.quantity ? returned : slice.quantity;
            back.set(part, returned - used);
            group.dispensed += slice.quantity;
            group.returned += used;
            if (slice.quantity > used)
                group.open.push({ slice, quantity: slice.quantity - used });
            groups.set(key, group);
        }
        return groups;
    }

    async show(prescriptionId: string) {
        this.workspace.guard('prescription', 'read');
        const dispensing = await this.handedOver(prescriptionId, false);
        const has = (permission: string) =>
            this.workspace.permissions.has(`${moduleId}.${permission}`);
        if (!dispensing)
            return {
                data: { returnable: [], returns: [] },
                permissions: {
                    create: has('return.create'),
                    reverse: has('return.reverse'),
                },
            };
        const groups = await this.remaining(dispensing.id);
        const lines = await this.dispensingLines(dispensing.id);
        const returns = await this.db.rows(
            z.object({
                id: z.string(),
                number: z.string(),
                status: z.enum(['diposting', 'dibatalkan']),
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
            }),
            `select h.id, h.nomor as number, h.status, h.tanggal::text as posting_date, h.alasan as reason,
                    ${isoSql('h.diposting_pada')} as posted_at, h.version,
                    coalesce((select json_agg(json_build_object('item_name', b.nama, 'batch_number', t.no_batch,
                                                                'quantity', trim_scale(d.jumlah)::text,
                                                                'unit_code', s.kode)
                                              order by d.urutan)
                              from retur_farmasi_detail d
                              join gd_m_barang b on b.tenant_id = d.tenant_id and b.id = d.barang_id
                              join gd_m_satuan s on s.tenant_id = d.tenant_id and s.id = d.satuan_id
                              left join gd_m_batch t on t.tenant_id = d.tenant_id and t.id = d.batch_id
                              where d.tenant_id = h.tenant_id and d.retur_farmasi_id = h.id
                                and d.deleted_at is null), '[]') as lines
             from retur_farmasi h
             where h.tenant_id = $1 and h.bill_farmasi_id = $2 and h.deleted_at is null
             order by h.diposting_pada, h.id`,
            [this.scope.tenantId, dispensing.id],
        );
        return {
            data: {
                returnable: [...groups.values()].map((group) => {
                    const line = lines.get(group.lineId);
                    return {
                        dispensing_line_id: group.lineId,
                        item: line
                            ? { id: line.id, code: line.code, name: line.name }
                            : null,
                        unit: line?.unit ?? null,
                        quantity_per_unit: line
                            ? quantityText(quantityOf(line.conversion))
                            : null,
                        base_unit: line?.base_unit ?? null,
                        units: line?.units ?? [],
                        batch: group.batch
                            ? {
                                  id: group.batch.id,
                                  batch_number: group.batch.number,
                                  expiry_date: group.batch.expiry,
                              }
                            : null,
                        dispensed: quantityText(group.dispensed),
                        returned: quantityText(group.returned),
                    };
                }),
                returns,
            },
            permissions: {
                create: has('return.create'),
                reverse: has('return.reverse'),
            },
        };
    }

    async create(prescriptionId: string, body: unknown) {
        this.workspace.guard('return', 'create');
        const data = parseInput(returnInputSchema, body, messages);
        await this.db.transaction(async () => {
            const dispensing = await this.handedOver(prescriptionId, true);
            if (!dispensing)
                validation({
                    _form: 'Obat resep ini belum diserahkan, jadi belum ada yang bisa diretur.',
                });
            const groups = await this.remaining(dispensing.id);
            const dispensed = await this.dispensingLines(dispensing.id);
            const taken = new Set<string>();
            const errors: Record<string, string> = {};
            const reason = data.reason.trim();
            if (!reason) errors.reason = messages.reason;
            else if (reason.length > 200)
                errors.reason = 'Alasan paling banyak 200 karakter.';
            const lines = data.lines.flatMap((line, index) => {
                const field = `lines.${index}`;
                const quantity = decimalInput(line.quantity);
                if (quantity === null || quantity < 0n) {
                    errors[`${field}.quantity`] =
                        `Isi jumlah 0 atau lebih, ${quantityHint}.`;
                    return [];
                }
                if (quantity === 0n) return [];
                const group =
                    lookupId(line.dispensing_line_id) &&
                    (line.batch_id === null || lookupId(line.batch_id))
                        ? groups.get(
                              batchKey(line.dispensing_line_id, line.batch_id),
                          )
                        : undefined;
                const source = group && dispensed.get(group.lineId);
                if (
                    !group ||
                    !source ||
                    taken.has(batchKey(line.dispensing_line_id, line.batch_id))
                ) {
                    errors[`${field}.dispensing_line_id`] =
                        messages.dispensing_line_id;
                    return [];
                }
                taken.add(batchKey(line.dispensing_line_id, line.batch_id));
                const chosen = returnUnit(line.unit_id, source);
                if (!chosen) {
                    errors[`${field}.unit_id`] = messages.unit_id;
                    return [];
                }
                const base = baseQuantity(quantity, chosen.quantityPerUnit);
                if (base === null) {
                    errors[`${field}.quantity`] = inexactBaseMessage;
                    return [];
                }
                const open = group.dispensed - group.returned;
                if (base > open) {
                    errors[`${field}.quantity`] =
                        open > 0n
                            ? `Paling banyak ${baseQuantityText(open, chosen, source.base_unit.code)}: yang diserahkan dikurangi yang sudah diretur.`
                            : 'Obat batch ini sudah diretur seluruhnya.';
                    return [];
                }
                return [{ index, group, quantity, unit: chosen, base }];
            });
            if (!Object.keys(errors).length && !lines.length)
                errors.lines = messages.lines;
            if (Object.keys(errors).length) validation(errors);
            const id = Bun.randomUUIDv7();
            const posting = await this.db.one(
                z.object({ today: z.string() }),
                `select (now() at time zone timezone)::date::text as today from legal_entities
                 where tenant_id = $1 and organization_id = $2`,
                [this.scope.tenantId, this.scope.legalEntityId],
            );
            if (!posting) throw new Error('Legal entity is missing.');
            const number = await new NumberIssuer(this.db, {
                tenantId: this.scope.tenantId,
                moduleId,
            }).issue({
                reference: returnNumberReference,
                key: `${returnSource}:${id}`,
                documentDate: posting.today,
                legalEntityId: this.scope.legalEntityId,
                operatingUnitId: dispensing.operating_unit_id,
            });
            const stamp = nowSql();
            await this.db.insert('retur_farmasi', {
                id,
                tenant_id: this.scope.tenantId,
                legal_entity_id: this.scope.legalEntityId,
                operating_unit_id: dispensing.operating_unit_id,
                bill_farmasi_id: dispensing.id,
                nomor: number,
                tanggal: posting.today,
                lokasi_id: dispensing.location_id,
                alasan: reason,
                diposting_pada: stamp,
                diposting_oleh_user_id: this.workspace.userId,
                created_at: stamp,
                updated_at: stamp,
            });
            const inbound: InboundLine[] = [];
            for (const [order, line] of lines.entries()) {
                const detailId = Bun.randomUUIDv7();
                await this.db.insert('retur_farmasi_detail', {
                    id: detailId,
                    tenant_id: this.scope.tenantId,
                    legal_entity_id: this.scope.legalEntityId,
                    retur_farmasi_id: id,
                    bill_farmasi_detail_id: line.group.lineId,
                    urutan: order + 1,
                    barang_id: line.group.itemId,
                    batch_id: line.group.batch?.id ?? null,
                    jumlah: toNumeric(line.quantity, quantityScale),
                    satuan_id: line.unit.id,
                    konversi: toNumeric(
                        line.unit.quantityPerUnit,
                        quantityScale,
                    ),
                    created_at: stamp,
                    updated_at: stamp,
                });
                let left = line.base;
                for (const part of line.group.open) {
                    if (left === 0n) break;
                    const quantity =
                        left < part.quantity ? left : part.quantity;
                    left -= quantity;
                    inbound.push({
                        kind: 'inbound',
                        entryKind: 'penyerahan',
                        key: `${returnSource}:${detailId}:${inbound.length + 1}`,
                        field: `lines.${line.index}`,
                        sourceLineId: detailId,
                        itemId: line.group.itemId,
                        quantity,
                        locationId: dispensing.location_id,
                        unitCost: part.slice.unitCost,
                        batchNumber: part.slice.batch?.number ?? null,
                        expiry: part.slice.batch?.expiry ?? null,
                        funding: part.slice.funding,
                    });
                }
            }
            await postItemLines(
                this.db,
                {
                    tenantId: this.scope.tenantId,
                    legalEntityId: this.scope.legalEntityId,
                    userId: this.workspace.userId,
                    postingDate: posting.today,
                    source: { type: returnSource, id, number },
                },
                inbound,
            );
            await publishReturn(this.db, this.scope, id, returnPosted);
        });
        return this.show(prescriptionId);
    }

    // Batal retur: stok yang masuk lewat retur ini keluar lagi lewat baris pembalik, selama belum terpakai.
    async reverse(prescriptionId: string, returnId: string, body: unknown) {
        this.workspace.guard('return', 'reverse');
        const { version } = parseInput(returnReverseInputSchema, body, {
            version: messages.version,
        });
        await this.db.transaction(async () => {
            const dispensing = await this.handedOver(prescriptionId, true);
            const current =
                dispensing && lookupId(returnId)
                    ? await this.db.one(
                          z.object({ status: z.string(), version: z.number() }),
                          `select status, version from retur_farmasi
                           where tenant_id = $1 and bill_farmasi_id = $2 and id = $3 and deleted_at is null`,
                          [this.scope.tenantId, dispensing.id, returnId],
                      )
                    : undefined;
            if (!current) abort(404, 'Not Found');
            if (current.status === 'dibatalkan') return;
            if (current.version !== version)
                coded(409, 'stale_version', staleMessage);
            const stamp = nowSql();
            await this.db.execute(
                `update retur_farmasi set status = 'dibatalkan', dibatalkan_pada = $1, dibatalkan_oleh_user_id = $2,
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
                { type: returnSource, id: returnId },
            );
            await publishReturn(this.db, this.scope, returnId, returnReversed);
        });
        return this.show(prescriptionId);
    }
}
