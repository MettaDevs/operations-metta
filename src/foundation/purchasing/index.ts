import { paymentTermsRoutes } from './payment-terms/payment-terms.routes.ts';
import { purchaseOrderRoutes } from './purchase-order/purchase-order.routes.ts';
import { purchaseReturnRoutes } from './purchase-return/purchase-return.routes.ts';
import { receiptRoutes } from './receipt/receipt.routes.ts';
import { requisitionRoutes } from './requisition/requisition.routes.ts';
import { vendorRoutes } from './vendor/vendor.routes.ts';

// Pembelian Core: vendor beserta termin pembayarannya, permintaan pembelian, purchase order, penerimaan barang dari vendor, dan retur ke vendor atas penerimaan itu.
// Penerimaan dan retur memposting stok lewat mesin posting persediaan (src/foundation/inventory/); faktur pembelian
// belum ada.
export function purchasingRoutes() {
    return {
        ...vendorRoutes(),
        ...paymentTermsRoutes(),
        ...requisitionRoutes(),
        ...purchaseOrderRoutes(),
        ...receiptRoutes(),
        ...purchaseReturnRoutes(),
    };
}
export { purchaseOrderReport } from './purchase-order/purchase-order.report.ts';
export { purchaseReturnReport } from './purchase-return/purchase-return.report.ts';
export { receiptReport } from './receipt/receipt.report.ts';
