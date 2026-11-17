import { paymentTermsRoutes } from './payment-terms/payment-terms.routes.ts';
import { purchaseInvoiceRoutes } from './purchase-invoice/purchase-invoice.routes.ts';
import { purchaseOrderRoutes } from './purchase-order/purchase-order.routes.ts';
import { purchaseReturnRoutes } from './purchase-return/purchase-return.routes.ts';
import { receiptRoutes } from './receipt/receipt.routes.ts';
import { requisitionRoutes } from './requisition/requisition.routes.ts';
import { vendorLedgerRoutes } from './vendor-ledger/vendor-ledger.routes.ts';
import { vendorPaymentRoutes } from './vendor-payment/vendor-payment.routes.ts';
import { vendorRoutes } from './vendor/vendor.routes.ts';

// Pembelian Core: vendor beserta termin pembayarannya, permintaan pembelian, purchase order, penerimaan barang dari
// vendor, retur ke vendor atas penerimaan itu, faktur pembelian atas barang yang diterima, utang vendor dari faktur yang
// diposting, dan pembayaran ke vendor yang melunasi utang itu. Penerimaan dan retur memposting stok lewat mesin posting
// persediaan (src/foundation/inventory/).
export function purchasingRoutes() {
    return {
        ...vendorRoutes(),
        ...paymentTermsRoutes(),
        ...requisitionRoutes(),
        ...purchaseOrderRoutes(),
        ...receiptRoutes(),
        ...purchaseReturnRoutes(),
        ...purchaseInvoiceRoutes(),
        ...vendorLedgerRoutes(),
        ...vendorPaymentRoutes(),
    };
}
export { purchaseOrderReport } from './purchase-order/purchase-order.report.ts';
export { purchaseReturnReport } from './purchase-return/purchase-return.report.ts';
export { receiptReport } from './receipt/receipt.report.ts';
export { vendorPaymentReport } from './vendor-payment/vendor-payment.report.ts';
