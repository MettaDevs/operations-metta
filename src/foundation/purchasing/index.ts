import { receiptRoutes } from './receipt/receipt.routes.ts';
import { vendorRoutes } from './vendor/vendor.routes.ts';

// Pembelian Core: vendor dan penerimaan barang dari vendor. Penerimaan memposting stok masuk lewat mesin posting
// persediaan (src/foundation/inventory/); purchase order dan faktur pembelian belum ada.
export function purchasingRoutes() {
    return { ...vendorRoutes(), ...receiptRoutes() };
}
