import { z } from 'zod';
import { coreWorkspace } from '../../../platform/access/index.ts';
import {
    base,
    ok,
    typedBody,
    typedQuery,
    type Context,
} from '../../../platform/http/index.ts';
import { PurchaseOrderPosting } from './purchase-order-post.service.ts';
import type {
    purchaseOrderInputSchema,
    purchaseOrderListQuerySchema,
    purchaseOrderPostInputSchema,
    purchaseOrderPostingInputSchema,
} from './purchase-order.schema.ts';
import { PurchaseOrders } from './purchase-order.service.ts';

type Input = z.input<typeof purchaseOrderInputSchema>;
type PostInput = z.input<typeof purchaseOrderPostInputSchema>;
type PostingInput = z.input<typeof purchaseOrderPostingInputSchema>;
const record = <T>() =>
    z.object({ params: z.object({ id: z.string() }), body: z.custom<T>() });

async function orders(context: Context, body?: unknown) {
    return new PurchaseOrders(context.db, await coreWorkspace(context, body));
}

export function purchaseOrderRoutes() {
    const path = '/api/v1/purchasing/orders';
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        purchasingOrderList: route('GET')
            .input(typedQuery<z.input<typeof purchaseOrderListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await orders(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        purchasingOrderShow: route('GET', '/{id}')
            .input(z.object({ params: z.object({ id: z.string() }) }))
            .handler(async ({ context, input }) =>
                ok(await (await orders(context)).show(input.params.id)),
            ),
        purchasingOrderCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await orders(context, input.body)).create(input.body),
            ),
        purchasingOrderUpdate: route('PATCH', '/{id}')
            .input(record<Input>())
            .handler(async ({ context, input }) =>
                (await orders(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        purchasingOrderDelete: route('DELETE', '/{id}')
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await orders(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        purchasingOrderRelease: route('POST', '/{id}/release')
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await orders(context, input.body)).release(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        purchasingOrderReopen: route('POST', '/{id}/reopen')
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await orders(context, input.body)).reopen(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        purchasingOrderPostingUpdate: route('PATCH', '/{id}/posting')
            .input(record<PostingInput>())
            .handler(async ({ context, input }) =>
                new PurchaseOrderPosting(
                    context.db,
                    await coreWorkspace(context, input.body),
                ).save(context.request, input.params.id, input.body),
            ),
        purchasingOrderPost: route('POST', '/{id}/post')
            .input(record<PostInput>())
            .handler(async ({ context, input }) =>
                new PurchaseOrderPosting(
                    context.db,
                    await coreWorkspace(context, input.body),
                ).post(context.request, input.params.id, input.body),
            ),
    };
}
