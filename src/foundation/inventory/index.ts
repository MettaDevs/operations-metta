import { adjustmentRoutes } from './adjustment/adjustment.routes.ts';
import { codeListRoutes } from './code-list/code-list.routes.ts';
import { inventoryPeriodRoutes } from './inventory-period/inventory-period.routes.ts';
import { itemCategoryRoutes } from './item-category/item-category.routes.ts';
import { itemLedgerRoutes } from './item-ledger/item-ledger.routes.ts';
import { itemUnitRoutes } from './item-unit/item-unit.routes.ts';
import { itemRoutes } from './item/item.routes.ts';
import { locationRoutes } from './location/location.routes.ts';
import { inventorySetupRoutes } from './setup/inventory-setup.routes.ts';
import { stockByLocationRoutes } from './stock-by-location/stock-by-location.routes.ts';
import { stockCountRoutes } from './stock-count/stock-count.routes.ts';
import { stockkeepingUnitRoutes } from './stockkeeping-unit/stockkeeping-unit.routes.ts';
import { trackingCodeRoutes } from './tracking-code/tracking-code.routes.ts';
import { transferOrderRoutes } from './transfer/transfer-order.routes.ts';

// Persediaan Core, pola Business Central: master per legal entity, satu kartu gudang dengan sisa per baris, dan satu
// mesin posting. Module yang menggerakkan stok (farmasi, penerimaan, mutasi) memanggil postItemLines di dalam transaksi
// dokumennya sendiri dan reverseItemEntries untuk membatalkan posting dokumen itu; module tidak menulis tabel gd_*.
// Keduanya menolak tanggal di periode persediaan yang sudah ditutup (Inventory Period di BC), dengan 422 `_form` yang
// menyebut periodenya, jadi setiap pemanggil mendapat aturan dan pesan yang sama tanpa memeriksanya sendiri.
// Module yang memperluas barang (pola table extension BC, misalnya obat layanan kesehatan) menulis barangnya lewat
// createItem, updateItem, dan deleteItem di transaksi yang sama dengan baris perluasannya.
export { activeLegalEntity, exists, parseInput } from './inventory.service.ts';
export { type Funding } from './item-ledger/allocation.ts';
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
export {
    issuedSlices,
    openStock,
    type IssuedSlice,
    type StockBatch,
} from './item-ledger/source-entries.ts';
export {
    defaultUnit,
    itemUnits,
    unitConversion,
    type ItemUnitOption,
    type UnitUse,
} from './item-unit/item-unit.service.ts';
export {
    createItem,
    deleteItem,
    raiseBasePrices,
    updateItem,
    type ItemInput,
    type ItemScope,
} from './item/item.service.ts';
export {
    baseQuantity,
    decimalInput,
    fromNumeric,
    quantityHint,
    quantityScale,
    toNumeric,
    unitCostInput,
} from './quantity.ts';

export function inventoryRoutes() {
    return {
        ...inventorySetupRoutes(),
        ...inventoryPeriodRoutes(),
        ...locationRoutes(),
        ...codeListRoutes(),
        ...trackingCodeRoutes(),
        ...itemCategoryRoutes(),
        ...itemRoutes(),
        ...itemUnitRoutes(),
        ...adjustmentRoutes(),
        ...itemLedgerRoutes(),
        ...transferOrderRoutes(),
        ...stockCountRoutes(),
        ...stockkeepingUnitRoutes(),
        ...stockByLocationRoutes(),
    };
}
