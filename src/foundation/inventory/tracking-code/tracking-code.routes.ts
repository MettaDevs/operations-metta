import { masterRoutes } from '../inventory.routes.ts';
import { trackingCodeInputSchema } from './tracking-code.schema.ts';
import { TrackingCodes } from './tracking-code.service.ts';

export function trackingCodeRoutes() {
    const routes = masterRoutes(
        '/api/v1/inventory/item-tracking-codes',
        trackingCodeInputSchema,
        (db, workspace) => new TrackingCodes(db, workspace),
    );
    return {
        inventoryTrackingCodeList: routes.list,
        inventoryTrackingCodeCreate: routes.create,
        inventoryTrackingCodeUpdate: routes.update,
        inventoryTrackingCodeDelete: routes.delete,
    };
}
