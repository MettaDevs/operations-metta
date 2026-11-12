import type { z } from 'zod';
import { coreWorkspace } from '../../../platform/access/index.ts';
import {
    ok,
    typedQuery,
    type listParametersSchema,
} from '../../../platform/http/index.ts';
import { masterRoutes, route, searchParams } from '../inventory.routes.ts';
import {
    locationInputSchema,
    locationListQuerySchema,
} from './location.schema.ts';
import { Locations } from './location.service.ts';

export function locationRoutes() {
    const path = '/api/v1/inventory/locations';
    const routes = masterRoutes(
        path,
        locationInputSchema,
        (db, workspace) => new Locations(db, workspace),
        locationListQuerySchema,
    );
    return {
        inventoryLocationList: routes.list,
        inventoryLocationCreate: routes.create,
        inventoryLocationUpdate: routes.update,
        inventoryLocationDelete: routes.delete,
        inventoryLocationOperatingUnits: route('GET', `${path}/operating-units`)
            .input(typedQuery<z.input<typeof listParametersSchema>>())
            .handler(async ({ context }) =>
                ok(
                    await new Locations(
                        context.db,
                        await coreWorkspace(context),
                    ).operatingUnits(searchParams(context)),
                ),
            ),
    };
}
