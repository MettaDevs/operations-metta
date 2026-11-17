import { z } from 'zod';
import { coreWorkspace } from '../../../platform/access/index.ts';
import {
    base,
    ok,
    typedBody,
    typedQuery,
    type Context,
} from '../../../platform/http/index.ts';
import type {
    carryOutInputSchema,
    requisitionInputSchema,
    requisitionListQuerySchema,
} from './requisition.schema.ts';
import { PurchaseRequisitions } from './requisition.service.ts';

type Input = z.input<typeof requisitionInputSchema>;
const record = <T>() =>
    z.object({ params: z.object({ id: z.string() }), body: z.custom<T>() });

async function requisitions(context: Context, body?: unknown) {
    return new PurchaseRequisitions(
        context.db,
        await coreWorkspace(context, body),
    );
}

export function requisitionRoutes() {
    const path = '/api/v1/purchasing/requisitions';
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        purchasingRequisitionList: route('GET')
            .input(typedQuery<z.input<typeof requisitionListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await requisitions(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        purchasingRequisitionShow: route('GET', '/{id}')
            .input(z.object({ params: z.object({ id: z.string() }) }))
            .handler(async ({ context, input }) =>
                ok(await (await requisitions(context)).show(input.params.id)),
            ),
        purchasingRequisitionCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await requisitions(context, input.body)).create(input.body),
            ),
        purchasingRequisitionUpdate: route('PATCH', '/{id}')
            .input(record<Input>())
            .handler(async ({ context, input }) =>
                (await requisitions(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        purchasingRequisitionDelete: route('DELETE', '/{id}')
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await requisitions(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        purchasingRequisitionCarryOut: route('POST', '/carry-out')
            .input(typedBody<z.input<typeof carryOutInputSchema>>())
            .handler(async ({ context, input }) =>
                (await requisitions(context, input.body)).carryOut(input.body),
            ),
    };
}
