import { z } from 'zod';
import { Workspace } from '../../../platform/access/index.ts';
import { nowSql, type Database } from '../../../platform/database/index.ts';
import { publishEvent } from '../../../platform/events/index.ts';
import {
    Decimal,
    percentHint,
    percentInput,
} from '../../../platform/money/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    lookupId,
    staleMessage,
    validation,
} from '../../../platform/http/index.ts';
import { activeLegalEntity } from '../../inventory/index.ts';
import { NumberIssuer } from '../../number-sequence/index.ts';
import {
    amountInput,
    Currency,
    decimalsHint,
    exchangeRateDecimals,
    localCurrencyCode,
    missingRateMessage,
    toLocalAmount,
    type Precision,
} from '../../currency/index.ts';
import { openClerk } from '../clerk/clerk.service.ts';
import {
    cancelReceivables,
    openReceivables,
    refuseWhenPaidOff,
} from '../receivable-payment/receivable-payment.service.ts';
import {
    invoiceTotals,
    type InvoiceTotals,
} from '../invoice/invoice.totals.ts';
import {
    paymentCancelInputSchema,
    paymentInputSchema,
} from './payment.schema.ts';
import { fromMinor, paymentAmounts, toMinor } from './payment.amounts.ts';
import {
    discountBase,
    discountLine,
    isDiscountKind,
    type DiscountCharge,
} from './payment.discount.ts';

export const invoicePosted = 'billing.invoice.posted.v1' as const;
export const invoiceCancelled = 'billing.invoice.cancelled.v1' as const;

// Batal pembayaran. Pesan persetujuan dari sistem lama (General_payment::cancel). Pembayaran di clerk yang sudah Clerk
// End dikoreksi lewat nota kredit, bukan dibatalkan; pesan lamanya ("Pasien Sudah Di Proses Closing") diganti kalimat
// sehari-hari.
const cancelPermission = 'core.payment.cancel';
export const approvalMessage = 'Username atau Password Salah';
export const closedClerkMessage =
    'Pembayaran ini masuk clerk yang sudah Clerk End, jadi tidak bisa dibatalkan lagi.';
const alreadyCancelledMessage = 'Pembayaran ini sudah dibatalkan.';
const cancelledPaymentSchema = z.object({
    id: z.string(),
    status: z.string(),
    // Kosong untuk pembayaran otomatis, yang tidak masuk clerk mana pun.
    clerk_status: z.string().nullable(),
});

// Penyetuju batal pembayaran: email dan kata sandinya diperiksa sesi, hasilnya id pengguna atau null.
export type ApproverCheck = {
    verify: (email: string, password: string) => Promise<string | null>;
};

// Kunjungan yang dibuka kembali poli (rujuk internal sesudah Selesai periksa) belum siap dibayar.
export const reopenedMessage =
    'Kunjungan ini sedang diperiksa lagi di poli. Pembayaran bisa dilakukan setelah pemeriksaannya selesai.';

const source = 'healthcare';
const numberReference = 'core.payment-number';

// Pesan sistem lama (form.php, form/credit_card.php, form/credit_bon.php, SM poly_helper.php).
const remainderMessage = 'Masih terdapat Sisa pembayaran!!';
const merchantMessage = 'Anda belum memilih Merchan Bank!';
const partyMessage = 'Anda belum memilih Dokter/Karyawan Bon!';
// Sistem lama hanya menolak jenis bayar yang dikhususkan tipe pasien lain di browser (form/payment.php); di sini server
// juga menolaknya dengan pesan yang sama.
export const patientTypeMessage =
    'Tidak Dapat Menggunakan Tipe Pembayaran, Karena berbeda tipe pasien';
export const chargeLockedMessage =
    'Data sudah diproses pembayaran kasir. Tarif, BHP, dan resep tidak dapat diubah.';

const methodSchema = z.object({
    id: z.string(),
    perilaku: z.string(),
    pihak: z.string(),
    wajib_merchan: z.boolean(),
    wajib_referensi: z.boolean(),
    biaya_tambahan: z.boolean(),
    menampung_sisa: z.boolean(),
    aktif: z.boolean(),
    mata_uang: z.string().nullable(),
});

const chargeSchema = z.object({
    id: z.string(),
    jenis_biaya_id: z.string(),
    jenis_biaya_nama: z.string(),
    dokter_id: z.string().nullable(),
    dokter_nama: z.string().nullable(),
    kelompok_jasa_id: z.string().nullable(),
    kelompok_jasa_nama: z.string().nullable(),
    qty: z.string(),
    nilai: z.string(),
    harga_orig: z.string(),
    disc: z.string(),
    hext: z.string(),
});

// Kunci kunjungan untuk Simpan pembayaran dan perubahan biaya sumbernya, supaya keduanya tidak berjalan bersamaan:
// yang kedua menunggu yang pertama selesai, lalu melihat hasilnya.
async function lockVisit(
    db: Database,
    tenantId: string,
    visitId: string,
): Promise<void> {
    await db.execute(
        "select pg_advisory_xact_lock(hashtextextended($1 || ':' || $2 || ':' || $3, 0))",
        [tenantId, source, visitId],
    );
}

// Pembayaran batal: piutangnya ikut batal (ditolak bila sudah ada pelunasan), baris biaya kunjungan kembali terbuka, dan
// finance diberi tahu sekali dengan angka yang sama dengan saat bayar. Status pembayaran sudah diubah pemanggil.
async function reopenCancelled(
    db: Database,
    cancelled: {
        tenantId: string;
        legalEntityId: string;
        paymentId: string;
        number: string;
        visitId: string;
        registrationNumber: string;
        date: string;
        value: string;
        stamp: string;
        reason: string;
    },
): Promise<void> {
    await cancelReceivables(db, {
        tenantId: cancelled.tenantId,
        paymentId: cancelled.paymentId,
        stamp: cancelled.stamp,
    });
    await db.execute(
        `update kunjungan_kasir_detail set status = 'terbuka', kasir_id = null, updated_at = $1
         where tenant_id = $2 and kasir_id = $3`,
        [cancelled.stamp, cancelled.tenantId, cancelled.paymentId],
    );
    const lines = await db.rows(
        z.object({
            payment_method_id: z.string(),
            amount: z.string(),
            currency_code: z.string(),
            currency_amount: z.string(),
            exchange_rate: z.string(),
        }),
        `select jenis_bayar_id as payment_method_id, trim_scale(nilai)::text as amount,
                mata_uang as currency_code, trim_scale(nilai_valuta)::text as currency_amount,
                trim_scale(kurs)::text as exchange_rate
         from kasir_detail where tenant_id = $1 and kasir_id = $2 order by id`,
        [cancelled.tenantId, cancelled.paymentId],
    );
    await publishEvent(db, {
        type: invoiceCancelled,
        tenantId: cancelled.tenantId,
        legalEntityId: cancelled.legalEntityId,
        data: {
            payment_id: cancelled.paymentId,
            payment_number: cancelled.number,
            source_module: source,
            visit_id: cancelled.visitId,
            registration_number: cancelled.registrationNumber,
            date: cancelled.date,
            value: cancelled.value,
            cancelled_at: `${cancelled.stamp.replace(' ', 'T')}Z`,
            reason: cancelled.reason,
            payments: lines,
        },
    });
}

// Alasan batal pembayaran otomatis yang dibatalkan sistem karena biaya kunjungannya berubah.
export const automaticCancelReason =
    'Biaya kunjungan berubah sesudah lunas otomatis, jadi tagihan dilunasi ulang.';

// Dipanggil module sumber di dalam transaksi yang mengubah atau membatalkan biaya kunjungan (Biaya Tindakan, batal
// kunjungan, obat yang disiapkan, dibatalkan, atau diretur). Kunjungan yang dibayar kasir ditolak dengan pesan sistem
// lama; pembatalannya urusan kasir (kunci BC: batalkan pembayaran dulu). Pembayaran otomatis mengikuti tagihan:
// pembayaran itu dibatalkan di sini, lalu kunjungan dilunasi lagi saat biayanya yang baru sampai ke kasir, seperti
// Seroja yang menulis ulang pembayaran BPJS di setiap Simpan poli.
export async function lockChargeForChange(
    db: Database,
    scope: { tenantId: string; sourceModule: string; visitId: string },
): Promise<void> {
    if (!db.inTransaction)
        throw new Error('lockChargeForChange wajib di dalam transaksi.');
    await lockVisit(db, scope.tenantId, scope.visitId);
    const paid = await db.one(
        z.object({
            id: z.string(),
            automatic: z.boolean(),
            legal_entity_id: z.string(),
            number: z.string(),
            date: z.string(),
            value: z.string(),
            registration_number: z.string(),
        }),
        `select k.id, k.otomatis as automatic, k.legal_entity_id, k.no_bukti as number, k.tanggal::text as date,
                trim_scale(k.nilai)::text as value, v.no_reg as registration_number
         from kasir k
         join kunjungan_kasir v on v.tenant_id = k.tenant_id and v.sumber_module = k.sumber_module
                               and v.kunjungan_id = k.kunjungan_id
         where k.tenant_id = $1 and k.sumber_module = $2 and k.kunjungan_id = $3 and k.status = 'diposting'`,
        [scope.tenantId, scope.sourceModule, scope.visitId],
    );
    if (!paid) return;
    if (!paid.automatic) validation({ _form: chargeLockedMessage });
    const stamp = nowSql();
    await db.execute(
        `update kasir set status = 'batal', tgl_batal = $1, alasan_batal = $2,
                          dibatalkan_oleh_user_id = nullif(current_setting('coreerp.user_id', true), '')::uuid,
                          updated_at = $1
         where tenant_id = $3 and id = $4`,
        [stamp, automaticCancelReason, scope.tenantId, paid.id],
    );
    await reopenCancelled(db, {
        tenantId: scope.tenantId,
        legalEntityId: paid.legal_entity_id,
        paymentId: paid.id,
        number: paid.number,
        visitId: scope.visitId,
        registrationNumber: paid.registration_number,
        date: paid.date,
        value: paid.value,
        stamp,
        reason: automaticCancelReason,
    });
}

type Scope = { tenantId: string; legalEntityId: string };

async function legalEntityToday(db: Database, scope: Scope): Promise<string> {
    const today = await db.one(
        z.object({ date: z.string() }),
        `select (now() at time zone l.timezone)::date::text as date
         from legal_entities l where l.tenant_id = $1 and l.organization_id = $2`,
        [scope.tenantId, scope.legalEntityId],
    );
    return today?.date ?? nowSql().slice(0, 10);
}

// Kunjungan yang ditagih beserta baris biaya terbukanya, dikunci untuk Simpan pembayaran: kunci kunjungan lebih dulu,
// lalu baris biayanya, dengan Nilai tagihan rumus kasir Kuta. restricted adalah jenis bayar yang dikhususkan tipe
// pasien lain, dari potret kunjungan selesai.
async function openInvoice(
    db: Database,
    scope: Scope,
    visitId: string,
    precision: Precision,
) {
    await lockVisit(db, scope.tenantId, visitId);
    const visit = await db.one(
        z.object({
            registration_number: z.string(),
            status: z.string(),
            restricted: z.array(z.string()),
        }),
        `select no_reg as registration_number, status, to_json(jenis_bayar_dibatasi) as restricted
         from kunjungan_kasir
         where tenant_id = $1 and legal_entity_id = $2 and sumber_module = $3 and kunjungan_id = $4
           and status in ('selesai', 'dibuka')`,
        [scope.tenantId, scope.legalEntityId, source, visitId],
    );
    if (!visit) return null;
    const paid = await db.one(
        z.object({ id: z.string() }),
        `select id from kasir where tenant_id = $1 and sumber_module = $2 and kunjungan_id = $3
           and status = 'diposting'`,
        [scope.tenantId, source, visitId],
    );
    const charges = await db.rows(
        chargeSchema,
        `select id, jenis_biaya_id, jenis_biaya_nama, dokter_id, dokter_nama, kelompok_jasa_id, kelompok_jasa_nama,
                qty::text, nilai::text, harga_orig::text, disc::text, hext::text
         from kunjungan_kasir_detail
         where tenant_id = $1 and kunjungan_id = $2 and status = 'terbuka' and deleted_at is null
         order by id
         for update`,
        [scope.tenantId, visitId],
    );
    const totals = invoiceTotals(
        charges.map((charge) => ({
            serviceGroupId: charge.kelompok_jasa_id,
            quantity: charge.qty,
            value: charge.nilai,
            originalPrice: charge.harga_orig,
            discountPercent: charge.disc,
            extra: charge.hext,
        })),
        precision,
    );
    return { visit, paid: paid !== undefined, charges, totals };
}

// Satu baris kasir_detail: jumlah dalam mata uang lokal (satuan terkecil), dan jumlah, kurs, serta kurs bawaan dalam
// mata uang jenis bayarnya.
type PostedDetail = {
    methodId: string;
    amount: bigint;
    currency: string;
    currencyAmount: string;
    rate: string;
    defaultRate: string;
    merchant: string | null;
    reference: string | null;
    surchargePercent: string;
    surcharge: bigint;
    party: string | null;
};

const localDetail = (methodId: string, amount: bigint): PostedDetail => ({
    methodId,
    amount,
    currency: localCurrencyCode,
    currencyAmount: fromMinor(amount),
    rate: '1',
    defaultRate: '1',
    merchant: null,
    reference: null,
    surchargePercent: '0',
    surcharge: 0n,
    party: null,
});

// Satu baris tab Diskon yang sudah diperiksa: persen dan nilai dalam mata uang lokal.
type PostedDiscount = {
    discountId: string;
    doctorId: string | null;
    doctorName: string | null;
    procedureId: string | null;
    procedureName: string | null;
    percent: string;
    amount: string;
    note: string | null;
};

const discountSchema = z.object({
    id: z.string(),
    jenis: z.string(),
    komponen_biaya_id: z.string().nullable(),
    kelompok_jasa_id: z.string().nullable(),
});

// Baris tab Diskon sistem lama, diperiksa dan dihitung ulang di server dengan rumus layar yang sama
// (payment.discount.ts). Kesalahan ditulis ke errors per isian baris.
async function checkedDiscounts(
    db: Database,
    scope: Scope,
    input: {
        lines: NonNullable<z.infer<typeof paymentInputSchema>['discounts']>;
        charges: z.infer<typeof chargeSchema>[];
        invoiceValue: string;
        amountDecimals: number;
        errors: Record<string, string>;
    },
): Promise<PostedDiscount[]> {
    if (!input.lines.length) return [];
    const masters = new Map(
        (
            await db.rows(
                discountSchema,
                `select id, jenis, komponen_biaya_id, kelompok_jasa_id from discount
                 where tenant_id = $1 and legal_entity_id = $2 and aktif and deleted_at is null`,
                [scope.tenantId, scope.legalEntityId],
            )
        ).map((discount) => [discount.id, discount]),
    );
    const components = await db.rows(
        z.object({ charge_id: z.string(), id: z.string(), value: z.string() }),
        `select kunjungan_kasir_detail_id as charge_id, komponen_biaya_id as id, nilai::text as value
         from kunjungan_kasir_detail_komponen
         where tenant_id = $1 and kunjungan_kasir_detail_id = any($2::uuid[]) and deleted_at is null`,
        [
            scope.tenantId,
            `{${input.charges.map((charge) => charge.id).join(',')}}`,
        ],
    );
    const charges: DiscountCharge[] = input.charges.map((charge) => ({
        procedureId: charge.jenis_biaya_id,
        doctorId: charge.dokter_id,
        quantity: charge.qty,
        components: components
            .filter((component) => component.charge_id === charge.id)
            .map((component) => ({
                componentId: component.id,
                value: component.value,
            })),
    }));
    const lines: PostedDiscount[] = [];
    input.lines.forEach((line, index) => {
        const field = `discounts.${index}`;
        const master = masters.get(line.discount_id);
        const kind = master?.jenis ?? '';
        if (!master || !isDiscountKind(kind)) {
            input.errors[`${field}.discount_id`] = 'Pilih diskon dari daftar.';
            return;
        }
        const procedureId = line.procedure_id?.trim() || null;
        const doctorId = line.doctor_id?.trim() || null;
        const procedure = input.charges.find(
            (charge) =>
                charge.jenis_biaya_id === procedureId &&
                (kind !== 'kelompok_jasa' ||
                    charge.kelompok_jasa_id === master.kelompok_jasa_id),
        );
        const doctor = input.charges.find(
            (charge) =>
                charge.dokter_id !== null && charge.dokter_id === doctorId,
        );
        if (kind === 'komponen' && !procedureId)
            input.errors[`${field}.procedure_id`] = 'Pilih jasa.';
        else if (procedureId && !procedure)
            input.errors[`${field}.procedure_id`] =
                'Pilih jasa dari rincian biaya kunjungan ini.';
        if (doctorId && !doctor)
            input.errors[`${field}.doctor_id`] =
                'Pilih dokter dari rincian biaya kunjungan ini.';
        const note = line.note?.trim() || null;
        if (note && note.length > 100)
            input.errors[`${field}.note`] =
                'Keterangan paling banyak 100 karakter.';
        const typedPercent =
            line.percent === null || line.percent === undefined
                ? ''
                : String(line.percent).trim();
        const typedAmount =
            line.amount === null || line.amount === undefined
                ? ''
                : String(line.amount).trim();
        const percent = typedPercent ? percentInput(typedPercent) : null;
        const amount = typedAmount
            ? amountInput(typedAmount, input.amountDecimals)
            : null;
        if (typedPercent && percent === null)
            input.errors[`${field}.percent`] = percentHint();
        if (typedAmount && amount === null)
            input.errors[`${field}.amount`] =
                `Isi nilai diskon lebih dari 0, ${decimalsHint(input.amountDecimals)}.`;
        if (!typedPercent && !typedAmount)
            input.errors[`${field}.amount`] = 'Isi persen atau nilai diskon.';
        const base = discountBase(kind, {
            invoiceValue: input.invoiceValue,
            componentId: master.komponen_biaya_id,
            procedureId,
            doctorId,
            charges,
        });
        const computed =
            amount !== null
                ? discountLine(base, { amount }, input.amountDecimals)
                : percent !== null
                  ? discountLine(base, { percent }, input.amountDecimals)
                  : null;
        if (percent !== null && amount === null && base === null)
            input.errors[`${field}.amount`] =
                'Isi nilai diskon. Persen diskon kelompok jasa tidak dihitung.';
        if (
            !computed ||
            input.errors[`${field}.procedure_id`] ||
            input.errors[`${field}.doctor_id`]
        )
            return;
        if (Decimal.of(computed.amount).compare(Decimal.of('0')) <= 0)
            input.errors[`${field}.amount`] =
                'Nilai diskon harus lebih dari 0.';
        else if (base && Decimal.of(computed.amount).compare(base) > 0)
            input.errors[`${field}.amount`] =
                `Nilai diskon melebihi dasarnya, ${base.rounded(input.amountDecimals).normalized()}.`;
        lines.push({
            discountId: master.id,
            doctorId: doctor?.dokter_id ?? null,
            doctorName: doctor?.dokter_nama ?? null,
            procedureId: procedure?.jenis_biaya_id ?? null,
            procedureName: procedure?.jenis_biaya_nama ?? null,
            percent: computed.percent,
            amount: computed.amount,
            note,
        });
    });
    const total = lines.reduce(
        (sum, line) => sum.plus(Decimal.of(line.amount)),
        Decimal.of('0'),
    );
    if (total.compare(Decimal.of(input.invoiceValue)) > 0)
        input.errors._form = 'Jumlah diskon melebihi Nilai tagihan.';
    return lines;
}

// Tagihan dan pembayaran kunjungan: kasir, baris jenis bayar bukan nol, nilai per kelompok jasa, baris biaya ditagih,
// dan event billing.invoice.posted.v1. Dipanggil di dalam transaksi yang sudah membuka tagihannya (openInvoice).
async function postPayment(
    db: Database,
    posting: Scope & {
        visitId: string;
        registrationNumber: string;
        date: string;
        clerkId: string | null;
        userId: string | null;
        automatic: boolean;
        charges: z.infer<typeof chargeSchema>[];
        totals: InvoiceTotals;
        surcharge: bigint;
        received: bigint;
        change: bigint;
        details: PostedDetail[];
        discounts: PostedDiscount[];
    },
): Promise<{ id: string; number: string }> {
    const discount = posting.discounts.reduce(
        (sum, line) => sum + toMinor(line.amount),
        0n,
    );
    const id = Bun.randomUUIDv7();
    const stamp = nowSql();
    const details = posting.details.filter((detail) => detail.amount !== 0n);
    const number = await new NumberIssuer(db, {
        tenantId: posting.tenantId,
        moduleId: 'core',
    }).issue({
        reference: numberReference,
        key: `billing-payment:${id}`,
        documentDate: posting.date,
        legalEntityId: posting.legalEntityId,
    });
    await db.insert('kasir', {
        id,
        tenant_id: posting.tenantId,
        legal_entity_id: posting.legalEntityId,
        no_bukti: number,
        tanggal: posting.date,
        jam: stamp,
        sumber_module: source,
        kunjungan_id: posting.visitId,
        clerk_id: posting.clerkId,
        user_id: posting.userId,
        otomatis: posting.automatic,
        nilai: posting.totals.value,
        nilai_orig: posting.totals.originalValue,
        nilai_discount: fromMinor(discount),
        biaya_tambahan: fromMinor(posting.surcharge),
        jumlah_bayar: fromMinor(posting.received),
        nilai_kembalian: fromMinor(posting.change),
        status: 'diposting',
        created_at: stamp,
        updated_at: stamp,
    });
    for (const detail of details)
        await db.insert('kasir_detail', {
            id: Bun.randomUUIDv7(),
            tenant_id: posting.tenantId,
            kasir_id: id,
            jenis_bayar_id: detail.methodId,
            nilai: fromMinor(detail.amount),
            mata_uang: detail.currency,
            nilai_valuta: detail.currencyAmount,
            kurs: detail.rate,
            kurs_bawaan: detail.defaultRate,
            merchan_id: detail.merchant,
            referensi: detail.reference,
            biaya_tambahan_persen: detail.surchargePercent,
            biaya_tambahan: fromMinor(detail.surcharge),
            pihak_id: detail.party,
            created_at: stamp,
            updated_at: stamp,
        });
    await openReceivables(db, {
        tenantId: posting.tenantId,
        legalEntityId: posting.legalEntityId,
        paymentId: id,
        stamp,
    });
    for (const line of posting.discounts)
        await db.insert('kasir_discount', {
            id: Bun.randomUUIDv7(),
            tenant_id: posting.tenantId,
            kasir_id: id,
            discount_id: line.discountId,
            dokter_id: line.doctorId,
            dokter_nama: line.doctorName,
            jenis_biaya_id: line.procedureId,
            jenis_biaya_nama: line.procedureName,
            persen: line.percent,
            nilai: line.amount,
            keterangan: line.note,
            created_at: stamp,
            updated_at: stamp,
        });
    const groupNames = new Map(
        posting.charges.map((charge) => [
            charge.kelompok_jasa_id,
            charge.kelompok_jasa_nama,
        ]),
    );
    for (const [groupId, value] of posting.totals.groups)
        await db.insert('kasir_detail_group_jasa', {
            id: Bun.randomUUIDv7(),
            tenant_id: posting.tenantId,
            kasir_id: id,
            kelompok_jasa_id: groupId,
            kelompok_jasa_nama: groupNames.get(groupId) ?? null,
            nilai: value,
            created_at: stamp,
            updated_at: stamp,
        });
    if (posting.charges.length)
        await db.execute(
            `update kunjungan_kasir_detail set status = 'ditagih', kasir_id = $1, updated_at = $2
             where tenant_id = $3 and id = any($4::uuid[])`,
            [
                id,
                stamp,
                posting.tenantId,
                `{${posting.charges.map((charge) => charge.id).join(',')}}`,
            ],
        );
    await publishEvent(db, {
        type: invoicePosted,
        tenantId: posting.tenantId,
        legalEntityId: posting.legalEntityId,
        data: {
            payment_id: id,
            payment_number: number,
            source_module: source,
            visit_id: posting.visitId,
            registration_number: posting.registrationNumber,
            date: posting.date,
            value: posting.totals.value,
            discount: fromMinor(discount),
            payments: details.map((detail) => ({
                payment_method_id: detail.methodId,
                amount: fromMinor(detail.amount),
                currency_code: detail.currency,
                currency_amount: detail.currencyAmount,
                exchange_rate: detail.rate,
            })),
        },
    });
    return { id, number };
}

// Bayar otomatis tipe pasien yang lunas otomatis di kasir, padanan bayar otomatis BPJS sistem lama: begitu kunjungan
// selesai, seluruh tagihannya dilunasi dengan jenis bayar otomatis tipe itu, tanpa kasir dan tanpa clerk. Penggunanya
// pengguna yang menyelesaikan kunjungan. Kunjungan yang sudah dibayar dilewati. Jenis bayar yang tidak lagi bisa
// melunasi otomatis (nonaktif, dihapus, atau kini meminta isian kasir) dicatat ke log lalu dilewati, dan kunjungannya
// dibayar di kasir seperti biasa, karena penerima event tidak boleh menggagalkan Selesai periksa.
export async function settleAutomatically(
    db: Database,
    input: Scope & { visitId: string; paymentMethodId: string },
): Promise<void> {
    const precision = await new Currency(db, input.tenantId).precision(
        localCurrencyCode,
    );
    const invoice = await openInvoice(db, input, input.visitId, precision);
    if (invoice?.visit.status !== 'selesai' || invoice.paid) return;
    const method = lookupId(input.paymentMethodId)
        ? await db.one(
              z.object({ id: z.string() }),
              `select id from jenis_bayar
               where tenant_id = $1 and legal_entity_id = $2 and id = $3 and aktif and deleted_at is null
                 and perilaku <> 'tunai' and not wajib_merchan and not wajib_referensi and not biaya_tambahan
                 and pihak <> 'pilih_pihak' and mata_uang is null`,
              [input.tenantId, input.legalEntityId, input.paymentMethodId],
          )
        : undefined;
    if (!method) {
        process.stderr.write(
            JSON.stringify({
                event: 'billing-automatic-payment-skipped',
                tenant_id: input.tenantId,
                visit_id: input.visitId,
                payment_method_id: input.paymentMethodId,
            }) + '\n',
        );
        return;
    }
    const actor = await db.one(
        z.object({ id: z.string().nullable() }),
        "select nullif(current_setting('coreerp.user_id', true), '') as id",
    );
    await postPayment(db, {
        ...input,
        registrationNumber: invoice.visit.registration_number,
        date: await legalEntityToday(db, input),
        clerkId: null,
        userId: actor?.id ?? null,
        automatic: true,
        charges: invoice.charges,
        totals: invoice.totals,
        surcharge: 0n,
        received: 0n,
        change: 0n,
        details: [localDetail(method.id, toMinor(invoice.totals.value))],
        discounts: [],
    });
}

export class Payments {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private get scope() {
        return {
            tenantId: this.workspace.tenantId,
            legalEntityId: activeLegalEntity(this.workspace),
            userId: this.workspace.userId,
        };
    }

    // Simpan pembayaran: tagihan dan pembayaran kunjungan dalam satu transaksi, dengan rumus layar Kuta.
    async create(visitId: string, body: unknown) {
        this.workspace.guard('payment', 'update');
        const scope = this.scope;
        const parsed = paymentInputSchema.safeParse(body);
        if (!parsed.success || !lookupId(visitId))
            validation({ _form: 'Isian pembayaran tidak sah.' });
        const input = parsed.data;
        const posted = await this.db.transaction(async () => {
            const clerk = await openClerk(this.db, scope);
            const currency = new Currency(this.db, scope.tenantId);
            const precision = await currency.precision(localCurrencyCode);
            const amountHint = decimalsHint(precision.amount_decimals);
            const date = await legalEntityToday(this.db, scope);
            const invoice = await openInvoice(
                this.db,
                scope,
                visitId,
                precision,
            );
            if (!invoice) abort(404, 'Not Found');
            if (invoice.visit.status === 'dibuka')
                validation({ _form: reopenedMessage });
            if (invoice.paid)
                coded(409, 'already_paid', 'Kunjungan ini sudah dibayar.');
            const { charges, totals } = invoice;
            const restricted = new Set(invoice.visit.restricted);
            const methods = new Map(
                (
                    await this.db.rows(
                        methodSchema,
                        `select id, perilaku, pihak, wajib_merchan, wajib_referensi, biaya_tambahan, menampung_sisa,
                                aktif, mata_uang
                         from jenis_bayar where tenant_id = $1 and legal_entity_id = $2 and deleted_at is null`,
                        [scope.tenantId, scope.legalEntityId],
                    )
                ).map((method) => [method.id, method]),
            );
            const errors: Record<string, string> = {};
            const received = amountInput(
                input.received ?? 0,
                precision.amount_decimals,
            );
            if (received === null)
                errors.received = `Isi uang diterima 0 atau lebih, ${amountHint}.`;
            const lines = await Promise.all(
                (input.lines ?? []).map(async (line, index) => {
                    const field = `lines.${index}`;
                    const method = methods.get(line.payment_method_id);
                    // Jenis bayar bermata uang asing: jumlah dalam mata uang itu dengan presisinya, dikali kurs.
                    const code = method?.mata_uang ?? null;
                    const decimals = code
                        ? (await currency.precision(code)).amount_decimals
                        : precision.amount_decimals;
                    const amount = amountInput(line.amount, decimals);
                    const surcharge = percentInput(line.surcharge_percent ?? 0);
                    if (
                        !method?.aktif ||
                        (method.perilaku === 'tunai' && !code) ||
                        method.menampung_sisa
                    )
                        errors[`${field}.payment_method_id`] =
                            'Pilih jenis bayar dari daftar.';
                    if (amount === null)
                        errors[`${field}.amount`] =
                            `Isi jumlah 0 atau lebih, ${decimalsHint(decimals)}.`;
                    else if (restricted.has(line.payment_method_id))
                        errors[`${field}.amount`] = patientTypeMessage;
                    const defaultRate = code
                        ? await currency.findRate(code, date)
                        : Decimal.of('1');
                    if (!defaultRate && code)
                        errors[`${field}.amount`] = missingRateMessage(
                            code,
                            date,
                        );
                    const typedRate =
                        code && line.rate !== null && line.rate !== undefined
                            ? String(line.rate).trim()
                            : '';
                    const rateText = typedRate
                        ? amountInput(typedRate, exchangeRateDecimals)
                        : (defaultRate?.normalized() ?? null);
                    const rate =
                        rateText === null ? null : Decimal.of(rateText);
                    if (
                        typedRate &&
                        (rate === null || rate.compare(Decimal.of('0')) <= 0)
                    )
                        errors[`${field}.rate`] =
                            `Isi kurs lebih dari 0, ${decimalsHint(exchangeRateDecimals)}.`;
                    else if (
                        rate &&
                        defaultRate &&
                        rate.compare(defaultRate) !== 0 &&
                        !this.workspace.permissions.has(
                            'core.payment-rate.update',
                        )
                    )
                        errors[`${field}.rate`] =
                            'Kurs hanya bisa diubah oleh pengguna yang berhak mengubah kurs.';
                    if (surcharge === null)
                        errors[`${field}.surcharge_percent`] = percentHint();
                    else if (
                        toMinor(surcharge) !== 0n &&
                        !method?.biaya_tambahan
                    )
                        errors[`${field}.surcharge_percent`] =
                            'Biaya tambahan tidak berlaku untuk jenis bayar ini.';
                    const merchant = line.merchant_id?.trim() || null;
                    if (method?.wajib_merchan && !merchant)
                        errors[`${field}.merchant_id`] = merchantMessage;
                    if (
                        merchant &&
                        !(await this.db.one(
                            z.object({ id: z.string() }),
                            `select id from merchan where tenant_id = $1 and legal_entity_id = $2 and id = $3
                               and aktif and deleted_at is null`,
                            [
                                scope.tenantId,
                                scope.legalEntityId,
                                lookupId(merchant),
                            ],
                        ))
                    )
                        errors[`${field}.merchant_id`] = merchantMessage;
                    const reference = line.reference?.trim() || null;
                    if (method?.wajib_referensi && !reference)
                        errors[`${field}.reference`] =
                            'Isi nomor kartu atau nomor transaksi.';
                    const party = line.party_id?.trim() || null;
                    if (
                        method?.pihak === 'pilih_pihak' &&
                        !(
                            party &&
                            lookupId(party) &&
                            (await this.db.one(
                                z.object({ id: z.string() }),
                                'select id from parties where tenant_id = $1 and id = $2 and deleted_at is null',
                                [scope.tenantId, party],
                            ))
                        )
                    )
                        errors[`${field}.party_id`] = partyMessage;
                    const currencyAmount = amount ?? '0';
                    return {
                        methodId: line.payment_method_id,
                        // Jumlah dalam mata uang lokal.
                        amount:
                            code && rate
                                ? toLocalAmount(
                                      Decimal.of(currencyAmount),
                                      rate,
                                      precision,
                                  ).normalized()
                                : currencyAmount,
                        currency: code ?? localCurrencyCode,
                        currencyAmount,
                        rate: rate?.normalized() ?? '1',
                        defaultRate: defaultRate?.normalized() ?? '1',
                        cash: method?.perilaku === 'tunai',
                        surchargePercent: surcharge ?? '0',
                        merchant,
                        reference,
                        party: method?.pihak === 'pilih_pihak' ? party : null,
                    };
                }),
            );
            const discounts = await checkedDiscounts(this.db, scope, {
                lines: input.discounts ?? [],
                charges,
                invoiceValue: totals.value,
                amountDecimals: precision.amount_decimals,
                errors,
            });
            if (Object.keys(errors).length) validation(errors);
            const amounts = paymentAmounts({
                value: toMinor(totals.value),
                discount: discounts.reduce(
                    (sum, line) => sum + toMinor(line.amount),
                    0n,
                ),
                received: toMinor(received ?? '0'),
                lines: lines.map((line) => ({
                    amount: toMinor(line.amount),
                    surchargePercent: toMinor(line.surchargePercent),
                    cash: line.cash,
                })),
                amountDecimals: precision.amount_decimals,
            });
            const cashMethod = [...methods.values()].find(
                (method) =>
                    method.aktif &&
                    method.perilaku === 'tunai' &&
                    !method.mata_uang,
            );
            const remainderMethod = [...methods.values()].find(
                (method) => method.aktif && method.menampung_sisa,
            );
            if (amounts.cash !== 0n && !cashMethod)
                validation({
                    received: 'Belum ada jenis bayar tunai yang aktif.',
                });
            if (
                amounts.cash !== 0n &&
                cashMethod &&
                restricted.has(cashMethod.id)
            )
                validation({ received: patientTypeMessage });
            if (
                amounts.remainder > 0n &&
                !(input.take_remainder && remainderMethod)
            )
                validation({ _form: remainderMessage });
            if (
                amounts.remainder > 0n &&
                remainderMethod &&
                restricted.has(remainderMethod.id)
            )
                validation({ _form: patientTypeMessage });
            // Tunai lokal bisa negatif: kembalian rupiah untuk tunai valuta yang melebihi tagihan.
            return postPayment(this.db, {
                tenantId: scope.tenantId,
                legalEntityId: scope.legalEntityId,
                visitId,
                registrationNumber: invoice.visit.registration_number,
                date,
                clerkId: clerk.id,
                userId: scope.userId,
                automatic: false,
                charges,
                totals,
                surcharge: amounts.surcharge,
                received: toMinor(received ?? '0'),
                change: amounts.change,
                details: [
                    ...(cashMethod
                        ? [localDetail(cashMethod.id, amounts.cash)]
                        : []),
                    ...lines.map((line, index) => ({
                        methodId: line.methodId,
                        amount: toMinor(line.amount),
                        currency: line.currency,
                        currencyAmount: line.currencyAmount,
                        rate: line.rate,
                        defaultRate: line.defaultRate,
                        merchant: line.merchant,
                        reference: line.reference,
                        surchargePercent: line.surchargePercent,
                        surcharge: amounts.lineSurcharges[index] ?? 0n,
                        party: line.party,
                    })),
                    ...(remainderMethod && amounts.remainder > 0n
                        ? [localDetail(remainderMethod.id, amounts.remainder)]
                        : []),
                ],
                discounts,
            });
        });
        return {
            status: 201,
            headers: {},
            body: {
                data: posted,
                message: 'Item data baru berhasil dibuat!',
            },
        };
    }

    // Batal pembayaran (General_payment::cancel Kuta 1): kunci lebih dulu, lalu persetujuan, lalu satu transaksi yang
    // mengisi TglBatal, BATAL, dan AlasanBatal, membuka lagi baris biaya kunjungan, dan memberi tahu finance. Baris
    // jenis bayar tidak diubah, jadi kurs dan jumlah valutanya tetap seperti saat dibayar.
    async cancel(
        request: Request,
        paymentId: string,
        body: unknown,
        approver: ApproverCheck,
    ) {
        this.workspace.guard('payment', 'update');
        const scope = this.scope;
        const parsed = paymentCancelInputSchema.safeParse(body);
        if (!parsed.success)
            validation({ _form: 'Isian batal pembayaran tidak sah.' });
        const version = expectedVersion(request, body);
        const payment = lookupId(paymentId)
            ? await this.db.one(
                  cancelledPaymentSchema,
                  `select k.id, k.status, c.status as clerk_status
                   from kasir k left join clerk c on c.tenant_id = k.tenant_id and c.id = k.clerk_id
                   where k.tenant_id = $1 and k.legal_entity_id = $2 and k.id = $3`,
                  [scope.tenantId, scope.legalEntityId, paymentId],
              )
            : undefined;
        if (!payment) abort(404, 'Not Found');
        if (payment.status !== 'diposting')
            coded(409, 'payment_cancelled', alreadyCancelledMessage);
        if (payment.clerk_status !== null && payment.clerk_status !== 'start')
            validation({ _form: closedClerkMessage });
        await refuseWhenPaidOff(this.db, {
            tenantId: scope.tenantId,
            paymentId: payment.id,
        });
        const input = parsed.data;
        const reason = input.reason?.trim() ?? '';
        const email = input.approver_email?.trim() ?? '';
        const password = input.approver_password ?? '';
        const errors: Record<string, string> = {};
        if (!email) errors.approver_email = 'Isi username penyetuju.';
        if (!password) errors.approver_password = 'Isi password penyetuju.';
        if (!reason) errors.reason = 'Isi alasan batal.';
        else if (reason.length > 200)
            errors.reason = 'Alasan batal paling banyak 200 karakter.';
        if (Object.keys(errors).length) validation(errors);
        const approverId = await approver.verify(email, password);
        if (
            !approverId ||
            !(
                await Workspace.memberHolds(
                    this.db,
                    { tenantId: scope.tenantId, userId: approverId },
                    [cancelPermission],
                )
            ).has(cancelPermission)
        )
            validation({ approver_password: approvalMessage });
        await this.db.transaction(async () => {
            const stamp = nowSql();
            const header = await this.db.one(
                z.object({
                    clerk_id: z.string().nullable(),
                    visit_id: z.string(),
                    number: z.string(),
                    date: z.string(),
                    value: z.string(),
                    registration_number: z.string(),
                }),
                `select k.clerk_id, k.kunjungan_id as visit_id, k.no_bukti as number,
                        k.tanggal::text as date, trim_scale(k.nilai)::text as value, v.no_reg as registration_number
                 from kasir k
                 join kunjungan_kasir v on v.tenant_id = k.tenant_id and v.sumber_module = k.sumber_module
                                       and v.kunjungan_id = k.kunjungan_id
                 where k.tenant_id = $1 and k.id = $2`,
                [scope.tenantId, payment.id],
            );
            if (!header) abort(404, 'Not Found');
            // Clerk dikunci bersama sebelum kunjungan, urutan yang sama dengan Simpan pembayaran, supaya Clerk End
            // menunggu batal ini selesai.
            const clerk = header.clerk_id
                ? await this.db.one(
                      z.object({ status: z.string() }),
                      'select status from clerk where tenant_id = $1 and id = $2 for share',
                      [scope.tenantId, header.clerk_id],
                  )
                : null;
            if (clerk && clerk.status !== 'start')
                validation({ _form: closedClerkMessage });
            await lockVisit(this.db, scope.tenantId, header.visit_id);
            const cancelled = await this.db.execute(
                `update kasir set status = 'batal', tgl_batal = $1, alasan_batal = $2, dibatalkan_oleh_user_id = $3,
                                  penyetuju_batal_user_id = $4, updated_at = $1
                 where tenant_id = $5 and id = $6 and status = 'diposting' and version = $7`,
                [
                    stamp,
                    reason,
                    scope.userId,
                    approverId,
                    scope.tenantId,
                    payment.id,
                    version,
                ],
            );
            if (!cancelled) coded(409, 'stale_version', staleMessage);
            await reopenCancelled(this.db, {
                tenantId: scope.tenantId,
                legalEntityId: scope.legalEntityId,
                paymentId: payment.id,
                number: header.number,
                visitId: header.visit_id,
                registrationNumber: header.registration_number,
                date: header.date,
                value: header.value,
                stamp,
                reason,
            });
        });
        return {
            data: { id: payment.id },
            message: 'Item data baru berhasil dibatalkan!',
        };
    }
}
