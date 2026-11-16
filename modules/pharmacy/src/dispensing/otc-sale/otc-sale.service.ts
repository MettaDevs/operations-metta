import { z } from 'zod';
import type { Workspace } from '@core/platform/access/index.ts';
import { nowSql, type Database } from '@core/platform/database/index.ts';
import {
    coded,
    HttpFailure,
    incrementalList,
    lookupId,
    validation,
} from '@core/platform/http/index.ts';
import {
    activeLegalEntity,
    baseQuantity,
    decimalInput,
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
    payBill,
    paymentOptions,
    replaceSaleBill,
} from '@core/foundation/billing/index.ts';
import {
    amountInput,
    Currency,
    localCurrencyCode,
    type Precision,
} from '@core/foundation/currency/index.ts';
import { Decimal } from '@core/platform/money/index.ts';
import { NumberIssuer } from '@core/foundation/number-sequence/index.ts';
import { priceDrugLines } from '../../drug/drug-price/drug-price.service.ts';
import { moduleId } from '../../module.ts';
import {
    dispensingNumberReference,
    dispensingSource,
    inexactBaseMessage,
} from '../dispensing/dispensing.service.ts';
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
    'location_id' | 'price_group_id' | 'ktp_patient' | 'lines'
>;

type SaleLine = {
    field: string;
    item: { id: string; code: string; name: string };
    unitId: string;
    quantityPerUnit: bigint;
    quantity: bigint;
    baseQuantity: bigint;
    batchId: string | null;
};

type CheckedSale = {
    location: SaleLocation;
    priceGroupId: string | null;
    ktpPatient: boolean;
    lines: SaleLine[];
};

const itemRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    sales_unit_id: z.string(),
});

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
                lines: priced.lines.map(({ line, price, amount }) => ({
                    item_id: line.item.id,
                    unit_id: line.unitId,
                    quantity: quantityText(line.quantity),
                    unit_price: quantityText(price.unitPrice),
                    discount_percent: quantityText(price.discountPercent),
                    amount,
                })),
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
            for (const { id, order, line, price } of lines)
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
                    created_at: stamp,
                    updated_at: stamp,
                });
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
            const { version } = await replaceSaleBill(this.db, {
                tenantId: scope.tenantId,
                legalEntityId: scope.legalEntityId,
                operatingUnitId: sale.location.operating_unit_id,
                module: moduleId,
                documentId: billId,
                number,
                date,
                buyer,
                group: 'OBAT',
                lines: lines.map(({ id, line, price }) => ({
                    lineId: id,
                    item: line.item,
                    quantity: quantityText(line.quantity),
                    unitPrice: quantityText(price.unitPrice),
                    discountPercent: quantityText(price.discountPercent),
                })),
            });
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
        const scope = this.scope;
        const locationId = lookupId(data.location_id);
        const [location] = locationId
            ? await saleLocations(this.db, scope, locationId)
            : [];
        if (!location) errors.location_id = locationNotAllowedMessage;
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
                });
        }
        if (Object.keys(errors).length || !location) validation(errors);
        return {
            location,
            priceGroupId,
            ktpPatient: data.ktp_patient ?? true,
            lines,
        };
    }

    // Harga obat dengan grading resep (kelompok harga, Patient KTP, dan tanggal penjualan), lalu nilai baris dan total
    // dengan rumus kasir atas baris tagihan yang sama: Qty jumlah jual, Nilai dan HargaOrig harga satuan, Disc % diskon,
    // HExt 0, tanpa kelompok jasa. Nilai baris dibulatkan ke presisi jumlah, total ke pembulatan tagihan.
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
            price: { unitPrice: bigint; discountPercent: bigint };
        }) => ({
            serviceGroupId: null,
            quantity: quantityText(line.quantity),
            value: quantityText(price.unitPrice),
            originalPrice: quantityText(price.unitPrice),
            discountPercent: quantityText(price.discountPercent),
            extra: '0',
        });
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
        ).map((entry) => ({
            ...entry,
            amount:
                invoiceTotals([charge(entry)], precision).groups.get(null) ??
                '0',
        }));
        return {
            lines,
            total: invoiceTotals(lines.map(charge), precision).value,
        };
    }
}
