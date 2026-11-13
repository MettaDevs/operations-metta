import { z } from 'zod';
import { coreWorkspace } from '../../../platform/access/index.ts';
import {
    base,
    ok,
    typedQuery,
    type Context,
} from '../../../platform/http/index.ts';
import type { visitListQuerySchema } from './invoice.schema.ts';
import { Invoices } from './invoice.service.ts';

const route = (suffix = '') =>
    base.route({
        method: 'GET',
        path: `/api/v1/billing/visits${suffix}`,
        inputStructure: 'detailed',
        outputStructure: 'detailed',
    });

async function invoices(context: Context) {
    return new Invoices(context.db, await coreWorkspace(context));
}

export function invoiceRoutes() {
    return {
        billingVisitList: route()
            .input(typedQuery<z.input<typeof visitListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await invoices(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        billingVisitShow: route('/{id}')
            .input(z.object({ params: z.object({ id: z.string() }) }))
            .handler(async ({ context, input }) =>
                ok(await (await invoices(context)).show(input.params.id)),
            ),
    };
}
