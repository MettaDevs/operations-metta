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
    vendorInputSchema,
    vendorListQuerySchema,
} from './vendor.schema.ts';
import { Vendors } from './vendor.service.ts';

type Input = z.input<typeof vendorInputSchema>;

async function vendors(context: Context, body?: unknown) {
    return new Vendors(context.db, await coreWorkspace(context, body));
}

export function vendorRoutes() {
    const path = '/api/v1/purchasing/vendors';
    const route = (method: 'GET' | 'POST' | 'PATCH', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        purchasingVendorList: route('GET')
            .input(typedQuery<z.input<typeof vendorListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await vendors(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        purchasingVendorCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await vendors(context, input.body)).create(input.body),
            ),
        purchasingVendorUpdate: route('PATCH', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<Input>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await vendors(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
