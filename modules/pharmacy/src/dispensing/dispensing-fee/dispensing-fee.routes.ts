import { z } from 'zod';
import {
    base,
    type listParametersSchema,
    ok,
    typedBody,
    typedQuery,
    type Context,
} from '@core/platform/http/index.ts';
import { moduleId, moduleWorkspace } from '../../module.ts';
import type { dispensingFeeInputSchema } from './dispensing-fee.schema.ts';
import { DispensingFees } from './dispensing-fee.service.ts';

type Input = z.input<typeof dispensingFeeInputSchema>;
type ListQuery = z.input<typeof listParametersSchema>;

async function dispensingFees(context: Context, body?: unknown) {
    return new DispensingFees(context.db, await moduleWorkspace(context, body));
}

// Pilihan lokasi dan kelompok harga setelan ini memakai /lookups/locations dan /lookups/price-groups.
export function dispensingFeeRoutes() {
    const root: `/${string}` = `/api/modules/${moduleId}/v1`;
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string) =>
        base.route({
            method,
            path: `${root}${path}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        pharmacyDispensingFeeList: route('GET', '/dispensing-fees')
            .input(typedQuery<ListQuery>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await dispensingFees(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        pharmacyDispensingFeeCreate: route('POST', '/dispensing-fees')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await dispensingFees(context, input.body)).create(input.body),
            ),
        pharmacyDispensingFeeUpdate: route('PATCH', '/dispensing-fees/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<Input & { version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await dispensingFees(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        pharmacyDispensingFeeDelete: route('DELETE', '/dispensing-fees/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<{ version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await dispensingFees(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
