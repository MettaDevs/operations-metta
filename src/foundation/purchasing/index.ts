import { purchaseReturnRoutes } from './purchase-return/purchase-return.routes.ts';
import { receiptRoutes } from './receipt/receipt.routes.ts';
import { vendorRoutes } from './vendor/vendor.routes.ts';

// Pembelian Core: vendor, penerimaan barang dari vendor, dan retur ke vendor atas penerimaan itu. Keduanya memposting
// stok lewat mesin posting persediaan (src/foundation/inventory/); purchase order dan faktur pembelian belum ada.
export function purchasingRoutes() {
    return { ...vendorRoutes(), ...receiptRoutes(), ...purchaseReturnRoutes() };
}
export { purchaseReturnReport } from './purchase-return/purchase-return.report.ts';
export { receiptReport } from './receipt/receipt.report.ts';
