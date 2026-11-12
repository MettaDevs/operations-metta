import { z } from 'zod';
import { coreWorkspace } from '../../../platform/access/index.ts';
import { ok } from '../../../platform/http/index.ts';
import { masterRoutes, route } from '../inventory.routes.ts';
import { itemInputSchema } from './item.schema.ts';
import { Items } from './item.service.ts';

export function itemRoutes() {
    const path = '/api/v1/inventory/items';
    const routes = masterRoutes(
        path,
        itemInputSchema,
        (db, workspace) => new Items(db, workspace),
    );
    return {
        inventoryItemList: routes.list,
        inventoryItemCreate: routes.create,
        inventoryItemUpdate: routes.update,
        inventoryItemDelete: routes.delete,
        inventoryItemBatches: route('GET', `${path}/{id}/batches`)
            .input(z.object({ params: z.object({ id: z.string() }) }))
            .handler(async ({ context, input }) =>
                ok(
                    await new Items(
                        context.db,
                        await coreWorkspace(context),
                    ).batches(input.params.id),
                ),
            ),
    };
}
