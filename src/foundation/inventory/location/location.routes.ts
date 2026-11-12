import { masterRoutes } from '../inventory.routes.ts';
import { locationInputSchema } from './location.schema.ts';
import { Locations } from './location.service.ts';

export function locationRoutes() {
    const routes = masterRoutes(
        '/api/v1/inventory/locations',
        locationInputSchema,
        (db, workspace) => new Locations(db, workspace),
    );
    return {
        inventoryLocationList: routes.list,
        inventoryLocationCreate: routes.create,
        inventoryLocationUpdate: routes.update,
        inventoryLocationDelete: routes.delete,
    };
}
