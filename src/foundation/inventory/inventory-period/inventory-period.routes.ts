import { coreWorkspace } from '../../../platform/access/index.ts';
import type { Context } from '../../../platform/http/index.ts';
import { masterRoutes, record, route } from '../inventory.routes.ts';
import { inventoryPeriodInputSchema } from './inventory-period.schema.ts';
import { InventoryPeriods } from './inventory-period.service.ts';

async function periods(context: Context, body?: unknown) {
    return new InventoryPeriods(context.db, await coreWorkspace(context, body));
}

export function inventoryPeriodRoutes() {
    const path = '/api/v1/inventory/periods';
    const routes = masterRoutes(
        path,
        inventoryPeriodInputSchema,
        (db, workspace) => new InventoryPeriods(db, workspace),
    );
    return {
        inventoryPeriodList: routes.list,
        inventoryPeriodCreate: routes.create,
        inventoryPeriodUpdate: routes.update,
        inventoryPeriodDelete: routes.delete,
        inventoryPeriodClose: route('POST', `${path}/{id}/close`)
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await periods(context, input.body)).close(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        inventoryPeriodReopen: route('POST', `${path}/{id}/reopen`)
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await periods(context, input.body)).reopen(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
