import { z } from 'zod';
import { coreWorkspace } from '../../../platform/access/index.ts';
import { ok, typedBody, type Context } from '../../../platform/http/index.ts';
import { route } from '../inventory.routes.ts';
import type {
    inventorySetupInputSchema,
    unitSetupInputSchema,
} from './inventory-setup.schema.ts';
import { InventorySetup } from './inventory-setup.service.ts';

async function setup(context: Context, body?: unknown) {
    return new InventorySetup(context.db, await coreWorkspace(context, body));
}

export function inventorySetupRoutes() {
    const path = '/api/v1/inventory/setup';
    return {
        inventorySetupShow: route('GET', path).handler(async ({ context }) =>
            ok(await (await setup(context)).show()),
        ),
        inventorySetupUpdate: route('PUT', path)
            .input(typedBody<z.input<typeof inventorySetupInputSchema>>())
            .handler(async ({ context, input }) =>
                ok(await (await setup(context, input.body)).update(input.body)),
            ),
        inventorySetupUnitList: route('GET', `${path}/operating-units`).handler(
            async ({ context }) => ok(await (await setup(context)).unitList()),
        ),
        inventorySetupUnitUpdate: route('PUT', `${path}/operating-units/{id}`)
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<z.input<typeof unitSetupInputSchema>>(),
                }),
            )
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await setup(context, input.body)
                    ).unitUpdate(input.params.id, input.body),
                ),
            ),
    };
}
