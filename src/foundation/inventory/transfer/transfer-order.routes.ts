import { z } from 'zod';
import { coreWorkspace } from '../../../platform/access/index.ts';
import {
    ok,
    typedBody,
    typedQuery,
    type Context,
} from '../../../platform/http/index.ts';
import { record, route, searchParams } from '../inventory.routes.ts';
import {
    PostedTransfers,
    type PostedTransferKind,
} from './posted-transfer.service.ts';
import type {
    postedTransferListQuerySchema,
    transferOrderInputSchema,
    transferOrderListQuerySchema,
    transferPostingInputSchema,
    transferQuantitiesInputSchema,
} from './transfer-order.schema.ts';
import { TransferOrders } from './transfer-order.service.ts';

type Input = z.input<typeof transferOrderInputSchema>;
type Posting = z.input<typeof transferPostingInputSchema>;
const showInput = z.object({ params: z.object({ id: z.string() }) });

async function orders(context: Context, body?: unknown) {
    return new TransferOrders(context.db, await coreWorkspace(context, body));
}

function postedRoutes(kind: PostedTransferKind, path: `/${string}`) {
    const service = async (context: Context, body?: unknown) =>
        new PostedTransfers(
            context.db,
            await coreWorkspace(context, body),
            kind,
        );
    return {
        list: route('GET', path)
            .input(typedQuery<z.input<typeof postedTransferListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(await (await service(context)).list(searchParams(context))),
            ),
        show: route('GET', `${path}/{id}`)
            .input(showInput)
            .handler(async ({ context, input }) =>
                ok(await (await service(context)).show(input.params.id)),
            ),
        reverse: route('POST', `${path}/{id}/reverse`)
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await service(context, input.body)).reverse(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}

export function transferOrderRoutes() {
    const path = '/api/v1/inventory/transfer-orders';
    const shipments = postedRoutes(
        'shipment',
        '/api/v1/inventory/transfer-shipments',
    );
    const receipts = postedRoutes(
        'receipt',
        '/api/v1/inventory/transfer-receipts',
    );
    return {
        inventoryTransferOrderList: route('GET', path)
            .input(typedQuery<z.input<typeof transferOrderListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(await (await orders(context)).list(searchParams(context))),
            ),
        inventoryTransferOrderShow: route('GET', `${path}/{id}`)
            .input(showInput)
            .handler(async ({ context, input }) =>
                ok(await (await orders(context)).show(input.params.id)),
            ),
        inventoryTransferOrderCreate: route('POST', path)
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await orders(context, input.body)).create(input.body),
            ),
        inventoryTransferOrderUpdate: route('PATCH', `${path}/{id}`)
            .input(record<Input>())
            .handler(async ({ context, input }) =>
                (await orders(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        inventoryTransferOrderDelete: route('DELETE', `${path}/{id}`)
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await orders(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        inventoryTransferOrderSubmit: route('POST', `${path}/{id}/submit`)
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await orders(context, input.body)).submit(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        inventoryTransferOrderQuantities: route(
            'PATCH',
            `${path}/{id}/quantities`,
        )
            .input(record<z.input<typeof transferQuantitiesInputSchema>>())
            .handler(async ({ context, input }) =>
                (await orders(context, input.body)).quantities(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        inventoryTransferOrderShip: route('POST', `${path}/{id}/ship`)
            .input(record<Posting>())
            .handler(async ({ context, input }) =>
                (await orders(context, input.body)).ship(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        inventoryTransferOrderReceive: route('POST', `${path}/{id}/receive`)
            .input(record<Posting>())
            .handler(async ({ context, input }) =>
                (await orders(context, input.body)).receive(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        inventoryTransferOrderClose: route('POST', `${path}/{id}/close`)
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await orders(context, input.body)).close(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        inventoryTransferOrderCancel: route('POST', `${path}/{id}/cancel`)
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await orders(context, input.body)).cancel(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        inventoryTransferShipmentList: shipments.list,
        inventoryTransferShipmentShow: shipments.show,
        inventoryTransferShipmentReverse: shipments.reverse,
        inventoryTransferReceiptList: receipts.list,
        inventoryTransferReceiptShow: receipts.show,
        inventoryTransferReceiptReverse: receipts.reverse,
    };
}
