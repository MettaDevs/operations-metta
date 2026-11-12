import { adjustmentRoutes } from './adjustment/adjustment.routes.ts';
import { codeListRoutes } from './code-list/code-list.routes.ts';
import { itemCategoryRoutes } from './item-category/item-category.routes.ts';
import { itemLedgerRoutes } from './item-ledger/item-ledger.routes.ts';
import { itemRoutes } from './item/item.routes.ts';
import { locationRoutes } from './location/location.routes.ts';
import { inventorySetupRoutes } from './setup/inventory-setup.routes.ts';
import { trackingCodeRoutes } from './tracking-code/tracking-code.routes.ts';

// Persediaan Core, pola Business Central: master per legal entity, satu kartu gudang dengan sisa per baris, dan satu
// mesin posting. Module yang menggerakkan stok (farmasi, penerimaan, mutasi) memanggil postItemLines di dalam transaksi
// dokumennya sendiri dan reverseItemEntries untuk membatalkan posting dokumen itu; module tidak menulis tabel gd_*.
export {
    entryKinds,
    postItemLines,
    reverseItemEntries,
    type EntryKind,
    type InboundLine,
    type ItemLine,
    type OutboundLine,
    type PostingContext,
    type TransferLine,
} from './item-ledger/item-ledger.posting.ts';

export function inventoryRoutes() {
    return {
        ...inventorySetupRoutes(),
        ...locationRoutes(),
        ...codeListRoutes(),
        ...trackingCodeRoutes(),
        ...itemCategoryRoutes(),
        ...itemRoutes(),
        ...adjustmentRoutes(),
        ...itemLedgerRoutes(),
    };
}
