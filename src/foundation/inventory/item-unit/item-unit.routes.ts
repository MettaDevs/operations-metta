import type { z } from 'zod';
import { coreWorkspace } from '../../../platform/access/index.ts';
import {
    ok,
    typedBody,
    typedQuery,
    type Context,
} from '../../../platform/http/index.ts';
import { record, route, searchParams } from '../inventory.routes.ts';
import type {
    itemUnitInputSchema,
    itemUnitListQuerySchema,
} from './item-unit.schema.ts';
import { ItemUnits } from './item-unit.service.ts';

type Input = z.input<typeof itemUnitInputSchema>;

async function itemUnits(context: Context, body?: unknown) {
    return new ItemUnits(context.db, await coreWorkspace(context, body));
}

export function itemUnitRoutes() {
    const path = '/api/v1/inventory/item-units';
    return {
        inventoryItemUnitList: route('GET', path)
            .input(typedQuery<z.input<typeof itemUnitListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await itemUnits(context)
                    ).list(searchParams(context)),
                ),
            ),
        inventoryItemUnitCreate: route('POST', path)
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await itemUnits(context, input.body)).create(input.body),
            ),
        inventoryItemUnitUpdate: route('PATCH', `${path}/{id}`)
            .input(record<Input>())
            .handler(async ({ context, input }) =>
                (await itemUnits(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        inventoryItemUnitDelete: route('DELETE', `${path}/{id}`)
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await itemUnits(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
