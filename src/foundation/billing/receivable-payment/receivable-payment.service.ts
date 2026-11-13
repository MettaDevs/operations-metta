import { z } from 'zod';
import type { Workspace } from '../../../platform/access/index.ts';
import { nowSql, type Database } from '../../../platform/database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '../../../platform/http/index.ts';
import {
    Decimal,
    percentHint,
    percentInput,
} from '../../../platform/money/index.ts';
import {
    amountInput,
    Currency,
    decimalsHint,
    localCurrencyCode,
    roundAmount,
} from '../../currency/index.ts';
import { activeLegalEntity } from '../../inventory/index.ts';
import { NumberIssuer } from '../../number-sequence/index.ts';
import { openClerk } from '../clerk/clerk.service.ts';
import {
    behaviorsSettledAs,
    isPaymentMethodParty,
    type PaymentMethodParty,
} from '../payment-method/payment-method.behaviors.ts';
import {
    receivablePaymentCancelInputSchema,
    receivablePaymentInputSchema,
    receivablePaymentRowSchema,
    receivableRowSchema,
} from './receivable-payment.schema.ts';

// Pesan sistem lama (KC Outstanding_payment dan helper batal pembayaran).
export const outstandingPaymentMessage =
    'Pasien Sudah Melakukan Pembayaran Outstanding, Tidak Dapat Melanjutkan Transaksi';
export const exceedsObligationMessage =
    'Nilai Pembayaran Tidak Boleh lebih besar dari Kewajiban.';
export const incompleteCardMessage =
    'Pembayaran dengan Kartu Kredit diharapkan mengisi Semua Field dengan Benar!';
export const newerPaymentMessage =
    'Tidak bisa membatalkan Transaksi : Sudah ada Transaksi dengan Kwitansi Baru.';
export const closedClerkMessage =
    'Pembayaran hutang ini masuk clerk yang sudah Clerk End, jadi tidak bisa dibatalkan lagi.';
const alreadyCancelledMessage = 'Pembayaran hutang ini sudah dibatalkan.';

const numberReference = 'core.receivable-payment-number';
const zero = Decimal.of('0');

// Pihak piutang menurut pihak jenis bayarnya, dipotret saat bayar. Jenis bayar penjamin pada kunjungan tanpa penjamin,
// dan jenis bayar tanpa pihak, menjadi piutang pasien.
type ReceivableLine = {
    method_party: PaymentMethodParty;
    party_id: string | null;
    party_name: string | null;
    patient_id: string;
    patient_name: string;
    guarantor_id: string | null;
    guarantor_name: string | null;
};
type ReceivableParty = {
    kind: 'pasien' | 'penjamin' | 'pihak';
    id: string | null;
    name: string;
};

function receivableParty(line: ReceivableLine): ReceivableParty {
    const patient: ReceivableParty = {
        kind: 'pasien',
        id: line.patient_id,
        name: line.patient_name,
    };
    switch (line.method_party) {
        case 'tidak':
        case 'pasien':
            return patient;
        case 'penjamin_kunjungan':
            return line.guarantor_id && line.guarantor_name
                ? {
                      kind: 'penjamin',
                      id: line.guarantor_id,
                      name: line.guarantor_name,
                  }
                : patient;
        case 'pilih_pihak':
            // Pembayaran menolak pihak yang tidak ada di buku alamat, jadi namanya selalu ada.
            if (!line.party_name)
                throw new Error('Pihak piutang tidak ada di buku alamat.');
            return { kind: 'pihak', id: line.party_id, name: line.party_name };
        default: {
            const unknown: never = line.method_party;
            throw new Error(`Pihak jenis bayar tidak dikenal: ${unknown}`);
        }
    }
}

// Piutang pembayaran yang baru disimpan: satu entri terbuka per baris jenis bayar berperilaku piutang yang bernilai lebih
// dari 0, dengan sisa sebesar nilainya. Dipanggil di transaksi Simpan pembayaran, termasuk pembayaran otomatis.
export async function openReceivables(
    db: Database,
    payment: {
        tenantId: string;
        legalEntityId: string;
        paymentId: string;
        stamp: string;
    },
): Promise<void> {
    const lines = await db.rows(
        z.object({
            detail_id: z.string(),
            method_id: z.string(),
            amount: z.string(),
            method_party: z.custom<PaymentMethodParty>(
                (value) =>
                    typeof value === 'string' && isPaymentMethodParty(value),
            ),
            party_id: z.string().nullable(),
            party_name: z.string().nullable(),
            patient_id: z.string(),
            patient_name: z.string(),
            guarantor_id: z.string().nullable(),
            guarantor_name: z.string().nullable(),
        }),
        `select d.id as detail_id, d.jenis_bayar_id as method_id, d.nilai::text as amount, j.pihak as method_party,
                d.pihak_id as party_id, p.name as party_name, v.pasien_id as patient_id, v.pasien_nama as patient_name,
                v.penjamin_id as guarantor_id, v.penjamin_nama as guarantor_name
         from kasir_detail d
         join kasir k on k.tenant_id = d.tenant_id and k.id = d.kasir_id
         join jenis_bayar j on j.tenant_id = d.tenant_id and j.id = d.jenis_bayar_id
         join kunjungan_kasir v on v.tenant_id = k.tenant_id and v.sumber_module = k.sumber_module
                               and v.kunjungan_id = k.kunjungan_id
         left join parties p on p.tenant_id = d.tenant_id and p.id = d.pihak_id
         where d.tenant_id = $1 and d.kasir_id = $2 and d.nilai > 0 and j.perilaku = any($3::text[])
         order by d.id`,
        [
            payment.tenantId,
            payment.paymentId,
            `{${behaviorsSettledAs('receivable').join(',')}}`,
        ],
    );
    for (const line of lines) {
        const party = receivableParty(line);
        await db.insert('piutang', {
            id: Bun.randomUUIDv7(),
            tenant_id: payment.tenantId,
            legal_entity_id: payment.legalEntityId,
            kasir_id: payment.paymentId,
            kasir_detail_id: line.detail_id,
            jenis_bayar_id: line.method_id,
            pihak_jenis: party.kind,
            pihak_id: party.id,
            pihak_nama: party.name,
            nilai: line.amount,
            sisa: line.amount,
            status: 'terbuka',
            created_at: payment.stamp,
            updated_at: payment.stamp,
        });
    }
}

// Pembayaran yang piutangnya sudah dilunasi sebagian atau penuh tidak bisa dibatalkan (pesan sistem lama).
export async function refuseWhenPaidOff(
    db: Database,
    payment: { tenantId: string; paymentId: string },
): Promise<void> {
    const found = await db.one(
        z.object({ paid_off: z.boolean() }),
        `select exists (select 1 from pembayaran_outstanding o
                        join piutang r on r.tenant_id = o.tenant_id and r.id = o.piutang_id
                        where r.tenant_id = $1 and r.kasir_id = $2 and o.status = 'diposting') as paid_off`,
        [payment.tenantId, payment.paymentId],
    );
    if (found?.paid_off) validation({ _form: outstandingPaymentMessage });
}

// Batal pembayaran menutup piutangnya. Piutang dikunci lebih dulu, sama dengan Simpan pembayaran hutang, jadi pelunasan
// yang sedang disimpan selesai dulu lalu batal ini menolaknya, atau pelunasan menunggu lalu mendapati piutangnya batal.
export async function cancelReceivables(
    db: Database,
    payment: { tenantId: string; paymentId: string; stamp: string },
): Promise<void> {
    const locked = await db.rows(
        z.object({ id: z.string() }),
        'select id from piutang where tenant_id = $1 and kasir_id = $2 order by id for update',
        [payment.tenantId, payment.paymentId],
    );
    if (!locked.length) return;
    await refuseWhenPaidOff(db, payment);
    await db.execute(
        `update piutang set status = 'batal', updated_at = $1 where tenant_id = $2 and kasir_id = $3`,
        [payment.stamp, payment.tenantId, payment.paymentId],
    );
}

const receivableSql = `select * from (
                           select r.id, k.no_bukti as invoice_number, k.tanggal::text as invoice_date,
                                  v.no_reg as registration_number, v.pasien_nrm as patient_medical_record_number,
                                  v.pasien_nama as patient_name, v.tipe_pasien_nama as patient_type_name,
                                  r.pihak_nama as party_name, coalesce(j.label_kasir, j.nama) as payment_method_name,
                                  trim_scale(r.nilai)::text as amount, trim_scale(r.nilai - r.sisa)::text as paid,
                                  trim_scale(r.sisa)::text as remaining
                           from piutang r
                           join kasir k on k.tenant_id = r.tenant_id and k.id = r.kasir_id
                           join kunjungan_kasir v on v.tenant_id = k.tenant_id and v.sumber_module = k.sumber_module
                                                 and v.kunjungan_id = k.kunjungan_id
                           join jenis_bayar j on j.tenant_id = r.tenant_id and j.id = r.jenis_bayar_id
                           where r.tenant_id = $1 and r.legal_entity_id = $2 and r.status = 'terbuka') receivables
                       where true`;

const paymentSql = `select * from (
                        select o.id, o.no_bukti as number, o.tanggal::text as date, k.no_bukti as invoice_number,
                               k.tanggal::text as invoice_date, v.no_reg as registration_number,
                               v.pasien_nrm as patient_medical_record_number, v.pasien_nama as patient_name,
                               v.tipe_pasien_nama as patient_type_name,
                               coalesce(j.label_kasir, j.nama) as payment_method_name, m.nama as merchant_name,
                               o.referensi as reference, trim_scale(o.biaya_tambahan_persen)::text as surcharge_percent,
                               trim_scale(o.biaya_tambahan)::text as surcharge, trim_scale(o.nilai)::text as amount,
                               trim_scale(r.nilai)::text as receivable_amount,
                               trim_scale(coalesce((select sum(p.nilai) from pembayaran_outstanding p
                                                    where p.tenant_id = o.tenant_id and p.piutang_id = o.piutang_id
                                                      and p.status = 'diposting' and (p.jam, p.id) < (o.jam, o.id)),
                                                   0))::text as previously_paid,
                               u.name as user_name, o.status, o.alasan_batal as cancel_reason, o.version
                        from pembayaran_outstanding o
                        join piutang r on r.tenant_id = o.tenant_id and r.id = o.piutang_id
                        join kasir k on k.tenant_id = r.tenant_id and k.id = r.kasir_id
                        join kunjungan_kasir v on v.tenant_id = k.tenant_id and v.sumber_module = k.sumber_module
                                              and v.kunjungan_id = k.kunjungan_id
                        join jenis_bayar j on j.tenant_id = o.tenant_id and j.id = o.jenis_bayar_id
                        left join merchan m on m.tenant_id = o.tenant_id and m.id = o.merchan_id
                        join users u on u.id = o.user_id
                        where o.tenant_id = $1 and o.legal_entity_id = $2) payments
                    where true`;

// Jenis bayar yang bisa melunasi piutang: uang yang diterima di tempat (tunai atau non tunai) dalam mata uang lokal,
// seperti pilihan Tunai dan Kartu Kredit di form lama.
const payoffMethodSql = `select id, coalesce(label_kasir, nama) as label, wajib_merchan as requires_merchant,
                                wajib_referensi as requires_reference, biaya_tambahan as allows_surcharge
                         from jenis_bayar
                         where tenant_id = $1 and legal_entity_id = $2 and aktif and deleted_at is null
                           and mata_uang is null and perilaku = any($3::text[])`;
const payoffMethodSchema = z.object({
    id: z.string(),
    label: z.string(),
    requires_merchant: z.boolean(),
    requires_reference: z.boolean(),
    allows_surcharge: z.boolean(),
});

export class ReceivablePayments {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    // Dibaca sesudah izin diperiksa, supaya anggota tanpa izin mendapat 403, bukan permintaan memilih legal entity.
    private get scope() {
        return {
            tenantId: this.workspace.tenantId,
            legalEntityId: activeLegalEntity(this.workspace),
            userId: this.workspace.userId,
        };
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

    // Daftar Pembayaran Hutang, terbaru lebih dulu.
    async list(parameters: URLSearchParams) {
        this.workspace.guard('payment', 'read');
        const batch = await incrementalList(this.db, {
            query: paymentSql,
            bindings: [this.scope.tenantId, this.scope.legalEntityId],
            parameters,
            columns: {
                number: 'number',
                date: 'date',
                invoice_number: 'invoice_number',
                patient_name: 'patient_name',
            },
            searchColumns: [
                'number',
                'invoice_number',
                'registration_number',
                'patient_medical_record_number',
                'patient_name',
            ],
            numericColumns: [],
            defaultSort: 'number',
            defaultDirection: 'desc',
        });
        return {
            data: batch.data.map((row) =>
                receivablePaymentRowSchema.parse(row),
            ),
            next_cursor: batch.next_cursor,
            can_pay: this.workspace.permissions.has('core.payment.update'),
        };
    }

    // Lookup Nomor Invoice: piutang terbuka di legal entity aktif.
    async receivables(parameters: URLSearchParams) {
        this.workspace.guard('payment', 'read');
        const batch = await incrementalList(this.db, {
            query: receivableSql,
            bindings: [this.scope.tenantId, this.scope.legalEntityId],
            parameters,
            columns: {
                invoice_number: 'invoice_number',
                invoice_date: 'invoice_date',
                patient_name: 'patient_name',
            },
            searchColumns: [
                'invoice_number',
                'registration_number',
                'patient_medical_record_number',
                'patient_name',
                'party_name',
            ],
            numericColumns: [],
            defaultSort: 'invoice_number',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => receivableRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
        };
    }

    // Pilihan kartu pembayaran hutang: jenis bayar pelunas, merchan aktif, presisi jumlah, dan tanggal hari ini.
    async metadata() {
        this.workspace.guard('payment', 'read');
        const precision = await new Currency(
            this.db,
            this.scope.tenantId,
        ).precision(localCurrencyCode);
        return {
            payment_methods: await this.db.rows(
                payoffMethodSchema,
                `${payoffMethodSql} order by urutan, kode`,
                [
                    this.scope.tenantId,
                    this.scope.legalEntityId,
                    `{${behaviorsSettledAs('received').join(',')}}`,
                ],
            ),
            merchants: await this.db.rows(
                z.object({
                    id: z.string(),
                    code: z.string(),
                    name: z.string(),
                }),
                `select id, kode as code, nama as name from merchan
                 where tenant_id = $1 and legal_entity_id = $2 and aktif and deleted_at is null order by kode`,
                [this.scope.tenantId, this.scope.legalEntityId],
            ),
            amount_decimals: precision.amount_decimals,
            date: await this.today(),
        };
    }

    private async row(id: string) {
        const found = await this.db.one(
            receivablePaymentRowSchema,
            `${paymentSql} and payments.id = $3`,
            [this.scope.tenantId, this.scope.legalEntityId, id],
        );
        if (!found) abort(404, 'Not Found');
        return found;
    }

    // Simpan pembayaran hutang (Outstanding_payment::save): clerk lebih dulu, lalu piutangnya dikunci, seperti Simpan
    // pembayaran. Pelunasan mengurangi sisa piutang; sisa 0 berarti lunas.
    async create(body: unknown) {
        this.workspace.guard('payment', 'update');
        const scope = this.scope;
        const parsed = receivablePaymentInputSchema.safeParse(body);
        if (!parsed.success)
            validation({ _form: 'Isian pembayaran hutang tidak sah.' });
        const input = parsed.data;
        const posted = await this.db.transaction(async () => {
            const clerk = await openClerk(this.db, scope);
            const precision = await new Currency(
                this.db,
                scope.tenantId,
            ).precision(localCurrencyCode);
            const receivable = lookupId(input.receivable_id)
                ? await this.db.one(
                      z.object({ id: z.string(), remaining: z.string() }),
                      `select id, sisa::text as remaining from piutang
                       where tenant_id = $1 and legal_entity_id = $2 and id = $3 and status = 'terbuka'
                       for update`,
                      [
                          scope.tenantId,
                          scope.legalEntityId,
                          input.receivable_id,
                      ],
                  )
                : undefined;
            const method = lookupId(input.payment_method_id)
                ? await this.db.one(
                      payoffMethodSchema,
                      `${payoffMethodSql} and id = $4`,
                      [
                          scope.tenantId,
                          scope.legalEntityId,
                          `{${behaviorsSettledAs('received').join(',')}}`,
                          input.payment_method_id,
                      ],
                  )
                : undefined;
            const errors: Record<string, string> = {};
            if (!receivable)
                errors.receivable_id =
                    'Pilih nomor invoice yang belum lunas dari daftar.';
            if (!method)
                errors.payment_method_id = 'Pilih jenis bayar dari daftar.';
            const amount = amountInput(input.amount, precision.amount_decimals);
            if (amount === null || Decimal.of(amount).compare(zero) <= 0)
                errors.amount = `Isi nilai pembayaran lebih dari 0, ${decimalsHint(precision.amount_decimals)}.`;
            else if (
                receivable &&
                Decimal.of(amount).compare(Decimal.of(receivable.remaining)) > 0
            )
                errors.amount = exceedsObligationMessage;
            const surcharge = percentInput(input.surcharge_percent ?? 0);
            if (surcharge === null) errors.surcharge_percent = percentHint();
            else if (
                Decimal.of(surcharge).compare(zero) !== 0 &&
                !method?.allows_surcharge
            )
                errors.surcharge_percent =
                    'Biaya tambahan tidak berlaku untuk jenis bayar ini.';
            const merchant = input.merchant_id?.trim() || null;
            if (
                (method?.requires_merchant && !merchant) ||
                (merchant &&
                    !(
                        lookupId(merchant) &&
                        (await this.db.one(
                            z.object({ id: z.string() }),
                            `select id from merchan where tenant_id = $1 and legal_entity_id = $2 and id = $3
                               and aktif and deleted_at is null`,
                            [scope.tenantId, scope.legalEntityId, merchant],
                        ))
                    ))
            )
                errors.merchant_id = incompleteCardMessage;
            const reference = input.reference?.trim() || null;
            if (method?.requires_reference && !reference)
                errors.reference = incompleteCardMessage;
            else if (reference && reference.length > 100)
                errors.reference = 'No Kartu paling banyak 100 karakter.';
            if (
                !receivable ||
                !method ||
                amount === null ||
                surcharge === null ||
                Object.keys(errors).length
            )
                validation(errors);
            const id = Bun.randomUUIDv7();
            const stamp = nowSql();
            const date = await this.today();
            const number = await new NumberIssuer(this.db, {
                tenantId: scope.tenantId,
                moduleId: 'core',
            }).issue({
                reference: numberReference,
                key: `billing-receivable-payment:${id}`,
                documentDate: date,
                legalEntityId: scope.legalEntityId,
            });
            await this.db.insert('pembayaran_outstanding', {
                id,
                tenant_id: scope.tenantId,
                legal_entity_id: scope.legalEntityId,
                no_bukti: number,
                tanggal: date,
                jam: stamp,
                piutang_id: receivable.id,
                clerk_id: clerk.id,
                user_id: scope.userId,
                jenis_bayar_id: method.id,
                nilai: amount,
                merchan_id: merchant,
                referensi: reference,
                biaya_tambahan_persen: surcharge,
                biaya_tambahan: roundAmount(
                    Decimal.of(amount)
                        .multipliedBy(Decimal.of(surcharge))
                        .multipliedBy(Decimal.of('0.01')),
                    precision,
                ).normalized(),
                status: 'diposting',
                created_at: stamp,
                updated_at: stamp,
            });
            const remaining = Decimal.of(receivable.remaining).minus(
                Decimal.of(amount),
            );
            await this.db.execute(
                'update piutang set sisa = $1, status = $2, updated_at = $3 where tenant_id = $4 and id = $5',
                [
                    remaining.normalized(),
                    remaining.compare(zero) === 0 ? 'lunas' : 'terbuka',
                    stamp,
                    scope.tenantId,
                    receivable.id,
                ],
            );
            return id;
        });
        return {
            status: 201,
            headers: {},
            body: {
                data: await this.row(posted),
                message: 'Item data baru berhasil dibuat!',
            },
        };
    }

    // Batal pembayaran hutang: clerk-nya masih berjalan, dan belum ada pelunasan lebih baru atas piutang yang sama.
    // Piutang dikunci sebelum diperiksa, jadi pelunasan baru tidak bisa disimpan di tengahnya. Sisa piutang kembali
    // bertambah, dan piutangnya terbuka lagi.
    async cancel(request: Request, id: string, body: unknown) {
        this.workspace.guard('payment', 'update');
        const scope = this.scope;
        const parsed = receivablePaymentCancelInputSchema.safeParse(body);
        if (!parsed.success)
            validation({ _form: 'Isian batal pembayaran hutang tidak sah.' });
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            const owner = lookupId(id)
                ? await this.db.one(
                      z.object({
                          clerk_id: z.string(),
                          receivable_id: z.string(),
                      }),
                      `select clerk_id, piutang_id as receivable_id from pembayaran_outstanding
                       where tenant_id = $1 and legal_entity_id = $2 and id = $3`,
                      [scope.tenantId, scope.legalEntityId, id],
                  )
                : undefined;
            if (!owner) abort(404, 'Not Found');
            const clerk = await this.db.one(
                z.object({ status: z.string() }),
                'select status from clerk where tenant_id = $1 and id = $2 for share',
                [scope.tenantId, owner.clerk_id],
            );
            const receivable = await this.db.one(
                z.object({ remaining: z.string() }),
                'select sisa::text as remaining from piutang where tenant_id = $1 and id = $2 for update',
                [scope.tenantId, owner.receivable_id],
            );
            if (!receivable) abort(404, 'Not Found');
            // Dibaca sesudah piutangnya terkunci, supaya pelunasan dan batal yang baru selesai ikut terlihat.
            const payment = await this.db.one(
                z.object({
                    status: z.string(),
                    amount: z.string(),
                    newer: z.boolean(),
                }),
                `select o.status, o.nilai::text as amount,
                        exists (select 1 from pembayaran_outstanding n
                                where n.tenant_id = o.tenant_id and n.piutang_id = o.piutang_id
                                  and n.status = 'diposting' and (n.jam, n.id) > (o.jam, o.id)) as newer
                 from pembayaran_outstanding o where o.tenant_id = $1 and o.id = $2`,
                [scope.tenantId, id],
            );
            if (!payment) abort(404, 'Not Found');
            if (payment.status !== 'diposting')
                coded(
                    409,
                    'receivable_payment_cancelled',
                    alreadyCancelledMessage,
                );
            if (clerk?.status !== 'start')
                validation({ _form: closedClerkMessage });
            if (payment.newer) validation({ _form: newerPaymentMessage });
            const reason = parsed.data.reason?.trim() ?? '';
            if (!reason) validation({ reason: 'Isi alasan batal.' });
            if (reason.length > 200)
                validation({
                    reason: 'Alasan batal paling banyak 200 karakter.',
                });
            const stamp = nowSql();
            const cancelled = await this.db.execute(
                `update pembayaran_outstanding
                 set status = 'batal', tgl_batal = $1, alasan_batal = $2, dibatalkan_oleh_user_id = $3, updated_at = $1
                 where tenant_id = $4 and id = $5 and status = 'diposting' and version = $6`,
                [stamp, reason, scope.userId, scope.tenantId, id, version],
            );
            if (!cancelled) coded(409, 'stale_version', staleMessage);
            await this.db.execute(
                `update piutang set sisa = $1, status = 'terbuka', updated_at = $2
                 where tenant_id = $3 and id = $4`,
                [
                    Decimal.of(receivable.remaining)
                        .plus(Decimal.of(payment.amount))
                        .normalized(),
                    stamp,
                    scope.tenantId,
                    owner.receivable_id,
                ],
            );
        });
        return {
            data: await this.row(id),
            message: 'Item data baru berhasil dibatalkan!',
        };
    }
}
