import { z } from 'zod';
import { base, ok, type Context } from '@core/platform/http/index.ts';
import { moduleId, moduleWorkspace } from '../../module.ts';
import type {
    returnInputSchema,
    returnReverseInputSchema,
} from './dispensing-return.schema.ts';
import { DispensingReturns } from './dispensing-return.service.ts';

async function returns(context: Context, body?: unknown) {
    return new DispensingReturns(
        context.db,
        await moduleWorkspace(context, body),
    );
}

// Retur obat dibuka dari resepnya, seperti penyerahannya.
export function dispensingReturnRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/prescriptions/{id}/returns`;
    const route = (method: 'GET' | 'POST', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        pharmacyReturnList: route('GET')
            .input(z.object({ params: z.object({ id: z.string() }) }))
            .handler(async ({ context, input }) =>
                ok(await (await returns(context)).show(input.params.id)),
            ),
        pharmacyReturnCreate: route('POST')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<z.input<typeof returnInputSchema>>(),
                }),
            )
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await returns(context, input.body)
                    ).create(input.params.id, input.body),
                ),
            ),
        pharmacyReturnReverse: route('POST', '/{returnId}/reverse')
            .input(
                z.object({
                    params: z.object({ id: z.string(), returnId: z.string() }),
                    body: z.custom<z.input<typeof returnReverseInputSchema>>(),
                }),
            )
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await returns(context, input.body)
                    ).reverse(
                        input.params.id,
                        input.params.returnId,
                        input.body,
                    ),
                ),
            ),
    };
}
