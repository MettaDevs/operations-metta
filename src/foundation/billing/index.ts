import { onEvent } from '../../platform/events/index.ts';
import {
    chargesReplaced,
    pharmacyChargesReplaced,
    receiveCharges,
    receivePharmacyCharges,
    receiveVisitCancelled,
    receiveVisitCompleted,
    receiveVisitReopened,
    visitCancelled,
    visitCompleted,
    visitReopened,
} from './charge/charge.events.ts';
export {
    replaceSaleBill,
    type ChargeFee,
    type ChargeGroup,
    type SaleBill,
} from './charge/charge.events.ts';
// Total tagihan dengan rumus kasir, supaya module penjual menampilkan total yang sama dengan yang ditagih payBill.
export { invoiceTotals } from './invoice/invoice.totals.ts';
export { paymentOptions } from './invoice/invoice.service.ts';
import { clerkRoutes } from './clerk/clerk.routes.ts';
import { creditMemoRoutes } from './credit-memo/credit-memo.routes.ts';
import { invoiceRoutes } from './invoice/invoice.routes.ts';
import { paymentRoutes } from './payment/payment.routes.ts';
import { discountRoutes } from './discount/discount.routes.ts';
import { merchantRoutes } from './merchant/merchant.routes.ts';
import { paymentMethodRoutes } from './payment-method/payment-method.routes.ts';
import { receivablePaymentRoutes } from './receivable-payment/receivable-payment.routes.ts';
import { billingSetupRoutes } from './setup/billing-setup.routes.ts';

// Kasir Core: jenis bayar (mJenisBayar sistem lama) dengan perilaku dari katalog di kode, merchan (SIMmMerchan), dan
// clerk (SIMtrClerk), sesi kas kasir dari Clerk Start sampai Clerk End. Layarnya membentuk aplikasi Kasir di katalog
// aplikasi, terpisah dari Sys Admin (src/platform/access/navigation.ts). Pembayaran memanggil paymentClerk sebelum
// menyimpan, sehingga kasir yang belum Clerk Start ditolak dengan pesan sistem lama, kecuali legal entity-nya tidak
// mewajibkan clerk (Setelan kasir).
export { clerkNotStartedMessage, paymentClerk } from './clerk/clerk.service.ts';
export {
    automaticCancelReason,
    chargeLockedMessage,
    closedClerkMessage,
    lockChargeForChange,
    paidDocuments,
    patientTypeMessage,
    payBill,
    receivableBuyerMessage,
} from './payment/payment.service.ts';
export {
    automaticPaymentMessage,
    openClerkPaymentMessage,
    unclerkedPaymentMessage,
} from './credit-memo/credit-memo.service.ts';
export { outstandingPaymentMessage } from './receivable-payment/receivable-payment.service.ts';
// Dokumen cetak milik kasir, dirakit src/main.ts ke katalog laporan.
export { paymentReceiptReport } from './payment/payment-receipt.report.ts';
export {
    onBeforePayment,
    onPaymentHolds,
    type PaymentCheck,
    type PaymentHolds,
} from './payment/payment.checks.ts';

let registered = false;

// Dipanggil src/main.ts dan src/worker.ts. Biaya pemeriksaan dan kunjungan selesai dari layanan kesehatan masuk kasir
// lewat event (tagihan_kasir_detail, tagihan_kasir).
export function registerBillingEventHandlers(): void {
    if (registered) return;
    registered = true;
    onEvent(chargesReplaced, 'core', receiveCharges);
    onEvent(visitCompleted, 'core', receiveVisitCompleted);
    onEvent(visitCancelled, 'core', receiveVisitCancelled);
    onEvent(visitReopened, 'core', receiveVisitReopened);
    onEvent(pharmacyChargesReplaced, 'core', receivePharmacyCharges);
}

export function billingRoutes() {
    return {
        ...paymentMethodRoutes(),
        ...merchantRoutes(),
        ...discountRoutes(),
        ...billingSetupRoutes(),
        ...clerkRoutes(),
        ...invoiceRoutes(),
        ...paymentRoutes(),
        ...creditMemoRoutes(),
        ...receivablePaymentRoutes(),
    };
}
