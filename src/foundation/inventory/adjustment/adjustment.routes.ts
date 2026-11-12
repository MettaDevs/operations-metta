import { z } from 'zod';
import { coreWorkspace } from '../../../platform/access/index.ts';
import { ok, type Context } from '../../../platform/http/index.ts';
import { masterRoutes, record, route } from '../inventory.routes.ts';
import {
    adjustmentInputSchema,
    adjustmentListQuerySchema,
} from './adjustment.schema.ts';
import { Adjustments } from './adjustment.service.ts';

async function adjustments(context: Context, body?: unknown) {
    return new Adjustments(context.db, await coreWorkspace(context, body));
}

export function adjustmentRoutes() {
    const path = '/api/v1/inventory/adjustments';
    const routes = masterRoutes(
        path,
        adjustmentInputSchema,
        (db, workspace) => new Adjustments(db, workspace),
        adjustmentListQuerySchema,
    );
    return {
        inventoryAdjustmentList: routes.list,
        inventoryAdjustmentCreate: routes.create,
        inventoryAdjustmentUpdate: routes.update,
        inventoryAdjustmentDelete: routes.delete,
        inventoryAdjustmentShow: route('GET', `${path}/{id}`)
            .input(z.object({ params: z.object({ id: z.string() }) }))
            .handler(async ({ context, input }) =>
                ok(await (await adjustments(context)).show(input.params.id)),
            ),
        inventoryAdjustmentEntries: route('GET', `${path}/{id}/entries`)
            .input(z.object({ params: z.object({ id: z.string() }) }))
            .handler(async ({ context, input }) =>
                ok(await (await adjustments(context)).entries(input.params.id)),
            ),
        inventoryAdjustmentPost: route('POST', `${path}/{id}/post`)
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await adjustments(context, input.body)).post(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        inventoryAdjustmentReverse: route('POST', `${path}/{id}/reverse`)
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await adjustments(context, input.body)).reverse(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
