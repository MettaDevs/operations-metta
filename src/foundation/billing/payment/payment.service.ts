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
} from '../../currency/index.ts';
import { openClerk } from '../clerk/clerk.service.ts';
import { invoiceTotals } from '../invoice/invoice.totals.ts';
import {
    paymentCancelInputSchema,
    paymentInputSchema,
} from './payment.schema.ts';
import { fromMinor, paymentAmounts, toMinor } from './payment.amounts.ts';

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
    clerk_status: z.string(),
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

// Dipanggil module sumber di dalam transaksi yang mengubah atau membatalkan biaya kunjungan (Biaya Tindakan, batal
// kunjungan). Kunjungan yang sudah dibayar ditolak dengan pesan sistem lama.
export async function lockChargeForChange(
    db: Database,
    scope: { tenantId: string; sourceModule: string; visitId: string },
): Promise<void> {
    if (!db.inTransaction)
        throw new Error('lockChargeForChange wajib di dalam transaksi.');
    await lockVisit(db, scope.tenantId, scope.visitId);
    const paid = await db.one(
        z.object({ id: z.string() }),
        `select id from kasir
         where tenant_id = $1 and sumber_module = $2 and kunjungan_id = $3 and status = 'diposting'`,
        [scope.tenantId, scope.sourceModule, scope.visitId],
    );
    if (paid) validation({ _form: chargeLockedMessage });
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
        const id = Bun.randomUUIDv7();
        const posted = await this.db.transaction(async () => {
            const clerk = await openClerk(this.db, scope);
            const currency = new Currency(this.db, scope.tenantId);
            const precision = await currency.precision(localCurrencyCode);
            const amountHint = decimalsHint(precision.amount_decimals);
            const stamp = nowSql();
            const today = await this.db.one(
                z.object({ date: z.string() }),
                `select (now() at time zone l.timezone)::date::text as date
                 from legal_entities l where l.tenant_id = $1 and l.organization_id = $2`,
                [scope.tenantId, scope.legalEntityId],
            );
            const date = today?.date ?? stamp.slice(0, 10);
            await lockVisit(this.db, scope.tenantId, visitId);
            const visit = await this.db.one(
                z.object({
                    registration_number: z.string(),
                    status: z.string(),
                }),
                `select no_reg as registration_number, status from kunjungan_kasir
                 where tenant_id = $1 and legal_entity_id = $2 and sumber_module = $3 and kunjungan_id = $4
                   and status in ('selesai', 'dibuka')`,
                [scope.tenantId, scope.legalEntityId, source, visitId],
            );
            if (!visit) abort(404, 'Not Found');
            if (visit.status === 'dibuka')
                validation({ _form: reopenedMessage });
            const already = await this.db.one(
                z.object({ id: z.string() }),
                `select id from kasir where tenant_id = $1 and sumber_module = $2 and kunjungan_id = $3
                   and status = 'diposting'`,
                [scope.tenantId, source, visitId],
            );
            if (already)
                coded(409, 'already_paid', 'Kunjungan ini sudah dibayar.');
            const charges = await this.db.rows(
                chargeSchema,
                `select id, kelompok_jasa_id, kelompok_jasa_nama, qty::text, nilai::text, harga_orig::text,
                        disc::text, hext::text
                 from kunjungan_kasir_detail
                 where tenant_id = $1 and sumber_module = $2 and kunjungan_id = $3 and status = 'terbuka'
                   and deleted_at is null
                 order by id
                 for update`,
                [scope.tenantId, source, visitId],
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
                    if (method?.pihak === 'pilih_pihak' && !party)
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
            if (Object.keys(errors).length) validation(errors);
            const amounts = paymentAmounts({
                value: toMinor(totals.value),
                discount: 0n,
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
                amounts.remainder > 0n &&
                !(input.take_remainder && remainderMethod)
            )
                validation({ _form: remainderMessage });
            const number = await new NumberIssuer(this.db, {
                tenantId: scope.tenantId,
                moduleId: 'core',
            }).issue({
                reference: numberReference,
                key: `billing-payment:${id}`,
                documentDate: date,
                legalEntityId: scope.legalEntityId,
            });
            await this.db.insert('kasir', {
                id,
                tenant_id: scope.tenantId,
                legal_entity_id: scope.legalEntityId,
                no_bukti: number,
                tanggal: date,
                jam: stamp,
                sumber_module: source,
                kunjungan_id: visitId,
                clerk_id: clerk.id,
                user_id: scope.userId,
                nilai: totals.value,
                nilai_orig: totals.originalValue,
                nilai_discount: '0',
                biaya_tambahan: fromMinor(amounts.surcharge),
                jumlah_bayar: fromMinor(toMinor(received ?? '0')),
                nilai_kembalian: fromMinor(amounts.change),
                status: 'diposting',
                created_at: stamp,
                updated_at: stamp,
            });
            // Tunai lokal bisa negatif: kembalian rupiah untuk tunai valuta yang melebihi tagihan.
            const details = [
                ...(cashMethod && amounts.cash !== 0n
                    ? [{ methodId: cashMethod.id, amount: amounts.cash }]
                    : []),
                ...lines.map((line, index) => ({
                    ...line,
                    methodId: line.methodId,
                    amount: toMinor(line.amount),
                    surcharge: amounts.lineSurcharges[index] ?? 0n,
                })),
                ...(remainderMethod && amounts.remainder > 0n
                    ? [
                          {
                              methodId: remainderMethod.id,
                              amount: amounts.remainder,
                          },
                      ]
                    : []),
            ].filter((detail) => detail.amount !== 0n);
            const exchanged = (detail: (typeof details)[number]) =>
                'currency' in detail
                    ? {
                          currency: detail.currency,
                          currencyAmount: detail.currencyAmount,
                          rate: detail.rate,
                          defaultRate: detail.defaultRate,
                      }
                    : {
                          currency: localCurrencyCode,
                          currencyAmount: fromMinor(detail.amount),
                          rate: '1',
                          defaultRate: '1',
                      };
            for (const detail of details)
                await this.db.insert('kasir_detail', {
                    id: Bun.randomUUIDv7(),
                    tenant_id: scope.tenantId,
                    kasir_id: id,
                    jenis_bayar_id: detail.methodId,
                    nilai: fromMinor(detail.amount),
                    mata_uang: exchanged(detail).currency,
                    nilai_valuta: exchanged(detail).currencyAmount,
                    kurs: exchanged(detail).rate,
                    kurs_bawaan: exchanged(detail).defaultRate,
                    merchan_id: 'merchant' in detail ? detail.merchant : null,
                    referensi: 'reference' in detail ? detail.reference : null,
                    biaya_tambahan_persen:
                        'surchargePercent' in detail
                            ? detail.surchargePercent
                            : '0',
                    biaya_tambahan:
                        'surcharge' in detail
                            ? fromMinor(detail.surcharge)
                            : '0',
                    pihak_id: 'party' in detail ? detail.party : null,
                    created_at: stamp,
                    updated_at: stamp,
                });
            const groupNames = new Map(
                charges.map((charge) => [
                    charge.kelompok_jasa_id,
                    charge.kelompok_jasa_nama,
                ]),
            );
            for (const [groupId, value] of totals.groups)
                await this.db.insert('kasir_detail_group_jasa', {
                    id: Bun.randomUUIDv7(),
                    tenant_id: scope.tenantId,
                    kasir_id: id,
                    kelompok_jasa_id: groupId,
                    kelompok_jasa_nama: groupNames.get(groupId) ?? null,
                    nilai: value,
                    created_at: stamp,
                    updated_at: stamp,
                });
            if (charges.length)
                await this.db.execute(
                    `update kunjungan_kasir_detail set status = 'ditagih', kasir_id = $1, updated_at = $2
                     where tenant_id = $3 and id = any($4::uuid[])`,
                    [
                        id,
                        stamp,
                        scope.tenantId,
                        `{${charges.map((charge) => charge.id).join(',')}}`,
                    ],
                );
            await publishEvent(this.db, {
                type: invoicePosted,
                tenantId: scope.tenantId,
                legalEntityId: scope.legalEntityId,
                data: {
                    payment_id: id,
                    payment_number: number,
                    source_module: source,
                    visit_id: visitId,
                    registration_number: visit.registration_number,
                    date,
                    value: totals.value,
                    payments: details.map((detail) => ({
                        payment_method_id: detail.methodId,
                        amount: fromMinor(detail.amount),
                        currency_code: exchanged(detail).currency,
                        currency_amount: exchanged(detail).currencyAmount,
                        exchange_rate: exchanged(detail).rate,
                    })),
                },
            });
            return number;
        });
        return {
            status: 201,
            headers: {},
            body: {
                data: { id, number: posted },
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
                   from kasir k join clerk c on c.tenant_id = k.tenant_id and c.id = k.clerk_id
                   where k.tenant_id = $1 and k.legal_entity_id = $2 and k.id = $3`,
                  [scope.tenantId, scope.legalEntityId, paymentId],
              )
            : undefined;
        if (!payment) abort(404, 'Not Found');
        if (payment.status !== 'diposting')
            coded(409, 'payment_cancelled', alreadyCancelledMessage);
        if (payment.clerk_status !== 'start')
            validation({ _form: closedClerkMessage });
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
                    clerk_status: z.string(),
                    visit_id: z.string(),
                    number: z.string(),
                    date: z.string(),
                    value: z.string(),
                    registration_number: z.string(),
                }),
                `select c.status as clerk_status, k.kunjungan_id as visit_id, k.no_bukti as number,
                        k.tanggal::text as date, trim_scale(k.nilai)::text as value, v.no_reg as registration_number
                 from kasir k
                 join clerk c on c.tenant_id = k.tenant_id and c.id = k.clerk_id
                 join kunjungan_kasir v on v.tenant_id = k.tenant_id and v.sumber_module = k.sumber_module
                                       and v.kunjungan_id = k.kunjungan_id
                 where k.tenant_id = $1 and k.id = $2
                 for share of c`,
                [scope.tenantId, payment.id],
            );
            if (!header) abort(404, 'Not Found');
            if (header.clerk_status !== 'start')
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
            await this.db.execute(
                `update kunjungan_kasir_detail set status = 'terbuka', kasir_id = null, updated_at = $1
                 where tenant_id = $2 and kasir_id = $3`,
                [stamp, scope.tenantId, payment.id],
            );
            const lines = await this.db.rows(
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
                [scope.tenantId, payment.id],
            );
            await publishEvent(this.db, {
                type: invoiceCancelled,
                tenantId: scope.tenantId,
                legalEntityId: scope.legalEntityId,
                data: {
                    payment_id: payment.id,
                    payment_number: header.number,
                    source_module: source,
                    visit_id: header.visit_id,
                    registration_number: header.registration_number,
                    date: header.date,
                    value: header.value,
                    cancelled_at: `${stamp.replace(' ', 'T')}Z`,
                    reason,
                    payments: lines,
                },
            });
        });
        return {
            data: { id: payment.id },
            message: 'Item data baru berhasil dibatalkan!',
        };
    }
}
