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
    fromNumeric,
    itemUnits,
    openStock,
    parseInput,
    postItemLines,
    quantityHint,
    quantityScale,
    requireLocationAccess,
    reverseItemEntries,
    toNumeric,
    issuedSlices,
    unitConversion,
} from '@core/foundation/inventory/index.ts';
import { lockChargeForChange } from '@core/foundation/billing/index.ts';
import {
    Currency,
    localCurrencyCode,
    unitAmountDecimals,
} from '@core/foundation/currency/index.ts';
import { NumberIssuer } from '@core/foundation/number-sequence/index.ts';
import { priceDrugLines } from '../../drug/drug-price/drug-price.service.ts';
import { substitutesOf } from '../../drug/item-substitution/item-substitution.service.ts';
import {
    billedFees,
    feeRates,
    freezeFees,
    plannedFees,
} from '../dispensing-fee/dispensing-fee.service.ts';
import type { BilledFee } from '../dispensing-fee/dispensing-fee.schema.ts';
import { moduleId } from '../../module.ts';
import {
    canOverridePrice,
    checkedReason,
    discountInput,
    feeAmountInput,
    guardPriceOverride,
    reasonMessage,
    samePrice,
    unitPriceInput,
    type LinePrice,
} from '../line-price/line-price.service.ts';
import { servingLocationSql } from '../prescription/prescription.service.ts';
import { Prescriptions } from '../prescription/prescription.service.ts';
import {
    netLines,
    paidMessage,
    publishDispensingCharges,
    publishPrescriptionCancelled,
    publishPrescriptionDispensed,
} from './dispensing.events.ts';
import {
    dispensingHeaderSchema,
    dispensingInputSchema,
    dispensingPriceInputSchema,
    dispensingPriceSchema,
    handOverInputSchema,
    prescriptionCancelInputSchema,
    substitutionConsents,
    substitutionSchema,
    versionInputSchema,
    type DispensingLine,
    type DispensingStatus,
} from './dispensing.schema.ts';
import {
    exactBase,
    quantityOf,
    quantityText,
    type LineUnit,
} from './dispensing.units.ts';

export const dispensingSource = 'bill_farmasi';
export const dispensingNumberReference = 'pharmacy.dispensing-number';

export const inexactBaseMessage = `Jumlah ini dalam satuan dasar harus ${quantityHint}. Ganti satuan atau jumlahnya.`;

// Nilai baris penyerahan = jumlah x harga satuan x (100 - % diskon) / 100, dibulatkan ke sen seperti nilai baris
// penerimaan. Kosong selama baris belum berharga (draf).
const lineAmountSql = (alias: string) =>
    `round(${alias}.jumlah * ${alias}.harga_satuan * (100 - ${alias}.persen_diskon) / 100, 2)`;

const personSql = (column: string) => `(select case when u.id is null then null
        else json_build_object('id', u.id, 'name', u.name) end from users u where u.id = ${column})`;

const headerSql = `select h.id, h.nomor as number, h.status, h.tanggal::text as posting_date, h.catatan as notes,
                          h.version, h.resep_id,
                          case when l.id is null then null
                               else json_build_object('id', l.id, 'code', l.kode, 'name', l.nama) end as location,
                          ${personSql('h.apoteker_user_id')} as pharmacist,
                          ${personSql('h.asisten_user_id')} as assistant,
                          ${isoSql('h.disiapkan_pada')} as prepared_at,
                          ${personSql('h.disiapkan_oleh_user_id')} as prepared_by,
                          ${isoSql('h.dipanggil_pada')} as called_at,
                          ${isoSql('h.diserahkan_pada')} as handed_over_at,
                          ${personSql('h.diserahkan_oleh_user_id')} as handed_over_by,
                          h.diterima_pasien as received_by_patient, h.nama_penerima as receiver_name,
                          ${isoSql('h.dibatalkan_pada')} as cancelled_at,
                          trim_scale((select sum(${lineAmountSql('d')}) from bill_farmasi_detail d
                                      where d.tenant_id = h.tenant_id and d.bill_farmasi_id = h.id
                                        and d.deleted_at is null)
                                     + coalesce((select sum(f.nilai) from bill_farmasi_biaya f
                                                 where f.tenant_id = h.tenant_id and f.bill_farmasi_id = h.id
                                                   and f.deleted_at is null), 0))::text as total_amount
                   from bill_farmasi h
                   left join gd_m_lokasi l on l.tenant_id = h.tenant_id and l.id = h.lokasi_id
                   where h.tenant_id = $1 and h.legal_entity_id = $2 and h.deleted_at is null`;

const lockedSchema = z.object({
    id: z.string(),
    operating_unit_id: z.string(),
    operating_unit_name: z.string(),
    location_id: z.string().nullable(),
    issued_at: z.string(),
    price_group_id: z.string().nullable(),
    ktp_patient: z.boolean(),
    visit_id: z.string().nullable(),
    cancelled: z.boolean(),
});

const itemLineSchema = z.object({
    id: z.string(),
    order: z.number(),
    item_id: z.string(),
    item_code: z.string(),
    item_name: z.string(),
    quantity: z.string(),
    unit_id: z.string(),
    unit_code: z.string(),
    unit_name: z.string(),
    conversion: z.string(),
});
type ItemLine = z.infer<typeof itemLineSchema>;

const prescribedUnit = (line: ItemLine): LineUnit => ({
    unitId: line.unit_id,
    quantityPerUnit: quantityOf(line.conversion),
});

const messages = {
    location_id: 'Pilih lokasi dari daftar.',
    notes: 'Catatan paling banyak 500 karakter.',
    pharmacist_id: 'Pilih apoteker dari daftar.',
    assistant_id: 'Pilih asisten apoteker dari daftar.',
    received_by_patient: 'Pilih siapa yang menerima obat.',
    receiver_name: 'Isi nama penerima obat.',
    lines: 'Muat ulang resep ini, lalu ulangi perubahanmu.',
    prescription_line_id: 'Muat ulang resep ini, lalu ulangi perubahanmu.',
    quantity: 'Isi jumlah 0 atau lebih.',
    unit_id: 'Pilih satuan obat ini dari daftar.',
    batch_id: 'Pilih batch dari daftar.',
    reason: 'Alasan paling banyak 200 karakter.',
    item_id: 'Pilih obat pengganti dari daftar obat pengganti obat resep ini.',
    substitution_consent: 'Pilih siapa yang menyetujui obat ini diganti.',
    substitution_reason:
        'Tulis alasan obat resep diganti, misalnya stok habis.',
    version: 'Muat ulang resep ini, lalu ulangi perubahanmu.',
    cancel_reason: 'Isi alasan resep ini dibatalkan.',
};

const cancelledMessage = 'Resep ini sudah dibatalkan.';
const substituteForbiddenMessage =
    'Hanya apoteker yang boleh mengganti obat resep dengan obat pengganti.';

type Substitution = {
    consent: (typeof substitutionConsents)[number];
    reason: string;
};
const consentOf = (value: string | null | undefined) =>
    substitutionConsents.find((consent) => consent === value) ?? null;
const handedOverCancelMessage =
    'Obat resep ini sudah diserahkan, jadi resepnya tidak bisa dibatalkan. Obat yang dikembalikan pasien dicatat lewat Retur.';

type Header = z.infer<typeof dispensingHeaderSchema> & { resep_id: string };

// Penyerahan obat satu resep (BILLFarmasi sistem lama; pengiriman pesanan penjualan di BC: Post Ship, lalu Undo
// Shipment sebelum faktur). Semua perubahan mengunci baris resep lebih dulu, jadi dua petugas yang menekan Siapkan
// bersamaan memposting sekali; indeks unik kunci posting di kartu gudang menjadi penjaga terakhir.
export class Dispensings {
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

    private permissions() {
        const has = (permission: string) =>
            this.workspace.permissions.has(`${moduleId}.${permission}`);
        return {
            prepare: has('dispensing.prepare'),
            hand_over: has('dispensing.hand-over'),
            reverse: has('dispensing.reverse'),
            cancel: has('prescription.cancel'),
            substitute: has('dispensing.substitute'),
            override_price: canOverridePrice(this.workspace),
        };
    }

    async show(prescriptionId: string) {
        this.workspace.guard('prescription', 'read');
        const { data: prescription } = await new Prescriptions(
            this.db,
            this.workspace,
        ).show(prescriptionId);
        const active = await this.active(prescription.id);
        const cancelled = await this.db.rows(
            z.object({ number: z.string(), cancelled_at: z.string() }),
            `select nomor as number, ${isoSql('dibatalkan_pada')} as cancelled_at from bill_farmasi
             where tenant_id = $1 and resep_id = $2 and status = 'dibatalkan' and deleted_at is null
             order by dibatalkan_pada`,
            [this.scope.tenantId, prescription.id],
        );
        const location = active?.location ?? prescription.location;
        const lines = await this.lines(prescription.id, active);
        const itemIds = [
            ...new Set(
                lines.flatMap((line) => [
                    line.item.id,
                    ...line.item_options.map((option) => option.item.id),
                ]),
            ),
        ];
        const stock = new Map<string, bigint>();
        if (location && active?.status !== 'diserahkan')
            for (const row of await openStock(
                this.db,
                this.scope,
                location.id,
                itemIds,
            ))
                stock.set(
                    row.itemId,
                    (stock.get(row.itemId) ?? 0n) + row.quantity,
                );
        return {
            data: {
                prescription,
                dispensing: active ? this.withoutPrescription(active) : null,
                lines,
                fees: active ? await this.fees(active.id) : [],
                cancelled,
                stock: itemIds.map((itemId) => ({
                    item_id: itemId,
                    quantity: quantityText(stock.get(itemId) ?? 0n),
                })),
            },
            permissions: this.permissions(),
        };
    }

    // Biaya racik dan resep yang dibekukan saat Siapkan, sebatas yang masih ditagih sesudah retur.
    private async fees(billId: string): Promise<BilledFee[]> {
        const kept = (await netLines(this.db, this.scope.tenantId, [billId]))
            .filter((line) => line.kept)
            .map((line) => line.line_id);
        return (
            await billedFees(
                this.db,
                this.scope.tenantId,
                [billId],
                new Set(kept),
            )
        ).map(({ dispensing_id: _, ...fee }) => fee);
    }

    private withoutPrescription(header: Header) {
        return dispensingHeaderSchema.parse(header);
    }

    private async active(prescriptionId: string): Promise<Header | undefined> {
        return this.db.one(
            dispensingHeaderSchema.extend({ resep_id: z.string() }),
            `${headerSql} and h.resep_id = $3 and h.status <> 'dibatalkan'`,
            [this.scope.tenantId, this.scope.legalEntityId, prescriptionId],
        );
    }

    private async itemLines(prescriptionId: string) {
        return this.db.rows(
            itemLineSchema,
            `select d.id, d.urutan as "order", d.barang_id as item_id, b.kode as item_code, b.nama as item_name,
                    d.jumlah::text as quantity,
                    coalesce(d.satuan_id, b.satuan_dasar_id) as unit_id, coalesce(d.kode_satuan, s.kode) as unit_code,
                    coalesce(d.nama_satuan, s.nama) as unit_name, d.konversi::text as conversion
             from far_tr_resep_detail d
             join gd_m_barang b on b.tenant_id = d.tenant_id and b.id = d.barang_id
             join gd_m_satuan s on s.tenant_id = b.tenant_id and s.id = b.satuan_dasar_id
             where d.tenant_id = $1 and d.resep_id = $2 and d.barang_id is not null and d.deleted_at is null
             order by d.urutan, d.id`,
            [this.scope.tenantId, prescriptionId],
        );
    }

    // Baris penyerahan aktif; tanpa penyerahan aktif, usulan dari penyerahan terakhir yang dibatalkan (supaya jumlah,
    // satuan, batch, dan alasan yang sudah diisi tidak hilang), atau dari jumlah dan satuan resep.
    private async lines(
        prescriptionId: string,
        active: Header | undefined,
    ): Promise<DispensingLine[]> {
        const source = active
            ? active.id
            : (
                  await this.db.one(
                      z.object({ id: z.string() }),
                      `select id from bill_farmasi
                       where tenant_id = $1 and resep_id = $2 and status = 'dibatalkan' and deleted_at is null
                       order by dibatalkan_pada desc limit 1`,
                      [this.scope.tenantId, prescriptionId],
                  )
              )?.id;
        const stored = source
            ? await this.db.rows(
                  z.object({
                      id: z.string(),
                      prescription_line_id: z.string(),
                      item: z.object({
                          id: z.string(),
                          code: z.string(),
                          name: z.string(),
                      }),
                      substitution: substitutionSchema.nullable(),
                      quantity: z.string(),
                      unit: z.object({
                          id: z.string(),
                          code: z.string(),
                          name: z.string(),
                      }),
                      conversion: z.string(),
                      reason: z.string().nullable(),
                      price: dispensingPriceSchema.nullable(),
                      batch: z
                          .object({
                              id: z.string(),
                              batch_number: z.string(),
                              expiry_date: z.string().nullable(),
                          })
                          .nullable(),
                  }),
                  `select d.id, d.resep_detail_id as prescription_line_id, d.jumlah::text as quantity,
                          json_build_object('id', i.id, 'code', i.kode, 'name', i.nama) as item,
                          case when d.barang_resep_id is null then null else json_build_object(
                              'prescribed_item', json_build_object('id', o.id, 'code', o.kode, 'name', o.nama),
                              'consent', d.persetujuan_ganti, 'reason', d.alasan_ganti,
                              'by', (select u.name from users u where u.id = d.diganti_oleh_user_id),
                              'at', ${isoSql('d.diganti_pada')}) end as substitution,
                          json_build_object('id', s.id, 'code', s.kode, 'name', s.nama) as unit,
                          d.konversi::text as conversion, d.alasan as reason,
                          case when d.harga_satuan is null then null else json_build_object(
                              'unit_price', trim_scale(d.harga_satuan)::text,
                              'discount_percent', trim_scale(d.persen_diskon)::text,
                              'amount', trim_scale(${lineAmountSql('d')})::text,
                              'computed_unit_price', trim_scale(d.harga_satuan_hitung)::text,
                              'computed_discount_percent', trim_scale(d.persen_diskon_hitung)::text,
                              'changed', case when d.harga_diubah_pada is null then null else json_build_object(
                                  'by', (select u.name from users u where u.id = d.harga_diubah_oleh_user_id),
                                  'at', ${isoSql('d.harga_diubah_pada')}, 'reason', d.alasan_ubah_harga) end)
                          end as price,
                          case when t.id is null then null else json_build_object(
                              'id', t.id, 'batch_number', t.no_batch, 'expiry_date', t.kedaluwarsa) end as batch
                   from bill_farmasi_detail d
                   join gd_m_barang i on i.tenant_id = d.tenant_id and i.id = d.barang_id
                   left join gd_m_barang o on o.tenant_id = d.tenant_id and o.id = d.barang_resep_id
                   join gd_m_satuan s on s.tenant_id = d.tenant_id and s.id = d.satuan_id
                   left join gd_m_batch t on t.tenant_id = d.tenant_id and t.id = d.batch_id
                   where d.tenant_id = $1 and d.bill_farmasi_id = $2 and d.deleted_at is null`,
                  [this.scope.tenantId, source],
              )
            : [];
        const byLine = new Map(
            stored.map((line) => [line.prescription_line_id, line]),
        );
        const taken =
            active && active.status !== 'draf'
                ? await issuedSlices(this.db, this.scope, {
                      type: dispensingSource,
                      id: active.id,
                  })
                : [];
        const itemLines = await this.itemLines(prescriptionId);
        const editable = !active || active.status === 'draf';
        const substitutes = editable
            ? await substitutesOf(
                  this.db,
                  this.scope,
                  itemLines.map((line) => line.item_id),
              )
            : new Map<string, never[]>();
        const units = await itemUnits(this.db, this.scope, [
            ...itemLines.map((line) => line.item_id),
            ...stored.map((line) => line.item.id),
            ...[...substitutes.values()].flat().map((item) => item.id),
        ]);
        return itemLines.map((line) => {
            const saved = byLine.get(line.id);
            const item = saved?.item ?? {
                id: line.item_id,
                code: line.item_code,
                name: line.item_name,
            };
            const prescribed = {
                id: line.item_id,
                code: line.item_code,
                name: line.item_name,
            };
            const alternatives = substitutes.get(line.item_id) ?? [];
            return {
                id: active ? (saved?.id ?? null) : null,
                prescription_line_id: line.id,
                item,
                substitution:
                    saved?.substitution && !active
                        ? { ...saved.substitution, by: null, at: null }
                        : (saved?.substitution ?? null),
                item_options:
                    editable && (alternatives.length || saved?.substitution)
                        ? [
                              {
                                  item: prescribed,
                                  is_prescribed: true,
                                  notes: null,
                                  units: units.get(prescribed.id) ?? [],
                              },
                              ...alternatives.map(
                                  ({ notes, ...substitute }) => ({
                                      item: substitute,
                                      is_prescribed: false,
                                      notes,
                                      units: units.get(substitute.id) ?? [],
                                  }),
                              ),
                          ]
                        : [],
                quantity: quantityText(
                    quantityOf(saved?.quantity ?? line.quantity),
                ),
                unit: saved?.unit ?? {
                    id: line.unit_id,
                    code: line.unit_code,
                    name: line.unit_name,
                },
                quantity_per_unit: quantityText(
                    quantityOf(saved?.conversion ?? line.conversion),
                ),
                units: units.get(item.id) ?? [],
                batch: saved?.batch ?? null,
                reason: saved?.reason ?? null,
                // Usulan dari penyerahan yang dibatalkan tidak membawa harganya: Siapkan berikutnya menghitung ulang.
                price: active ? (saved?.price ?? null) : null,
                taken: taken
                    .filter((slice) => slice.sourceLineId === saved?.id)
                    .map((slice) => ({
                        batch_number: slice.batch?.number ?? null,
                        expiry_date: slice.batch?.expiry ?? null,
                        quantity: quantityText(slice.quantity),
                    })),
            };
        });
    }

    // Baris resep dikunci sebelum penyerahannya dibaca atau diubah. Resep legal entity lain tidak ditemukan, dan resep
    // yang sudah dibatalkan ditolak kecuali untuk Batal resep sendiri.
    private async lock(prescriptionId: string, allowCancelled = false) {
        const locked = lookupId(prescriptionId)
            ? await this.db.one(
                  lockedSchema,
                  `select r.id, r.operating_unit_id, u.name as operating_unit_name,
                          ${servingLocationSql('r')} as location_id, r.diterbitkan_pada::text as issued_at,
                          r.kelompok_harga_id as price_group_id, r.pasien_ktp as ktp_patient,
                          r.kunjungan_id as visit_id, r.dibatalkan_pada is not null as cancelled
                   from far_tr_resep r
                   join organizations u on u.tenant_id = r.tenant_id and u.id = r.operating_unit_id
                   where r.tenant_id = $1 and r.legal_entity_id = $2 and r.id = $3 and r.deleted_at is null
                   for update of r`,
                  [
                      this.scope.tenantId,
                      this.scope.legalEntityId,
                      prescriptionId,
                  ],
              )
            : undefined;
        if (!locked) abort(404, 'Not Found');
        if (locked.cancelled && !allowCancelled)
            validation({ _form: cancelledMessage });
        await requireLocationAccess(this.db, this.workspace, [
            locked.location_id,
        ]);
        return locked;
    }

    private async member(userId: string | null): Promise<boolean> {
        if (userId === null) return true;
        if (!lookupId(userId)) return false;
        return (
            (await this.db.one(
                z.object({ id: z.string() }),
                `select m.user_id as id from tenant_memberships m
                 where m.tenant_id = $1 and m.user_id = $2 and m.status = 'active'`,
                [this.scope.tenantId, userId],
            )) !== undefined
        );
    }

    // Satuan baris penyerahan, seperti satuan baris pengiriman BC yang bawaannya satuan baris pesanan. Satuan resep
    // untuk obat resep memakai isi yang disalin saat resep diterima; satuan lain, dan setiap satuan obat pengganti, harus
    // satuan barang yang diserahkan itu sendiri, dengan isinya sekarang.
    private async dispensingUnit(
        raw: string | null | undefined,
        source: ItemLine,
        itemId: string,
    ): Promise<LineUnit | null> {
        const unitId = raw || source.unit_id;
        if (itemId === source.item_id && unitId === source.unit_id)
            return prescribedUnit(source);
        const conversion = lookupId(unitId)
            ? await unitConversion(this.db, this.scope, itemId, unitId)
            : null;
        return conversion === null
            ? null
            : { unitId, quantityPerUnit: conversion };
    }

    // Penggantian yang sudah tersimpan di penyerahan aktif, per baris resep. Mengirim ulang penggantian yang sama (obat,
    // persetujuan, dan alasan) tidak dihitung mengganti lagi, jadi asisten tetap bisa menyimpan draf yang sudah diganti
    // apoteker, juga bila obat penggantinya sudah dihapus dari daftar.
    private async storedSubstitutions(prescriptionId: string) {
        return new Map(
            (
                await this.db.rows(
                    z.object({
                        prescription_line_id: z.string(),
                        item_id: z.string(),
                        consent: z.string(),
                        reason: z.string(),
                    }),
                    `select d.resep_detail_id as prescription_line_id, d.barang_id as item_id,
                            d.persetujuan_ganti as consent, d.alasan_ganti as reason
                     from bill_farmasi_detail d
                     join bill_farmasi h on h.tenant_id = d.tenant_id and h.id = d.bill_farmasi_id
                     where d.tenant_id = $1 and h.resep_id = $2 and h.status <> 'dibatalkan' and h.deleted_at is null
                       and d.deleted_at is null and d.barang_resep_id is not null`,
                    [this.scope.tenantId, prescriptionId],
                )
            ).map((row) => [row.prescription_line_id, row]),
        );
    }

    // Isian draf: satu baris per obat resep, jumlah 0 sampai jumlah resep (dibandingkan dalam satuan dasar), alasan
    // wajib bila kurang dari resep, batch milik barang yang diserahkan, lokasi milik legal entity ini, apoteker dan
    // asisten anggota tenant. Obat yang diserahkan boleh obat pengganti obat resep (Item Substitution BC) dengan
    // persetujuan dan alasannya; satu satuan dasar obat pengganti menggantikan satu satuan dasar obat resep.
    private async checked(prescriptionId: string, body: unknown) {
        const data = parseInput(dispensingInputSchema, body, messages);
        const errors: Record<string, string> = {};
        const itemLines = await this.itemLines(prescriptionId);
        const prescribed = new Map(itemLines.map((line) => [line.id, line]));
        const storedSubstitutions =
            await this.storedSubstitutions(prescriptionId);
        const substitutes = await substitutesOf(
            this.db,
            this.scope,
            itemLines.map((line) => line.item_id),
        );
        const seen = new Set<string>();
        const lines: {
            prescriptionLineId: string;
            order: number;
            itemId: string;
            substitution: Substitution | null;
            quantity: bigint;
            unit: LineUnit;
            batchId: string | null;
            reason: string | null;
        }[] = [];
        for (const [index, line] of data.lines.entries()) {
            const field = `lines.${index}`;
            const source = prescribed.get(line.prescription_line_id);
            if (!source || seen.has(source.id)) {
                errors[`${field}.prescription_line_id`] =
                    messages.prescription_line_id;
                continue;
            }
            seen.add(source.id);
            const itemId = line.item_id || source.item_id;
            let substitution: Substitution | null = null;
            if (itemId !== source.item_id) {
                const consent = consentOf(line.substitution_consent);
                const substitutionReason =
                    line.substitution_reason?.trim() ?? '';
                if (!consent)
                    errors[`${field}.substitution_consent`] =
                        messages.substitution_consent;
                if (!substitutionReason)
                    errors[`${field}.substitution_reason`] =
                        messages.substitution_reason;
                else if (substitutionReason.length > 200)
                    errors[`${field}.substitution_reason`] = messages.reason;
                const stored = storedSubstitutions.get(source.id);
                const unchanged =
                    stored?.item_id === itemId &&
                    stored.consent === consent &&
                    stored.reason === substitutionReason;
                if (!unchanged) {
                    if (!this.permissions().substitute)
                        abort(403, substituteForbiddenMessage);
                    if (
                        !substitutes
                            .get(source.item_id)
                            ?.some((substitute) => substitute.id === itemId)
                    )
                        errors[`${field}.item_id`] = messages.item_id;
                }
                if (consent && substitutionReason)
                    substitution = { consent, reason: substitutionReason };
            }
            const ordered = exactBase(
                quantityOf(source.quantity),
                prescribedUnit(source),
            );
            const unit = await this.dispensingUnit(
                line.unit_id,
                source,
                itemId,
            );
            if (!unit) errors[`${field}.unit_id`] = messages.unit_id;
            const quantity = decimalInput(line.quantity);
            const dispensed =
                quantity !== null && unit ? exactBase(quantity, unit) : null;
            if (quantity === null || quantity < 0n)
                errors[`${field}.quantity`] =
                    `Isi jumlah 0 atau lebih, ${quantityHint}.`;
            else if (
                unit &&
                baseQuantity(quantity, unit.quantityPerUnit) === null
            )
                errors[`${field}.quantity`] = inexactBaseMessage;
            else if (dispensed !== null && dispensed > ordered)
                errors[`${field}.quantity`] =
                    `Jumlah yang diserahkan paling banyak ${quantityText(quantityOf(source.quantity))} ${source.unit_code}, sesuai resep.`;
            const reason = line.reason?.trim() || null;
            if (reason && reason.length > 200)
                errors[`${field}.reason`] = messages.reason;
            else if (dispensed !== null && dispensed < ordered && !reason)
                errors[`${field}.reason`] =
                    'Tulis alasan obat diserahkan kurang dari resep, misalnya stok habis.';
            const batchId = line.batch_id || null;
            if (
                batchId !== null &&
                !(
                    lookupId(batchId) &&
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
                    ))
                )
            )
                errors[`${field}.batch_id`] = messages.batch_id;
            lines.push({
                prescriptionLineId: source.id,
                order: source.order,
                itemId,
                substitution,
                quantity: quantity ?? 0n,
                unit: unit ?? prescribedUnit(source),
                batchId,
                reason,
            });
        }
        if (!errors.lines && seen.size !== prescribed.size)
            errors.lines = messages.lines;
        let locationId: string | null | undefined = undefined;
        if (data.location_id !== undefined) {
            locationId = data.location_id || null;
            if (
                locationId !== null &&
                !(
                    lookupId(locationId) &&
                    (await this.db.one(
                        z.object({ id: z.string() }),
                        `select id from gd_m_lokasi
                         where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null
                           and not transit`,
                        [
                            this.scope.tenantId,
                            this.scope.legalEntityId,
                            locationId,
                        ],
                    ))
                )
            )
                errors.location_id = messages.location_id;
            else
                await requireLocationAccess(
                    this.db,
                    this.workspace,
                    [locationId],
                    { field: 'location_id' },
                );
        }
        const pharmacistId = data.pharmacist_id || null;
        if (!(await this.member(pharmacistId)))
            errors.pharmacist_id = messages.pharmacist_id;
        const assistantId = data.assistant_id || null;
        if (!(await this.member(assistantId)))
            errors.assistant_id = messages.assistant_id;
        if (Object.keys(errors).length) validation(errors);
        return {
            locationId,
            notes: data.notes?.trim() || null,
            pharmacistId,
            assistantId,
            lines,
            version: data.version,
        };
    }

    // Draf tersimpan untuk resep yang sudah dikunci: dibuat bila belum ada penyerahan aktif, diubah bila masih draf.
    private async write(
        locked: z.infer<typeof lockedSchema>,
        input: Awaited<ReturnType<Dispensings['checked']>>,
    ): Promise<string> {
        const current = await this.active(locked.id);
        const stamp = nowSql();
        let billId: string;
        if (!current) {
            if (input.version !== undefined)
                coded(409, 'stale_version', staleMessage);
            billId = Bun.randomUUIDv7();
            const number = await new NumberIssuer(this.db, {
                tenantId: this.scope.tenantId,
                moduleId,
            }).issue({
                reference: dispensingNumberReference,
                key: `${dispensingSource}:${billId}`,
                documentDate: locked.issued_at.slice(0, 10),
                legalEntityId: this.scope.legalEntityId,
                operatingUnitId: locked.operating_unit_id,
            });
            await this.db.insert('bill_farmasi', {
                id: billId,
                tenant_id: this.scope.tenantId,
                legal_entity_id: this.scope.legalEntityId,
                operating_unit_id: locked.operating_unit_id,
                resep_id: locked.id,
                nomor: number,
                catatan: input.notes,
                apoteker_user_id: input.pharmacistId,
                asisten_user_id: input.assistantId,
                created_at: stamp,
                updated_at: stamp,
            });
        } else {
            if (current.status !== 'draf')
                validation({
                    _form: 'Resep ini sudah disiapkan, jadi isinya tidak bisa diubah lagi. Batal siapkan dulu bila perlu.',
                });
            if (input.version !== current.version)
                coded(409, 'stale_version', staleMessage);
            billId = current.id;
            await this.db.execute(
                `update bill_farmasi set catatan = $1, apoteker_user_id = $2, asisten_user_id = $3, updated_at = $4
                 where tenant_id = $5 and id = $6`,
                [
                    input.notes,
                    input.pharmacistId,
                    input.assistantId,
                    stamp,
                    this.scope.tenantId,
                    billId,
                ],
            );
        }
        if (input.locationId !== undefined)
            await this.db.execute(
                'update far_tr_resep set lokasi_id = $1, updated_at = $2 where tenant_id = $3 and id = $4',
                [input.locationId, stamp, this.scope.tenantId, locked.id],
            );
        const prescribedItems = new Map(
            (await this.itemLines(locked.id)).map((line) => [
                line.id,
                line.item_id,
            ]),
        );
        for (const line of input.lines) {
            const originalItemId = line.substitution
                ? (prescribedItems.get(line.prescriptionLineId) ?? null)
                : null;
            // Waktu dan pengguna yang mengganti tetap milik penggantian pertama selama obat, persetujuan, dan alasannya
            // sama.
            const updated = await this.db.execute(
                `update bill_farmasi_detail set jumlah = $1, satuan_id = $2, konversi = $3, batch_id = $4, alasan = $5,
                        updated_at = $6, barang_id = $10::uuid, barang_resep_id = $11::uuid, persetujuan_ganti = $12::text,
                        alasan_ganti = $13::text,
                        diganti_pada = case when $11::uuid is null then null
                            when barang_id = $10::uuid and persetujuan_ganti = $12::text and alasan_ganti = $13::text then diganti_pada
                            else $6 end,
                        diganti_oleh_user_id = case when $11::uuid is null then null
                            when barang_id = $10::uuid and persetujuan_ganti = $12::text and alasan_ganti = $13::text
                                then diganti_oleh_user_id
                            else $14::uuid end
                 where tenant_id = $7 and bill_farmasi_id = $8 and resep_detail_id = $9 and deleted_at is null`,
                [
                    toNumeric(line.quantity, quantityScale),
                    line.unit.unitId,
                    toNumeric(line.unit.quantityPerUnit, quantityScale),
                    line.batchId,
                    line.reason,
                    stamp,
                    this.scope.tenantId,
                    billId,
                    line.prescriptionLineId,
                    line.itemId,
                    originalItemId,
                    line.substitution?.consent ?? null,
                    line.substitution?.reason ?? null,
                    this.workspace.userId,
                ],
            );
            if (!updated)
                await this.db.insert('bill_farmasi_detail', {
                    id: Bun.randomUUIDv7(),
                    tenant_id: this.scope.tenantId,
                    legal_entity_id: this.scope.legalEntityId,
                    bill_farmasi_id: billId,
                    resep_detail_id: line.prescriptionLineId,
                    urutan: line.order,
                    barang_id: line.itemId,
                    jumlah: toNumeric(line.quantity, quantityScale),
                    satuan_id: line.unit.unitId,
                    konversi: toNumeric(
                        line.unit.quantityPerUnit,
                        quantityScale,
                    ),
                    batch_id: line.batchId,
                    alasan: line.reason,
                    barang_resep_id: originalItemId,
                    persetujuan_ganti: line.substitution?.consent ?? null,
                    alasan_ganti: line.substitution?.reason ?? null,
                    diganti_pada: line.substitution ? stamp : null,
                    diganti_oleh_user_id: line.substitution
                        ? this.workspace.userId
                        : null,
                    created_at: stamp,
                    updated_at: stamp,
                });
        }
        return billId;
    }

    async save(prescriptionId: string, body: unknown) {
        this.workspace.guard('dispensing', 'prepare');
        await this.db.transaction(async () => {
            const locked = await this.lock(prescriptionId);
            await this.write(locked, await this.checked(locked.id, body));
        });
        return this.show(prescriptionId);
    }

    // Siapkan: draf disimpan (atau dibuat dari usulan bila belum ada), lalu stok keluar diposting di lokasi yang
    // melayani resep, di transaksi yang sama. Resep yang sudah disiapkan tidak diposting lagi.
    async prepare(prescriptionId: string, body: unknown) {
        this.workspace.guard('dispensing', 'prepare');
        await this.db.transaction(async () => {
            const locked = await this.lock(prescriptionId);
            const current = await this.active(locked.id);
            if (current && current.status !== 'draf') return;
            // Obat yang disiapkan masuk tagihan kunjungan, jadi kunjungan yang sudah dibayar kasir menolaknya.
            if (locked.visit_id)
                await lockChargeForChange(this.db, this.workspace, {
                    documentId: locked.visit_id,
                });
            const hasLines =
                typeof body === 'object' &&
                body !== null &&
                'lines' in body &&
                Array.isArray(body.lines);
            let billId: string;
            if (hasLines)
                billId = await this.write(
                    locked,
                    await this.checked(locked.id, body),
                );
            else if (current) {
                const { version } = parseInput(versionInputSchema, body, {
                    version: messages.version,
                });
                if (version !== current.version)
                    coded(409, 'stale_version', staleMessage);
                billId = current.id;
            } else
                billId = await this.write(locked, {
                    locationId: undefined,
                    notes: null,
                    pharmacistId: null,
                    assistantId: null,
                    version: undefined,
                    lines: (await this.itemLines(locked.id)).map((line) => ({
                        prescriptionLineId: line.id,
                        order: line.order,
                        itemId: line.item_id,
                        substitution: null,
                        quantity: quantityOf(line.quantity),
                        unit: prescribedUnit(line),
                        batchId: null,
                        reason: null,
                    })),
                });
            const location = await this.servingLocation(locked.id);
            if (!location)
                validation({
                    location_id: `Belum ada lokasi farmasi untuk resep ini. Pilih lokasi farmasi di resep, atau atur Lokasi layanan resep untuk ${locked.operating_unit_name}.`,
                });
            const stamp = nowSql();
            const claimed = await this.db.one(
                z.object({
                    number: z.string(),
                    posting_date: z.string(),
                    includes_service: z.boolean(),
                }),
                `update bill_farmasi h set status = 'disiapkan', lokasi_id = $1,
                        tanggal = (now() at time zone e.timezone)::date, disiapkan_pada = $2,
                        disiapkan_oleh_user_id = $3, asisten_user_id = coalesce(h.asisten_user_id, $3), updated_at = $2,
                        termasuk_jasa = coalesce((
                            select m.termasuk_jasa from far_m_lokasi_layanan m
                            where m.tenant_id = r.tenant_id and m.legal_entity_id = r.legal_entity_id
                              and m.operating_unit_id = r.operating_unit_id and m.deleted_at is null
                              and (m.section_id = r.section_id or m.section_id is null)
                            order by m.section_id is null
                            limit 1), false)
                 from legal_entities e, far_tr_resep r
                 where e.tenant_id = h.tenant_id and e.organization_id = h.legal_entity_id
                   and r.tenant_id = h.tenant_id and r.id = h.resep_id
                   and h.tenant_id = $4 and h.id = $5 and h.status = 'draf'
                 returning h.nomor as number, h.tanggal::text as posting_date, h.termasuk_jasa as includes_service`,
                [
                    location,
                    stamp,
                    this.workspace.userId,
                    this.scope.tenantId,
                    billId,
                ],
            );
            if (!claimed) coded(409, 'stale_version', staleMessage);
            const lines = await this.db.rows(
                z.object({
                    id: z.string(),
                    item_id: z.string(),
                    quantity: z.string(),
                    conversion: z.string(),
                    batch_id: z.string().nullable(),
                    compound: z.number().nullable(),
                }),
                `select d.id, d.barang_id as item_id, d.jumlah::text as quantity, d.konversi::text as conversion,
                        d.batch_id, r.racikan_ke as compound
                 from bill_farmasi_detail d
                 left join far_tr_resep_detail r on r.tenant_id = d.tenant_id and r.id = d.resep_detail_id
                 where d.tenant_id = $1 and d.bill_farmasi_id = $2 and d.deleted_at is null
                 order by d.urutan, d.id`,
                [this.scope.tenantId, billId],
            );
            const outbound = lines.map((line, index) => ({
                line,
                field: `lines.${index}`,
                quantity: baseQuantity(
                    quantityOf(line.quantity),
                    quantityOf(line.conversion),
                ),
            }));
            const inexact = outbound.find((entry) => entry.quantity === null);
            if (inexact)
                validation({
                    [`${inexact.field}.quantity`]: inexactBaseMessage,
                });
            // Harga obat dihitung sekali di sini dan disalin ke baris, dengan kelompok harga dan KTP pembeli dari resep
            // dan tanggal penyerahan; kasir dan perubahan grading sesudahnya tidak mengubahnya (keputusan 8.3 A).
            for (const { line, price } of await priceDrugLines(
                this.db,
                this.scope,
                {
                    priceGroupId: locked.price_group_id,
                    ktpPatient: locked.ktp_patient,
                    date: claimed.posting_date,
                },
                lines.map((line) => ({
                    id: line.id,
                    itemId: line.item_id,
                    quantityPerUnit: quantityOf(line.conversion),
                })),
            ))
                await this.db.execute(
                    `update bill_farmasi_detail set harga_dasar = $1, grading_harga_id = $2, persen_naik = $3,
                            harga_satuan = $4, persen_diskon = $5, harga_satuan_hitung = $4, persen_diskon_hitung = $5,
                            harga_diubah_pada = null, harga_diubah_oleh_user_id = null, alasan_ubah_harga = null,
                            updated_at = $6
                     where tenant_id = $7 and id = $8`,
                    [
                        toNumeric(price.basePrice, quantityScale),
                        price.gradingId,
                        toNumeric(price.markupPercent, quantityScale),
                        toNumeric(price.unitPrice, quantityScale),
                        toNumeric(price.discountPercent, quantityScale),
                        stamp,
                        this.scope.tenantId,
                        line.id,
                    ],
                );
            // Biaya racik dan resep dibekukan bersama harga obat. Obat yang tidak diserahkan tidak dikenai biaya, dan
            // penyerahan yang termasuk jasa tidak ditagih biayanya.
            if (!claimed.includes_service)
                await freezeFees(
                    this.db,
                    this.scope,
                    billId,
                    plannedFees(
                        await feeRates(this.db, this.scope, {
                            locationId: location,
                            priceGroupId: locked.price_group_id,
                        }),
                        outbound.flatMap(({ line, quantity }) =>
                            quantity !== null && quantity > 0n
                                ? [{ lineId: line.id, compound: line.compound }]
                                : [],
                        ),
                        false,
                    ),
                );
            await postItemLines(
                this.db,
                {
                    tenantId: this.scope.tenantId,
                    legalEntityId: this.scope.legalEntityId,
                    userId: this.workspace.userId,
                    postingDate: claimed.posting_date,
                    source: {
                        type: dispensingSource,
                        id: billId,
                        number: claimed.number,
                    },
                },
                outbound.flatMap(({ line, field, quantity }) =>
                    quantity !== null && quantity > 0n
                        ? [
                              {
                                  kind: 'outbound' as const,
                                  entryKind: 'penyerahan' as const,
                                  key: `${dispensingSource}:${line.id}`,
                                  field,
                                  sourceLineId: line.id,
                                  itemId: line.item_id,
                                  quantity,
                                  locationId: location,
                                  batchId: line.batch_id,
                              },
                          ]
                        : [],
                ),
            );
            await publishDispensingCharges(this.db, this.scope, billId);
        });
        return this.show(prescriptionId);
    }

    private async servingLocation(prescriptionId: string) {
        const row = await this.db.one(
            z.object({
                id: z.string().nullable(),
                transit: z.boolean().nullable(),
            }),
            `select l.id, l.transit from far_tr_resep r
             left join gd_m_lokasi l on l.tenant_id = r.tenant_id and l.deleted_at is null
                  and l.id = ${servingLocationSql('r')}
             where r.tenant_id = $1 and r.id = $2`,
            [this.scope.tenantId, prescriptionId],
        );
        return row?.id && !row.transit ? row.id : null;
    }

    // Perpindahan status sesudah disiapkan. Permintaan yang diulang setelah resep sampai di status tujuan tidak menulis
    // apa pun dan menjawab penyerahan yang sama.
    private async move(
        prescriptionId: string,
        from: DispensingStatus[],
        to: DispensingStatus,
        version: number | null,
        apply: (billId: string) => Promise<void>,
    ) {
        await this.db.transaction(async () => {
            const locked = await this.lock(prescriptionId);
            const current = await this.active(locked.id);
            if (!current || current.status === 'draf')
                validation({
                    _form: 'Resep ini belum disiapkan. Siapkan dulu, supaya stoknya tercatat keluar.',
                });
            if (current.status === to && to !== 'dipanggil') return;
            if (!from.includes(current.status))
                validation({
                    _form:
                        current.status === 'diserahkan'
                            ? 'Obat resep ini sudah diserahkan.'
                            : 'Resep ini tidak bisa dipindah ke langkah itu.',
                });
            if (version !== null && version !== current.version)
                coded(409, 'stale_version', staleMessage);
            await apply(current.id);
        });
        return this.show(prescriptionId);
    }

    async call(prescriptionId: string) {
        this.workspace.guard('dispensing', 'prepare');
        return this.move(
            prescriptionId,
            ['disiapkan', 'dipanggil'],
            'dipanggil',
            null,
            async (billId) => {
                const stamp = nowSql();
                await this.db.execute(
                    `update bill_farmasi set status = 'dipanggil', dipanggil_pada = $1, dipanggil_oleh_user_id = $2,
                            updated_at = $1
                     where tenant_id = $3 and id = $4`,
                    [stamp, this.workspace.userId, this.scope.tenantId, billId],
                );
            },
        );
    }

    async handOver(prescriptionId: string, body: unknown) {
        this.workspace.guard('dispensing', 'hand-over');
        const data = parseInput(handOverInputSchema, body, messages);
        const errors: Record<string, string> = {};
        const pharmacistId = data.pharmacist_id || null;
        if (!(await this.member(pharmacistId)))
            errors.pharmacist_id = messages.pharmacist_id;
        const receiverName = data.receiver_name?.trim() || null;
        if (data.received_by_patient) {
            if (receiverName)
                errors.receiver_name =
                    'Kosongkan nama penerima bila obat diterima pasien sendiri.';
        } else if (!receiverName) errors.receiver_name = messages.receiver_name;
        else if (receiverName.length > 150)
            errors.receiver_name = 'Nama penerima paling banyak 150 karakter.';
        if (Object.keys(errors).length) validation(errors);
        return this.move(
            prescriptionId,
            ['disiapkan', 'dipanggil'],
            'diserahkan',
            data.version,
            async (billId) => {
                const stamp = nowSql();
                await this.db.execute(
                    `update bill_farmasi set status = 'diserahkan', diserahkan_pada = $1, diserahkan_oleh_user_id = $2,
                            apoteker_user_id = coalesce($3, apoteker_user_id, $2), diterima_pasien = $4,
                            nama_penerima = $5, updated_at = $1
                     where tenant_id = $6 and id = $7`,
                    [
                        stamp,
                        this.workspace.userId,
                        pharmacistId,
                        data.received_by_patient,
                        receiverName,
                        this.scope.tenantId,
                        billId,
                    ],
                );
                await publishPrescriptionDispensed(this.db, this.scope, billId);
            },
        );
    }

    // Batal siapkan sebelum diserahkan: stok yang keluar kembali lewat baris pembalik kartu gudang, penyerahan ditutup
    // sebagai dibatalkan, dan resep kembali ke antrean untuk disiapkan dengan penyerahan baru.
    async cancelPreparation(prescriptionId: string, body: unknown) {
        this.workspace.guard('dispensing', 'reverse');
        const { version } = parseInput(versionInputSchema, body, {
            version: messages.version,
        });
        return this.move(
            prescriptionId,
            ['disiapkan', 'dipanggil'],
            'dibatalkan',
            version,
            async (billId) =>
                this.reversePreparation(
                    billId,
                    (await this.lock(prescriptionId)).visit_id,
                ),
        );
    }

    // Kunci kasir lebih dulu: kunjungan yang sudah dibayar menolak, dan pembayaran otomatisnya dibatalkan kasir lalu
    // dilunasi ulang saat biaya obat yang baru (kosong) sampai di kasir.
    private async reversePreparation(billId: string, visitId: string | null) {
        if (visitId)
            await lockChargeForChange(this.db, this.workspace, {
                documentId: visitId,
                message: paidMessage,
            });
        const stamp = nowSql();
        await this.db.execute(
            `update bill_farmasi set status = 'dibatalkan', dibatalkan_pada = $1, dibatalkan_oleh_user_id = $2,
                    updated_at = $1
             where tenant_id = $3 and id = $4`,
            [stamp, this.workspace.userId, this.scope.tenantId, billId],
        );
        await reverseItemEntries(
            this.db,
            {
                tenantId: this.scope.tenantId,
                legalEntityId: this.scope.legalEntityId,
                userId: this.workspace.userId,
            },
            { type: dispensingSource, id: billId },
        );
        await publishDispensingCharges(this.db, this.scope, billId);
    }

    // Ubah harga sesudah Siapkan, hanya untuk pemegang izin ubah harga: harga satuan dan % diskon baris obat, dan nilai
    // biaya racik atau resep. Hitungan sistem tidak berubah; baris yang berbeda dengan hitungan mencatat siapa, kapan, dan
    // alasannya, dan baris yang dikembalikan ke hitungan menghapus catatan itu. Tagihan kasir mengikuti lewat
    // pharmacy.dispensing.charges-replaced.v1, jadi kunjungan yang sudah dibayar menolak lewat kunci kasir.
    async changePrices(prescriptionId: string, body: unknown) {
        guardPriceOverride(this.workspace);
        const data = parseInput(dispensingPriceInputSchema, body, messages);
        await this.db.transaction(async () => {
            const locked = await this.lock(prescriptionId);
            const current = await this.active(locked.id);
            if (!current || current.status === 'draf')
                validation({
                    _form: 'Resep ini belum disiapkan. Harga obat dihitung saat Siapkan, sesudah itu baru bisa diubah.',
                });
            if (data.version !== current.version)
                coded(409, 'stale_version', staleMessage);
            const scope = this.scope;
            const precision = await new Currency(
                this.db,
                scope.tenantId,
            ).precision(localCurrencyCode);
            const storedLines = new Map(
                (
                    await this.db.rows(
                        z.object({
                            id: z.string(),
                            unit_price: z.string(),
                            discount_percent: z.string(),
                            computed_unit_price: z.string(),
                            computed_discount_percent: z.string(),
                        }),
                        `select id, harga_satuan::text as unit_price, persen_diskon::text as discount_percent,
                                harga_satuan_hitung::text as computed_unit_price,
                                persen_diskon_hitung::text as computed_discount_percent
                         from bill_farmasi_detail
                         where tenant_id = $1 and bill_farmasi_id = $2 and deleted_at is null
                           and harga_satuan is not null`,
                        [scope.tenantId, current.id],
                    )
                ).map((row) => [row.id, row]),
            );
            const storedFees = new Map(
                (
                    await this.db.rows(
                        z.object({
                            id: z.string(),
                            amount: z.string(),
                            computed_amount: z.string(),
                        }),
                        `select id, nilai::text as amount, nilai_hitung::text as computed_amount
                         from bill_farmasi_biaya
                         where tenant_id = $1 and bill_farmasi_id = $2 and deleted_at is null`,
                        [scope.tenantId, current.id],
                    )
                ).map((row) => [row.id, row]),
            );
            const errors: Record<string, string> = {};
            const scaled = (text: string) => fromNumeric(text, quantityScale);
            const lineChanges: {
                id: string;
                price: LinePrice;
                differs: boolean;
            }[] = [];
            for (const [index, input] of (data.lines ?? []).entries()) {
                const field = `lines.${String(index)}`;
                const stored = storedLines.get(input.id);
                if (!stored) {
                    errors[`${field}.id`] = messages.lines;
                    continue;
                }
                const unitPrice = unitPriceInput(
                    input.unit_price,
                    unitAmountDecimals(precision),
                );
                const discountPercent = discountInput(input.discount_percent);
                if (typeof unitPrice !== 'bigint')
                    errors[`${field}.unit_price`] = unitPrice.error;
                if (typeof discountPercent !== 'bigint')
                    errors[`${field}.discount_percent`] = discountPercent.error;
                if (
                    typeof unitPrice !== 'bigint' ||
                    typeof discountPercent !== 'bigint'
                )
                    continue;
                const price = { unitPrice, discountPercent };
                const used = {
                    unitPrice: scaled(stored.unit_price),
                    discountPercent: scaled(stored.discount_percent),
                };
                if (samePrice(price, used)) continue;
                lineChanges.push({
                    id: stored.id,
                    price,
                    differs: !samePrice(price, {
                        unitPrice: scaled(stored.computed_unit_price),
                        discountPercent: scaled(
                            stored.computed_discount_percent,
                        ),
                    }),
                });
            }
            const feeChanges: {
                id: string;
                amount: bigint;
                differs: boolean;
            }[] = [];
            for (const [index, input] of (data.fees ?? []).entries()) {
                const field = `fees.${String(index)}`;
                const stored = storedFees.get(input.id);
                if (!stored) {
                    errors[`${field}.id`] = messages.lines;
                    continue;
                }
                const value = feeAmountInput(
                    input.amount,
                    precision.amount_decimals,
                );
                if (typeof value !== 'bigint') {
                    errors[`${field}.amount`] = value.error;
                    continue;
                }
                if (value === scaled(stored.amount)) continue;
                feeChanges.push({
                    id: stored.id,
                    amount: value,
                    differs: value !== scaled(stored.computed_amount),
                });
            }
            const reason = checkedReason(data.reason);
            if ('error' in reason) errors.reason = reason.error;
            else if (
                reason.reason === null &&
                [...lineChanges, ...feeChanges].some((change) => change.differs)
            )
                errors.reason = reasonMessage;
            if (Object.keys(errors).length) validation(errors);
            if (!lineChanges.length && !feeChanges.length) return;
            const why = 'reason' in reason ? reason.reason : null;
            if (locked.visit_id)
                await lockChargeForChange(this.db, this.workspace, {
                    documentId: locked.visit_id,
                    message: paidMessage,
                });
            const stamp = nowSql();
            const audit = (differs: boolean) =>
                differs
                    ? [stamp, this.workspace.userId, why]
                    : [null, null, null];
            for (const change of lineChanges)
                await this.db.execute(
                    `update bill_farmasi_detail set harga_satuan = $1, persen_diskon = $2, harga_diubah_pada = $3,
                            harga_diubah_oleh_user_id = $4, alasan_ubah_harga = $5, updated_at = $6
                     where tenant_id = $7 and id = $8`,
                    [
                        toNumeric(change.price.unitPrice, quantityScale),
                        toNumeric(change.price.discountPercent, quantityScale),
                        ...audit(change.differs),
                        stamp,
                        scope.tenantId,
                        change.id,
                    ],
                );
            for (const change of feeChanges)
                await this.db.execute(
                    `update bill_farmasi_biaya set nilai = $1, nilai_diubah_pada = $2, nilai_diubah_oleh_user_id = $3,
                            alasan_ubah_nilai = $4, updated_at = $5
                     where tenant_id = $6 and id = $7`,
                    [
                        toNumeric(change.amount, quantityScale),
                        ...audit(change.differs),
                        stamp,
                        scope.tenantId,
                        change.id,
                    ],
                );
            await this.db.execute(
                'update bill_farmasi set updated_at = $1 where tenant_id = $2 and id = $3',
                [stamp, scope.tenantId, current.id],
            );
            await publishDispensingCharges(this.db, scope, current.id);
        });
        return this.show(prescriptionId);
    }

    // Batal resep ("Tidak Diambil" di antrean sistem lama): resep keluar dari antrean. Resep yang sudah disiapkan
    // dibatalkan bersama penyiapannya, jadi stoknya kembali dan obatnya keluar dari tagihan kasir; draf penyerahan
    // dibiarkan karena belum memposting apa pun. Obat yang sudah diserahkan dikembalikan lewat retur, bukan di sini.
    // Permintaan yang diulang sesudah resep dibatalkan tidak menulis apa pun.
    async cancelPrescription(prescriptionId: string, body: unknown) {
        this.workspace.guard('prescription', 'cancel');
        const data = parseInput(prescriptionCancelInputSchema, body, {
            reason: messages.cancel_reason,
            version: messages.version,
        });
        const reason = data.reason.trim();
        if (!reason) validation({ reason: messages.cancel_reason });
        if (reason.length > 200) validation({ reason: messages.reason });
        await this.db.transaction(async () => {
            const locked = await this.lock(prescriptionId, true);
            if (locked.cancelled) return;
            const current = await this.active(locked.id);
            if (current?.status === 'diserahkan')
                validation({ _form: handedOverCancelMessage });
            if ((current?.version ?? null) !== data.version)
                coded(409, 'stale_version', staleMessage);
            if (current && current.status !== 'draf')
                await this.reversePreparation(current.id, locked.visit_id);
            const stamp = nowSql();
            await this.db.execute(
                `update far_tr_resep set dibatalkan_pada = $1, dibatalkan_oleh_user_id = $2, alasan_batal = $3,
                        updated_at = $1
                 where tenant_id = $4 and id = $5`,
                [
                    stamp,
                    this.workspace.userId,
                    reason,
                    this.scope.tenantId,
                    locked.id,
                ],
            );
            await publishPrescriptionCancelled(this.db, this.scope, locked.id);
        });
        return this.show(prescriptionId);
    }

    // Batch yang masih punya stok untuk satu barang di satu lokasi, kedaluwarsa terdekat lebih dulu. Dibaca layar
    // penyiapan resep dan loket obat bebas.
    async batches(parameters: URLSearchParams) {
        if (
            !this.workspace.permissions.has('pharmacy.prescription.read') &&
            !this.workspace.permissions.has('pharmacy.otc-sale.read')
        )
            abort(403, 'Tidak diizinkan.');
        const itemId = lookupId(parameters.get('item_id') ?? '');
        const locationId = lookupId(parameters.get('location_id') ?? '');
        if (!itemId || !locationId) return { data: [], next_cursor: null };
        const query = (parameters.get('q') ?? '').trim().toUpperCase();
        return {
            data: (
                await openStock(this.db, this.scope, locationId, [itemId])
            ).flatMap((row) =>
                row.batch?.number.toUpperCase().includes(query)
                    ? [
                          {
                              id: row.batch.id,
                              code: row.batch.number,
                              name: row.batch.number,
                              expiry_date: row.batch.expiry,
                              quantity: quantityText(row.quantity),
                          },
                      ]
                    : [],
            ),
            next_cursor: null,
        };
    }

    // Pengguna tenant yang bisa dicatat sebagai apoteker atau asisten, dicari dengan namanya.
    async staff(parameters: URLSearchParams) {
        this.workspace.guard('prescription', 'read');
        const query = `%${(parameters.get('q') ?? '').trim()}%`;
        return {
            data: await this.db.rows(
                z.object({
                    id: z.string(),
                    code: z.string(),
                    name: z.string(),
                }),
                `select u.id, '' as code, u.name from users u
                 join tenant_memberships m on m.user_id = u.id and m.tenant_id = $1 and m.status = 'active'
                 where u.name ilike $2
                 order by u.name, u.id
                 limit 50`,
                [this.scope.tenantId, query],
            ),
            next_cursor: null,
        };
    }
}
