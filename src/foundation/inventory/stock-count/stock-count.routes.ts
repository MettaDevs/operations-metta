import { z } from 'zod';
import { coreWorkspace } from '../../../platform/access/index.ts';
import {
    ok,
    typedBody,
    typedQuery,
    type Context,
} from '../../../platform/http/index.ts';
import { record, route, searchParams } from '../inventory.routes.ts';
import type {
    stockCountCalculationSchema,
    stockCountInputSchema,
    stockCountListQuerySchema,
    stockCountPostingInputSchema,
    stockCountPreviewQuerySchema,
} from './stock-count.schema.ts';
import { StockCounts } from './stock-count.service.ts';

type Input = z.input<typeof stockCountInputSchema>;
type Versioned = { version: number };
const showInput = z.object({ params: z.object({ id: z.string() }) });

async function counts(context: Context, body?: unknown) {
    return new StockCounts(context.db, await coreWorkspace(context, body));
}

export function stockCountRoutes() {
    const path = '/api/v1/inventory/stock-counts';
    const command = (
        action: 'finish' | 'reopen' | 'cancel' | 'reverse',
        handle: (
            service: StockCounts,
            request: Request,
            id: string,
            body: Versioned,
        ) => ReturnType<StockCounts['finish']>,
    ) =>
        route('POST', `${path}/{id}/${action}`)
            .input(record<Versioned>())
            .handler(async ({ context, input }) =>
                handle(
                    await counts(context, input.body),
                    context.request,
                    input.params.id,
                    input.body,
                ),
            );
    return {
        inventoryStockCountList: route('GET', path)
            .input(typedQuery<z.input<typeof stockCountListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(await (await counts(context)).list(searchParams(context))),
            ),
        inventoryStockCountShow: route('GET', `${path}/{id}`)
            .input(showInput)
            .handler(async ({ context, input }) =>
                ok(await (await counts(context)).show(input.params.id)),
            ),
        inventoryStockCountCreate: route('POST', path)
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await counts(context, input.body)).create(input.body),
            ),
        inventoryStockCountUpdate: route('PATCH', `${path}/{id}`)
            .input(record<Input>())
            .handler(async ({ context, input }) =>
                (await counts(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        inventoryStockCountCalculateLines: route(
            'POST',
            `${path}/calculate-lines`,
        )
            .input(typedBody<z.input<typeof stockCountCalculationSchema>>())
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await counts(context, input.body)
                    ).calculateLines(input.body),
                ),
            ),
        inventoryStockCountPreview: route('GET', `${path}/{id}/posting-preview`)
            .input(
                showInput.extend({
                    query: z.custom<
                        z.input<typeof stockCountPreviewQuerySchema>
                    >(),
                }),
            )
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await counts(context)
                    ).preview(input.params.id, searchParams(context)),
                ),
            ),
        inventoryStockCountFinish: command('finish', (service, ...args) =>
            service.finish(...args),
        ),
        inventoryStockCountReopen: command('reopen', (service, ...args) =>
            service.reopen(...args),
        ),
        inventoryStockCountCancel: command('cancel', (service, ...args) =>
            service.cancel(...args),
        ),
        inventoryStockCountReverse: command('reverse', (service, ...args) =>
            service.reverse(...args),
        ),
        inventoryStockCountPost: route('POST', `${path}/{id}/post`)
            .input(record<z.input<typeof stockCountPostingInputSchema>>())
            .handler(async ({ context, input }) =>
                (await counts(context, input.body)).post(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
