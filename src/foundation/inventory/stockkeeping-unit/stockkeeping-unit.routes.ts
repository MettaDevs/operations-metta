import { masterRoutes } from '../inventory.routes.ts';
import {
    stockkeepingUnitInputSchema,
    stockkeepingUnitListQuerySchema,
} from './stockkeeping-unit.schema.ts';
import { StockkeepingUnits } from './stockkeeping-unit.service.ts';

export function stockkeepingUnitRoutes() {
    const routes = masterRoutes(
        '/api/v1/inventory/stockkeeping-units',
        stockkeepingUnitInputSchema,
        (db, workspace) => new StockkeepingUnits(db, workspace),
        stockkeepingUnitListQuerySchema,
    );
    return {
        inventoryStockkeepingUnitList: routes.list,
        inventoryStockkeepingUnitCreate: routes.create,
        inventoryStockkeepingUnitUpdate: routes.update,
        inventoryStockkeepingUnitDelete: routes.delete,
    };
}
