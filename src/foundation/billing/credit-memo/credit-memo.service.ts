import { z } from 'zod';
import type { Workspace } from '../../../platform/access/index.ts';
import { nowSql, type Database } from '../../../platform/database/index.ts';
import { publishEvent } from '../../../platform/events/index.ts';
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
import { openClerk } from '../clerk/clerk.service.ts';
import { behaviorsSettledAs } from '../payment-method/payment-method.behaviors.ts';
import { paymentCancelInputSchema } from '../payment/payment.schema.ts';
import {
    approval,
    legalEntityToday,
    lockVisit,
    paymentStatusSchema,
    refuseUnlessPosted,
    reopenCharges,
    type ApproverCheck,
} from '../payment/payment.service.ts';
import {
    cancelReceivables,
    refuseWhenPaidOff,
} from '../receivable-payment/receivable-payment.service.ts';

// Nota kredit kasir, pola BC Sales Credit Memo (CorrectPostedSalesInvoice / Cancel) dan Refund: pembayaran yang clerk-nya
// sudah Clerk End dibalik seluruhnya di clerk kasir yang sedang berjalan. Uang yang diterima (tunai dan non tunai)
// dikembalikan lewat jenis bayar yang sama dengan jumlah, valuta, dan kurs saat dibayar; piutangnya dibatalkan; baris
// biaya kunjungan kembali terbuka, jadi kunjungannya bisa dibayar lagi dengan nomor baru. Selama clerk pembayaran itu
// masih berjalan, koreksinya Batal pembayaran.

export const creditMemoPosted = 'billing.credit-memo.posted.v1' as const;
export const openClerkPaymentMessage =
    'Pembayaran ini masih di clerk yang berjalan. Batalkan pembayarannya saja.';
export const automaticPaymentMessage =
    'Pembayaran ini lunas otomatis tanpa clerk. Batalkan pembayarannya saja.';

const numberReference = 'core.credit-memo-number';

const refundSchema = z.object({
    payment_method_id: z.string(),
    label: z.string(),
    amount: z.string(),
    currency_code: z.string(),
    currency_amount: z.string(),
    exchange_rate: z.string(),
    merchant_id: z.string().nullable(),
    reference: z.string().nullable(),
});

// Baris pengembalian nota kredit: setiap baris pembayaran yang jenis bayarnya berperilaku uang diterima, apa adanya.
// Tunai lokal tersimpan bersih (uang diterima dikurangi kembalian), jadi yang dikembalikan uang yang tinggal di laci.
async function refunds(
    db: Database,
    payment: { tenantId: string; paymentId: string },
) {
    return db.rows(
        refundSchema,
        `select d.jenis_bayar_id as payment_method_id, coalesce(j.label_kasir, j.nama) as label,
                trim_scale(d.nilai)::text as amount, d.mata_uang as currency_code,
                trim_scale(d.nilai_valuta)::text as currency_amount, trim_scale(d.kurs)::text as exchange_rate,
                d.merchan_id as merchant_id, d.referensi as reference
         from kasir_detail d join jenis_bayar j on j.tenant_id = d.tenant_id and j.id = d.jenis_bayar_id
         where d.tenant_id = $1 and d.kasir_id = $2 and j.perilaku = any($3::text[])
         order by j.urutan, j.kode`,
        [
            payment.tenantId,
            payment.paymentId,
            `{${behaviorsSettledAs('received').join(',')}}`,
        ],
    );
}

// Isi nota kredit sebelum diproses, untuk modal Nota Kredit: uang yang dikembalikan per jenis bayar dan piutang yang
// dibatalkan.
export async function creditMemoPreview(
    db: Database,
    payment: { tenantId: string; paymentId: string },
) {
    return {
        refunds: (await refunds(db, payment)).map((refund) => ({
            label: refund.label,
            amount: refund.amount,
            currency_code: refund.currency_code,
            currency_amount: refund.currency_amount,
        })),
        receivables: await db.rows(
            z.object({
                label: z.string(),
                party_name: z.string(),
                amount: z.string(),
            }),
            `select coalesce(j.label_kasir, j.nama) as label, r.pihak_nama as party_name,
                    trim_scale(r.nilai)::text as amount
             from piutang r join jenis_bayar j on j.tenant_id = r.tenant_id and j.id = r.jenis_bayar_id
             where r.tenant_id = $1 and r.kasir_id = $2 and r.status <> 'batal'
             order by j.urutan, j.kode`,
            [payment.tenantId, payment.paymentId],
        ),
    };
}

export class CreditMemos {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    // Penolakan dibaca lebih dulu, lalu persetujuan, lalu satu transaksi dengan urutan kunci yang sama dengan Batal
    // pembayaran: clerk kasir yang berjalan, kunjungan, pembayaran, lalu piutangnya.
    async post(
        request: Request,
        paymentId: string,
        body: unknown,
        approver: ApproverCheck,
    ) {
        this.workspace.guard('payment', 'update');
        const scope = {
            tenantId: this.workspace.tenantId,
            legalEntityId: activeLegalEntity(this.workspace),
            userId: this.workspace.userId,
        };
        const parsed = paymentCancelInputSchema.safeParse(body);
        if (!parsed.success)
            validation({ _form: 'Isian nota kredit tidak sah.' });
        const version = expectedVersion(request, body);
        const payment = lookupId(paymentId)
            ? await this.db.one(
                  z.object({
                      id: z.string(),
                      status: paymentStatusSchema,
                      automatic: z.boolean(),
                      clerk_status: z.string().nullable(),
                  }),
                  `select k.id, k.status, k.otomatis as automatic, c.status as clerk_status
                   from kasir k left join clerk c on c.tenant_id = k.tenant_id and c.id = k.clerk_id
                   where k.tenant_id = $1 and k.legal_entity_id = $2 and k.id = $3`,
                  [scope.tenantId, scope.legalEntityId, paymentId],
              )
            : undefined;
        if (!payment) abort(404, 'Not Found');
        refuseUnlessPosted(payment.status);
        if (payment.automatic) validation({ _form: automaticPaymentMessage });
        // Clerk End tidak bisa diulang atau dibatalkan, jadi clerk yang sudah berakhir di sini tetap berakhir.
        if (payment.clerk_status === 'start')
            validation({ _form: openClerkPaymentMessage });
        await refuseWhenPaidOff(this.db, {
            tenantId: scope.tenantId,
            paymentId: payment.id,
        });
        const { approverId, reason } = await approval(
            this.db,
            scope.tenantId,
            parsed.data,
            approver,
            'koreksi',
        );
        const posted = await this.db.transaction(async () => {
            const clerk = await openClerk(this.db, scope);
            const header = await this.db.one(
                z.object({
                    visit_id: z.string(),
                    source_module: z.string(),
                    number: z.string(),
                    value: z.string(),
                    discount: z.string(),
                    registration_number: z.string(),
                }),
                `select k.kunjungan_id as visit_id, k.sumber_module as source_module, k.no_bukti as number,
                        trim_scale(k.nilai)::text as value, trim_scale(k.nilai_discount)::text as discount,
                        v.no_reg as registration_number
                 from kasir k
                 join kunjungan_kasir v on v.tenant_id = k.tenant_id and v.sumber_module = k.sumber_module
                                       and v.kunjungan_id = k.kunjungan_id
                 where k.tenant_id = $1 and k.id = $2`,
                [scope.tenantId, payment.id],
            );
            if (!header) abort(404, 'Not Found');
            await lockVisit(this.db, scope.tenantId, header.visit_id);
            const stamp = nowSql();
            const credited = await this.db.execute(
                `update kasir set status = 'dikreditkan', updated_at = $1
                 where tenant_id = $2 and id = $3 and status = 'diposting' and version = $4`,
                [stamp, scope.tenantId, payment.id, version],
            );
            if (!credited) coded(409, 'stale_version', staleMessage);
            const corrected = {
                tenantId: scope.tenantId,
                paymentId: payment.id,
                stamp,
            };
            const cancelledReceivables = await cancelReceivables(
                this.db,
                corrected,
            );
            await reopenCharges(this.db, corrected);
            const lines = await refunds(this.db, corrected);
            const id = Bun.randomUUIDv7();
            const date = await legalEntityToday(this.db, scope);
            const number = await new NumberIssuer(this.db, {
                tenantId: scope.tenantId,
                moduleId: 'core',
            }).issue({
                reference: numberReference,
                key: `billing-credit-memo:${id}`,
                documentDate: date,
                legalEntityId: scope.legalEntityId,
            });
            await this.db.insert('nota_kredit', {
                id,
                tenant_id: scope.tenantId,
                legal_entity_id: scope.legalEntityId,
                no_bukti: number,
                tanggal: date,
                jam: stamp,
                kasir_id: payment.id,
                clerk_id: clerk.id,
                user_id: scope.userId,
                penyetuju_user_id: approverId,
                alasan: reason,
                nilai: header.value,
                nilai_discount: header.discount,
                created_at: stamp,
                updated_at: stamp,
            });
            for (const line of lines)
                await this.db.insert('nota_kredit_detail', {
                    id: Bun.randomUUIDv7(),
                    tenant_id: scope.tenantId,
                    nota_kredit_id: id,
                    jenis_bayar_id: line.payment_method_id,
                    nilai: line.amount,
                    mata_uang: line.currency_code,
                    nilai_valuta: line.currency_amount,
                    kurs: line.exchange_rate,
                    merchan_id: line.merchant_id,
                    referensi: line.reference,
                    created_at: stamp,
                    updated_at: stamp,
                });
            await publishEvent(this.db, {
                type: creditMemoPosted,
                tenantId: scope.tenantId,
                legalEntityId: scope.legalEntityId,
                data: {
                    credit_memo_id: id,
                    credit_memo_number: number,
                    payment_id: payment.id,
                    payment_number: header.number,
                    source_module: header.source_module,
                    visit_id: header.visit_id,
                    registration_number: header.registration_number,
                    date,
                    value: header.value,
                    discount: header.discount,
                    reason,
                    refunds: lines.map((line) => ({
                        payment_method_id: line.payment_method_id,
                        amount: line.amount,
                        currency_code: line.currency_code,
                        currency_amount: line.currency_amount,
                        exchange_rate: line.exchange_rate,
                    })),
                    cancelled_receivable_ids: cancelledReceivables,
                },
            });
            return { id, number };
        });
        return {
            status: 201,
            headers: {},
            body: {
                data: posted,
                message: `Nota kredit ${posted.number} tersimpan. Kunjungan ini kembali belum dibayar.`,
            },
        };
    }
}
