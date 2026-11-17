import { z } from 'zod';
import type { Workspace } from '@core/platform/access/index.ts';
import {
    isoSql,
    nowSql,
    type Bind,
    type Database,
} from '@core/platform/database/index.ts';
import {
    abort,
    coded,
    dateSchema,
    HttpFailure,
    incrementalList,
    lookupId,
    validation,
} from '@core/platform/http/index.ts';
import {
    activeLegalEntity,
    requireLocationAccess,
    baseQuantity,
    decimalInput,
    fromNumeric,
    itemUnits,
    openStock,
    parseInput,
    postItemLines,
    quantityHint,
    quantityScale,
    toNumeric,
    unitConversion,
} from '@core/foundation/inventory/index.ts';
import {
    invoiceTotals,
    paidDocuments,
    payBill,
    paymentOptions,
    replaceSaleBill,
} from '@core/foundation/billing/index.ts';
import {
    amountInput,
    Currency,
    localCurrencyCode,
    unitAmountDecimals,
    type Precision,
} from '@core/foundation/currency/index.ts';
import { Decimal } from '@core/platform/money/index.ts';
import { NumberIssuer } from '@core/foundation/number-sequence/index.ts';
import { priceDrugLines } from '../../drug/drug-price/drug-price.service.ts';
import type { BilledFee } from '../dispensing-fee/dispensing-fee.schema.ts';
import {
    billedFees,
    chargeFees,
    feeName,
    feeRates,
    freezeFees,
    plannedFees,
} from '../dispensing-fee/dispensing-fee.service.ts';
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
import {
    dispensingNumberReference,
    dispensingSource,
    inexactBaseMessage,
} from '../dispensing/dispensing.service.ts';
import { netLines, type NetLine } from '../dispensing/dispensing.events.ts';
import { quantityText } from '../dispensing/dispensing.units.ts';
import {
    priceGroupAvailable,
    saleLocations,
    type SaleLocation,
} from '../otc-sale-location/otc-sale-location.service.ts';
import {
    otcSaleInputSchema,
    otcSaleQuoteInputSchema,
} from './otc-sale.schema.ts';

type Scope = { tenantId: string; legalEntityId: string };

const messages = {
    location_id: 'Pilih lokasi penjualan dari daftar.',
    price_group_id: 'Pilih kelompok harga dari daftar.',
    ktp_patient: 'Pilih apakah pembeli ber-KTP atau tidak.',
    buyer_party_id: 'Pilih pembeli dari buku alamat.',
    buyer_name: 'Isi nama pembeli.',
    lines: 'Isi satu sampai 200 baris obat.',
    item_id: 'Pilih obat dari daftar.',
    unit_id: 'Pilih satuan obat ini dari daftar.',
    quantity: `Isi jumlah lebih dari 0, ${quantityHint}.`,
    batch_id: 'Pilih batch dari daftar.',
    expected_total: 'Hitung ulang total, lalu ulangi Simpan dan bayar.',
};

const staleTotalMessage =
    'Harga atau total berubah sejak dihitung. Periksa total terbaru, lalu ulangi Simpan dan bayar.';
const locationNotAllowedMessage =
    'Lokasi ini belum diatur untuk penjualan obat bebas. Pilih lokasi dari daftar, atau atur di Setup › Lokasi penjualan obat bebas.';

// Bagian isian yang sama di quote dan Simpan dan bayar; baris quote tidak membawa batch.
type SaleShape = Pick<
    z.output<typeof otcSaleInputSchema>,
    | 'location_id'
    | 'price_group_id'
    | 'ktp_patient'
    | 'without_prescription'
    | 'price_reason'
    | 'lines'
>;

type RequestedPrice = {
    unit_price?: string | number | null;
    discount_percent?: string | number | null;
    fee_amount?: string | number | null;
};

type SaleLine = {
    field: string;
    item: { id: string; code: string; name: string };
    unitId: string;
    quantityPerUnit: bigint;
    quantity: bigint;
    baseQuantity: bigint;
    batchId: string | null;
    requested: RequestedPrice;
};

type CheckedSale = {
    location: SaleLocation;
    priceGroupId: string | null;
    ktpPatient: boolean;
    withoutPrescription: boolean;
    priceReason: string | null | undefined;
    lines: SaleLine[];
};

const requestsOverride = (data: SaleShape) =>
    (data.price_reason ?? null) !== null ||
    data.lines.some(
        (line) =>
            (line.unit_price ?? null) !== null ||
            (line.discount_percent ?? null) !== null ||
            (line.fee_amount ?? null) !== null,
    );

const itemRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    sales_unit_id: z.string(),
});

const reference = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});

const saleRowSchema = z.object({
    id: z.string(),
    number: z.string(),
    date: z.string(),
    handed_over_at: z.string(),
    location: reference,
    buyer_name: z.string().nullable(),
});

// Penjualan obat bebas legal entity ini: bill_farmasi tanpa resep.
const saleRowSql = `select * from (
                        select h.id, h.nomor as number, h.tanggal::text as date,
                               ${isoSql('h.diserahkan_pada')} as handed_over_at, h.diserahkan_pada as handed_over_order,
                               json_build_object('id', l.id, 'code', l.kode, 'name', l.nama) as location,
                               l.nama as location_name, h.pembeli_nama as buyer_name
                        from bill_farmasi h
                        join gd_m_lokasi l on l.tenant_id = h.tenant_id and l.id = h.lokasi_id
                        where h.tenant_id = $1 and h.legal_entity_id = $2 and h.resep_id is null
                          and h.deleted_at is null) sales where true`;

// Baris tagihan penjualan dengan rumus kasir: Qty jumlah jual, Nilai dan HargaOrig harga satuan, Disc % diskon, HExt
// 0, tanpa kelompok jasa. Quote, daftar, dan kartu penjualan memakainya, jadi angka yang terlihat sama dengan yang
// ditagih kasir.
const saleCharge = (quantity: string, unitPrice: string, discount: string) => ({
    serviceGroupId: null,
    quantity,
    value: unitPrice,
    originalPrice: unitPrice,
    discountPercent: discount,
    extra: '0',
});

const lineAmount = (line: NetLine, precision: Precision) =>
    line.kept
        ? (invoiceTotals(
              [
                  saleCharge(
                      line.net_quantity,
                      line.unit_price,
                      line.discount_percent,
                  ),
              ],
              precision,
          ).groups.get(null) ?? '0')
        : '0';

// Biaya racik dan resep menjadi baris tagihan Qty 1 tanpa diskon.
const feeCharge = (fee: { amount: string }) => saleCharge('1', fee.amount, '0');

const saleTotal = (
    lines: NetLine[],
    fees: { amount: string }[],
    precision: Precision,
) =>
    invoiceTotals(
        [
            ...lines
                .filter((line) => line.kept)
                .map((line) =>
                    saleCharge(
                        line.net_quantity,
                        line.unit_price,
                        line.discount_percent,
                    ),
                ),
            ...fees.map(feeCharge),
        ],
        precision,
    ).value;

const keptIds = (lines: NetLine[]) =>
    new Set(lines.filter((line) => line.kept).map((line) => line.line_id));

const shownFee = ({
    dispensing_id: _,
    ...fee
}: BilledFee & { dispensing_id: string }): BilledFee => fee;

// Tagihan penjualan kasir dari penjualan yang tersimpan: baris dengan Qty bersih sesudah retur yang masih berlaku, dan
// baris yang habis diretur keluar dari tagihan. Dipanggil di transaksi Simpan dan bayar, retur, dan Batal retur.
// Menjawab versi tagihan untuk payBill.
export async function replaceOtcSaleBill(
    db: Database,
    scope: Scope,
    billId: string,
): Promise<{ version: number }> {
    const sale = await db.one(
        z.object({
            operating_unit_id: z.string(),
            number: z.string(),
            date: z.string(),
            buyer_party_id: z.string().nullable(),
            buyer_name: z.string().nullable(),
        }),
        `select operating_unit_id, nomor as number, tanggal::text as date, pembeli_pihak_id as buyer_party_id,
                pembeli_nama as buyer_name
         from bill_farmasi
         where tenant_id = $1 and legal_entity_id = $2 and id = $3 and resep_id is null`,
        [scope.tenantId, scope.legalEntityId, billId],
    );
    if (!sale) throw new Error(`OTC sale ${billId} was not found.`);
    const lines = await netLines(db, scope.tenantId, [billId]);
    return replaceSaleBill(db, {
        tenantId: scope.tenantId,
        legalEntityId: scope.legalEntityId,
        operatingUnitId: sale.operating_unit_id,
        module: moduleId,
        documentId: billId,
        number: sale.number,
        date: sale.date,
        buyer: { partyId: sale.buyer_party_id, name: sale.buyer_name },
        group: 'OBAT',
        lines: lines
            .filter((line) => line.kept)
            .map((line) => ({
                lineId: line.line_id,
                item: line.item,
                quantity: line.net_quantity,
                unitPrice: line.unit_price,
                discountPercent: line.discount_percent,
            })),
        fees: chargeFees(
            await billedFees(db, scope.tenantId, [billId], keptIds(lines)),
        ),
    });
}

const errorsSchema = z.object({
    errors: z.record(z.string(), z.array(z.string())),
});

// Penolakan kasir memakai nama field Form Pembayaran (`lines.0.amount`, `received`). Di loket, `lines` adalah baris
// obat, jadi field pembayaran dipindah ke bawah `payment.`; `_form` tetap pesan form.
async function paymentFieldsUnderPayment<T>(work: Promise<T>): Promise<T> {
    try {
        return await work;
    } catch (error) {
        if (!(error instanceof HttpFailure) || error.status !== 422)
            throw error;
        const refused = errorsSchema.safeParse(error.body);
        if (!refused.success) throw error;
        return validation(
            Object.fromEntries(
                Object.entries(refused.data.errors).map(([field, list]) => [
                    field === '_form' ? field : `payment.${field}`,
                    list,
                ]),
            ),
        );
    }
}

// Penjualan obat bebas di loket farmasi, satu langkah: obat dihargai dengan grading harga obat seperti resep, stok
// keluar, tagihan penjualan kasir ditulis, dan pembayarannya disimpan, semuanya di satu transaksi (pola transaksi
// Commerce F&O dan dokumen penjualan BC yang dibayar saat diposting). Yang ditolak tidak menulis apa pun. Dokumennya
// bill_farmasi tanpa resep, lahir langsung diserahkan.
export class OtcSales {
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

    // Lokasi yang boleh menjual beserta kelompok harga bawaannya, lalu isian tender kasir Core. cashier adalah workspace
    // Core permintaan yang sama: jenis bayar, merchan, dan izin kasir dibaca dari sana. Pencarian pembeli memakai buku
    // alamat Core, jadi layar perlu tahu apakah pengguna boleh membacanya.
    async options(cashier: Workspace) {
        this.workspace.guard('otc-sale', 'read');
        return {
            data: {
                locations: (await saleLocations(this.db, this.scope)).map(
                    (location) => ({
                        id: location.id,
                        code: location.code,
                        name: location.name,
                        price_group: location.price_group,
                    }),
                ),
                ...(await paymentOptions(this.db, cashier)),
                can_search_buyers: cashier.permissions.has(
                    'core.organization.read',
                ),
                can_override_price: canOverridePrice(this.workspace),
            },
        };
    }

    // Pencarian obat di loket: barang legal entity ini yang tidak diblokir, sama dengan yang diterima quote, dengan
    // pilihan satuannya (satuan dasar lebih dulu) dan satuan jual bawaannya. Stok dalam satuan dasar hanya diisi untuk
    // lokasi yang boleh menjual obat bebas.
    async items(parameters: URLSearchParams) {
        this.workspace.guard('otc-sale', 'read');
        const scope = this.scope;
        const batch = await incrementalList(this.db, {
            query: `select * from (select id, kode as code, nama as name,
                                          coalesce(satuan_jual_id, satuan_dasar_id) as sales_unit_id
                                   from gd_m_barang
                                   where tenant_id = $1 and legal_entity_id = $2 and deleted_at is null
                                     and not diblokir) items where true`,
            bindings: [scope.tenantId, scope.legalEntityId],
            parameters,
            columns: { name: 'name', code: 'code' },
            searchColumns: ['code', 'name'],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
        const rows = batch.data.map((row) => itemRowSchema.parse(row));
        const ids = rows.map((row) => row.id);
        const units = await itemUnits(this.db, scope, ids);
        const locationId = lookupId(parameters.get('location_id') ?? '');
        const [location] = locationId
            ? await saleLocations(this.db, scope, locationId)
            : [];
        const stock = new Map<string, bigint>();
        if (location)
            for (const entry of await openStock(
                this.db,
                scope,
                location.id,
                ids,
            ))
                stock.set(
                    entry.itemId,
                    (stock.get(entry.itemId) ?? 0n) + entry.quantity,
                );
        return {
            data: rows.map((row) => ({
                ...row,
                units: units.get(row.id) ?? [],
                stock: location ? quantityText(stock.get(row.id) ?? 0n) : null,
            })),
            next_cursor: batch.next_cursor,
        };
    }

    async quote(body: unknown) {
        this.workspace.guard('otc-sale', 'read');
        const sale = await this.checked(
            parseInput(otcSaleQuoteInputSchema, body, messages),
        );
        const priced = await this.priced(
            sale,
            await this.today(),
            await this.precision(),
        );
        return {
            data: {
                lines: priced.lines.map(
                    ({ line, price, computed, amount }) => ({
                        item_id: line.item.id,
                        unit_id: line.unitId,
                        quantity: quantityText(line.quantity),
                        unit_price: quantityText(price.unitPrice),
                        discount_percent: quantityText(price.discountPercent),
                        computed_unit_price: quantityText(computed.unitPrice),
                        computed_discount_percent: quantityText(
                            computed.discountPercent,
                        ),
                        amount,
                    }),
                ),
                fees: priced.fees.map(
                    ({ kind, name, lineId, amount, override }) => ({
                        kind,
                        name,
                        line_index: lineId === null ? null : Number(lineId),
                        amount: override?.amount ?? amount,
                        computed_amount: amount,
                    }),
                ),
                total: priced.total,
            },
        };
    }

    // Simpan dan bayar. Total dihitung ulang dari harga saat ini; total yang berbeda dengan yang dilihat petugas ditolak
    // sebelum apa pun ditulis, supaya pembeli tidak membayar angka yang tidak ia lihat. cashier adalah workspace Core
    // permintaan yang sama: izin kasir dan clerk dibaca kasir Core dari sana.
    async create(body: unknown, cashier: Workspace) {
        this.workspace.guard('otc-sale', 'post');
        const data = parseInput(otcSaleInputSchema, body, messages);
        const scope = this.scope;
        const userId = this.workspace.userId;
        return this.db.transaction(async () => {
            const errors: Record<string, string> = {};
            const buyer = await this.buyer(data, errors);
            const precision = await this.precision();
            const expected = amountInput(
                data.expected_total,
                precision.amount_decimals,
            );
            if (expected === null)
                errors.expected_total = messages.expected_total;
            const sale = await this.checked(data, errors);
            const date = await this.today();
            const priced = await this.priced(sale, date, precision);
            if (
                expected === null ||
                Decimal.of(expected).compare(Decimal.of(priced.total)) !== 0
            )
                coded(409, 'stale_total', staleTotalMessage);
            const billId = Bun.randomUUIDv7();
            const number = await new NumberIssuer(this.db, {
                tenantId: scope.tenantId,
                moduleId,
            }).issue({
                reference: dispensingNumberReference,
                key: `${dispensingSource}:${billId}`,
                documentDate: date,
                legalEntityId: scope.legalEntityId,
                operatingUnitId: sale.location.operating_unit_id,
            });
            const stamp = nowSql();
            await this.db.insert('bill_farmasi', {
                id: billId,
                tenant_id: scope.tenantId,
                legal_entity_id: scope.legalEntityId,
                operating_unit_id: sale.location.operating_unit_id,
                resep_id: null,
                nomor: number,
                status: 'diserahkan',
                lokasi_id: sale.location.id,
                tanggal: date,
                disiapkan_pada: stamp,
                disiapkan_oleh_user_id: userId,
                diserahkan_pada: stamp,
                diserahkan_oleh_user_id: userId,
                termasuk_jasa: false,
                tanpa_resep: sale.withoutPrescription,
                kelompok_harga_id: sale.priceGroupId,
                pasien_ktp: sale.ktpPatient,
                pembeli_pihak_id: buyer.partyId,
                pembeli_nama: buyer.name,
                created_at: stamp,
                updated_at: stamp,
            });
            const lines = priced.lines.map((entry, index) => ({
                ...entry,
                id: Bun.randomUUIDv7(),
                order: index + 1,
            }));
            for (const { id, order, line, price, computed, changed } of lines)
                await this.db.insert('bill_farmasi_detail', {
                    id,
                    tenant_id: scope.tenantId,
                    legal_entity_id: scope.legalEntityId,
                    bill_farmasi_id: billId,
                    resep_detail_id: null,
                    urutan: order,
                    barang_id: line.item.id,
                    jumlah: toNumeric(line.quantity, quantityScale),
                    satuan_id: line.unitId,
                    konversi: toNumeric(line.quantityPerUnit, quantityScale),
                    batch_id: line.batchId,
                    harga_dasar: toNumeric(price.basePrice, quantityScale),
                    grading_harga_id: price.gradingId,
                    persen_naik: toNumeric(price.markupPercent, quantityScale),
                    harga_satuan: toNumeric(price.unitPrice, quantityScale),
                    persen_diskon: toNumeric(
                        price.discountPercent,
                        quantityScale,
                    ),
                    harga_satuan_hitung: toNumeric(
                        computed.unitPrice,
                        quantityScale,
                    ),
                    persen_diskon_hitung: toNumeric(
                        computed.discountPercent,
                        quantityScale,
                    ),
                    harga_diubah_pada: changed ? stamp : null,
                    harga_diubah_oleh_user_id: changed ? userId : null,
                    alasan_ubah_harga: changed ? priced.reason : null,
                    created_at: stamp,
                    updated_at: stamp,
                });
            await freezeFees(
                this.db,
                scope,
                billId,
                priced.fees.map((fee) => ({
                    ...fee,
                    lineId:
                        fee.lineId === null
                            ? null
                            : (lines[Number(fee.lineId)]?.id ?? null),
                })),
            );
            await postItemLines(
                this.db,
                {
                    tenantId: scope.tenantId,
                    legalEntityId: scope.legalEntityId,
                    userId,
                    postingDate: date,
                    source: { type: dispensingSource, id: billId, number },
                },
                lines.map(({ id, line }) => ({
                    kind: 'outbound' as const,
                    entryKind: 'penyerahan' as const,
                    key: `${dispensingSource}:${id}`,
                    field: line.field,
                    sourceLineId: id,
                    itemId: line.item.id,
                    quantity: line.baseQuantity,
                    locationId: sale.location.id,
                    batchId: line.batchId,
                })),
            );
            const { version } = await replaceOtcSaleBill(
                this.db,
                scope,
                billId,
            );
            const payment = await paymentFieldsUnderPayment(
                payBill(this.db, cashier, billId, data.payment, version),
            );
            return {
                status: 201,
                headers: {},
                body: { data: { id: billId, number, payment } },
            };
        });
    }

    // Daftar penjualan menurut tanggal penjualan (from dan to, keduanya opsional), dimuat bertahap, terbaru lebih dulu.
    // total adalah yang ditagih kasir sesudah retur; paid berarti ada pembayaran kasir yang masih berlaku.
    async list(parameters: URLSearchParams) {
        this.workspace.guard('otc-sale', 'read');
        const bindings: Bind[] = [
            this.scope.tenantId,
            this.scope.legalEntityId,
        ];
        let filter = '';
        const from = parameters.get('from') ?? '';
        if (dateSchema.safeParse(from).success)
            filter += ` and date >= $${bindings.push(from)}`;
        const to = parameters.get('to') ?? '';
        if (dateSchema.safeParse(to).success)
            filter += ` and date <= $${bindings.push(to)}`;
        const batch = await incrementalList(this.db, {
            query: `${saleRowSql}${filter}`,
            bindings,
            parameters,
            columns: {
                handed_over_at: 'handed_over_order',
                number: 'number',
                location: 'location_name',
                buyer_name: 'buyer_name',
            },
            searchColumns: ['number', 'buyer_name'],
            numericColumns: [],
            defaultSort: 'handed_over_at',
            defaultDirection: 'desc',
        });
        const rows = batch.data.map((row) => saleRowSchema.parse(row));
        const lines = await netLines(
            this.db,
            this.scope.tenantId,
            rows.map((row) => row.id),
        );
        const paid = await paidDocuments(
            this.db,
            this.scope.tenantId,
            rows.map((row) => row.id),
        );
        const fees = await billedFees(
            this.db,
            this.scope.tenantId,
            rows.map((row) => row.id),
            keptIds(lines),
        );
        const precision = await this.precision();
        return {
            data: rows.map((row) => ({
                ...row,
                total: saleTotal(
                    lines.filter((line) => line.dispensing_id === row.id),
                    fees.filter((fee) => fee.dispensing_id === row.id),
                    precision,
                ),
                paid: paid.has(row.id),
            })),
            next_cursor: batch.next_cursor,
        };
    }

    // Kartu penjualan: kepala, lalu baris dengan jumlah terjual, jumlah yang masih ditagih sesudah retur, dan nilainya.
    async show(id: string) {
        this.workspace.guard('otc-sale', 'read');
        const scope = this.scope;
        const sale = lookupId(id)
            ? await this.db.one(
                  saleRowSchema.extend({
                      ktp_patient: z.boolean(),
                      without_prescription: z.boolean(),
                      price_group: reference.nullable(),
                  }),
                  `select sales.*, h.pasien_ktp as ktp_patient, h.tanpa_resep as without_prescription,
                          case when g.id is null then null
                               else json_build_object('id', g.id, 'code', g.kode, 'name', g.nama) end as price_group
                   from (${saleRowSql} and id = $3) sales
                   join bill_farmasi h on h.tenant_id = $1 and h.id = sales.id
                   left join kelompok_harga g on g.tenant_id = h.tenant_id and g.id = h.kelompok_harga_id`,
                  [scope.tenantId, scope.legalEntityId, id],
              )
            : undefined;
        if (!sale) abort(404, 'Not Found');
        const lines = await netLines(this.db, scope.tenantId, [sale.id]);
        const fees = (
            await billedFees(this.db, scope.tenantId, [sale.id], keptIds(lines))
        ).map(shownFee);
        const paid = await paidDocuments(this.db, scope.tenantId, [sale.id]);
        const precision = await this.precision();
        return {
            data: {
                ...sale,
                total: saleTotal(lines, fees, precision),
                fees,
                paid: paid.has(sale.id),
                lines: lines.map((line) => ({
                    line_id: line.line_id,
                    item: line.item,
                    unit_code: line.unit_code,
                    quantity: line.quantity,
                    net_quantity: line.net_quantity,
                    unit_price: line.unit_price,
                    discount_percent: line.discount_percent,
                    amount: lineAmount(line, precision),
                })),
            },
        };
    }

    private precision(): Promise<Precision> {
        return new Currency(this.db, this.scope.tenantId).precision(
            localCurrencyCode,
        );
    }

    private async today(): Promise<string> {
        const today = await this.db.one(
            z.object({ date: z.string() }),
            `select (now() at time zone l.timezone)::date::text as date
             from legal_entities l where l.tenant_id = $1 and l.organization_id = $2`,
            [this.scope.tenantId, this.scope.legalEntityId],
        );
        return today?.date ?? nowSql().slice(0, 10);
    }

    // Pembeli dari buku alamat Core, nama yang diketik, keduanya, atau tidak ada (pembeli umum). Nama yang disalin ke
    // penjualan dan tagihannya adalah nama yang diketik, atau nama pihaknya bila tidak diketik.
    private async buyer(
        data: { buyer_party_id?: string | null; buyer_name?: string | null },
        errors: Record<string, string>,
    ): Promise<{ partyId: string | null; name: string | null }> {
        const partyId = data.buyer_party_id || null;
        const party =
            partyId !== null && lookupId(partyId)
                ? await this.db.one(
                      z.object({ name: z.string() }),
                      'select name from parties where tenant_id = $1 and id = $2 and deleted_at is null',
                      [this.scope.tenantId, partyId],
                  )
                : undefined;
        if (partyId !== null && !party)
            errors.buyer_party_id = messages.buyer_party_id;
        const typed = data.buyer_name?.trim() || null;
        if (typed && typed.length > 255)
            errors.buyer_name = 'Nama pembeli paling banyak 255 karakter.';
        return { partyId, name: typed ?? party?.name ?? null };
    }

    // Lokasi yang diizinkan, kelompok harga, dan baris obat: barang legal entity ini yang tidak diblokir, satuan milik
    // barang itu, jumlah lebih dari 0 yang tepat dalam satuan dasar, dan batch milik barang itu.
    private async checked(
        data: SaleShape,
        errors: Record<string, string> = {},
    ): Promise<CheckedSale> {
        if (requestsOverride(data)) guardPriceOverride(this.workspace);
        const scope = this.scope;
        const locationId = lookupId(data.location_id);
        const [location] = locationId
            ? await saleLocations(this.db, scope, locationId)
            : [];
        if (!location) errors.location_id = locationNotAllowedMessage;
        else
            await requireLocationAccess(
                this.db,
                this.workspace,
                [location.id],
                {
                    field: 'location_id',
                },
            );
        const defaultPriceGroupId = location?.price_group?.id ?? null;
        const priceGroupId =
            data.price_group_id === undefined
                ? defaultPriceGroupId
                : data.price_group_id || null;
        if (
            priceGroupId !== null &&
            priceGroupId !== defaultPriceGroupId &&
            !(await priceGroupAvailable(this.db, scope.tenantId, priceGroupId))
        )
            errors.price_group_id = messages.price_group_id;
        const itemIds = data.lines.flatMap((line) => {
            const id = lookupId(line.item_id);
            return id ? [id] : [];
        });
        const items = new Map(
            (itemIds.length
                ? await this.db.rows(
                      z.object({
                          id: z.string(),
                          code: z.string(),
                          name: z.string(),
                      }),
                      `select id, kode as code, nama as name from gd_m_barang
                       where tenant_id = $1 and legal_entity_id = $2 and id = any($3::uuid[])
                         and deleted_at is null and not diblokir`,
                      [
                          scope.tenantId,
                          scope.legalEntityId,
                          `{${itemIds.join(',')}}`,
                      ],
                  )
                : []
            ).map((item) => [item.id, item]),
        );
        const lines: SaleLine[] = [];
        for (const [index, line] of data.lines.entries()) {
            const field = `lines.${index}`;
            const item = items.get(line.item_id);
            if (!item) {
                errors[`${field}.item_id`] = messages.item_id;
                continue;
            }
            const quantityPerUnit = await unitConversion(
                this.db,
                scope,
                item.id,
                line.unit_id,
            );
            if (quantityPerUnit === null)
                errors[`${field}.unit_id`] = messages.unit_id;
            const quantity = decimalInput(line.quantity);
            const base =
                quantity !== null && quantityPerUnit !== null
                    ? baseQuantity(quantity, quantityPerUnit)
                    : null;
            if (quantity === null || quantity <= 0n)
                errors[`${field}.quantity`] = messages.quantity;
            else if (quantityPerUnit !== null && base === null)
                errors[`${field}.quantity`] = inexactBaseMessage;
            const batchId = line.batch_id || null;
            if (
                batchId !== null &&
                !(
                    lookupId(batchId) &&
                    (await this.db.one(
                        z.object({ id: z.string() }),
                        `select id from gd_m_batch
                         where tenant_id = $1 and legal_entity_id = $2 and id = $3 and barang_id = $4`,
                        [scope.tenantId, scope.legalEntityId, batchId, item.id],
                    ))
                )
            )
                errors[`${field}.batch_id`] = messages.batch_id;
            if (quantity !== null && quantityPerUnit !== null && base !== null)
                lines.push({
                    field,
                    item,
                    unitId: line.unit_id,
                    quantityPerUnit,
                    quantity,
                    baseQuantity: base,
                    batchId,
                    requested: line,
                });
        }
        if (Object.keys(errors).length || !location) validation(errors);
        return {
            location,
            priceGroupId,
            ktpPatient: data.ktp_patient ?? true,
            withoutPrescription: data.without_prescription ?? true,
            priceReason: data.price_reason,
            lines,
        };
    }

    // Harga obat dengan grading resep (kelompok harga, Patient KTP, dan tanggal penjualan), lalu nilai baris dan total
    // dengan rumus kasir atas baris tagihan yang sama: Qty jumlah jual, Nilai dan HargaOrig harga satuan, Disc % diskon,
    // HExt 0, tanpa kelompok jasa. Nilai baris dibulatkan ke presisi jumlah, total ke pembulatan tagihan. Harga, diskon,
    // dan biaya resep yang diketik pemegang izin ubah harga menggantikan hitungan; yang berbeda wajib beralasan.
    private async priced(
        sale: CheckedSale,
        date: string,
        precision: Precision,
    ) {
        const charge = ({
            line,
            price,
        }: {
            line: SaleLine;
            price: LinePrice;
        }) =>
            saleCharge(
                quantityText(line.quantity),
                quantityText(price.unitPrice),
                quantityText(price.discountPercent),
            );
        const errors: Record<string, string> = {};
        const requested = (
            index: number,
            name: keyof RequestedPrice,
            parse: (raw: unknown) => bigint | { error: string },
        ): bigint | null => {
            const raw = sale.lines[index]?.requested[name] ?? null;
            if (raw === null) return null;
            const value = parse(raw);
            if (typeof value === 'bigint') return value;
            errors[`lines.${String(index)}.${name}`] = value.error;
            return null;
        };
        const lines = (
            await priceDrugLines(
                this.db,
                this.scope,
                {
                    priceGroupId: sale.priceGroupId,
                    ktpPatient: sale.ktpPatient,
                    date,
                },
                sale.lines.map((line) => ({
                    ...line,
                    itemId: line.item.id,
                })),
            )
        ).map(({ line, price: computed }, index) => {
            const price = {
                ...computed,
                unitPrice:
                    requested(index, 'unit_price', (raw) =>
                        unitPriceInput(raw, unitAmountDecimals(precision)),
                    ) ?? computed.unitPrice,
                discountPercent:
                    requested(index, 'discount_percent', discountInput) ??
                    computed.discountPercent,
            };
            const entry = { line, price };
            return {
                ...entry,
                computed: {
                    unitPrice: computed.unitPrice,
                    discountPercent: computed.discountPercent,
                },
                changed: !samePrice(price, computed),
                amount:
                    invoiceTotals([charge(entry)], precision).groups.get(
                        null,
                    ) ?? '0',
            };
        });
        // Penjualan obat bebas tidak punya racikan, jadi hanya biaya resep yang mungkin. lineId adalah urutan baris.
        const planned = plannedFees(
            await feeRates(this.db, this.scope, {
                locationId: sale.location.id,
                priceGroupId: sale.priceGroupId,
            }),
            sale.lines.map((_, index) => ({
                lineId: String(index),
                compound: null,
            })),
            sale.withoutPrescription,
        );
        const feeAmounts = sale.lines.map((_, index) =>
            requested(index, 'fee_amount', (raw) =>
                feeAmountInput(raw, precision.amount_decimals),
            ),
        );
        for (const [index, value] of feeAmounts.entries())
            if (
                value !== null &&
                !planned.some((fee) => fee.lineId === String(index))
            )
                errors[`lines.${String(index)}.fee_amount`] =
                    'Obat ini tidak dikenai biaya resep, jadi biayanya tidak bisa diubah.';
        const reason = checkedReason(sale.priceReason);
        const typedFees = planned.map((fee) => {
            const typed = feeAmounts[Number(fee.lineId)] ?? null;
            return {
                fee,
                typed:
                    typed !== null &&
                    typed !== fromNumeric(fee.amount, quantityScale)
                        ? typed
                        : null,
            };
        });
        if ('error' in reason) errors.price_reason = reason.error;
        else if (
            reason.reason === null &&
            (lines.some((line) => line.changed) ||
                typedFees.some(({ typed }) => typed !== null))
        )
            errors.price_reason = reasonMessage;
        if (Object.keys(errors).length) validation(errors);
        const why = 'reason' in reason ? (reason.reason ?? '') : '';
        const fees = typedFees.map(({ fee, typed }) => ({
            ...fee,
            name: feeName(fee.kind, {
                compound: fee.compound,
                itemName: sale.lines[Number(fee.lineId)]?.item.name ?? null,
            }),
            override:
                typed === null
                    ? undefined
                    : {
                          amount: quantityText(typed),
                          userId: this.workspace.userId,
                          reason: why,
                      },
        }));
        return {
            lines,
            fees,
            reason: why || null,
            total: invoiceTotals(
                [
                    ...lines.map(charge),
                    ...fees.map((fee) =>
                        feeCharge({
                            amount: fee.override?.amount ?? fee.amount,
                        }),
                    ),
                ],
                precision,
            ).value,
        };
    }
}
