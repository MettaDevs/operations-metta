import { z } from 'zod';
import { base, ok, type Context } from '@core/platform/http/index.ts';
import { moduleId, moduleWorkspace } from '../../module.ts';
import type {
    returnInputSchema,
    returnReverseInputSchema,
} from './dispensing-return.schema.ts';
import { DispensingReturns } from './dispensing-return.service.ts';
import type { ReturnSourceKind } from './dispensing-return.source.ts';

// Retur obat dibuka dari dokumennya: resep, seperti penyerahannya, atau penjualan obat bebas.
function returnRoutes(kind: ReturnSourceKind, path: `/${string}`) {
    const route = (method: 'GET' | 'POST', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    const returns = async (context: Context, id: string, body?: unknown) =>
        new DispensingReturns(
            context.db,
            await moduleWorkspace(context, body),
            { kind, id },
        );
    return {
        list: route('GET')
            .input(z.object({ params: z.object({ id: z.string() }) }))
            .handler(async ({ context, input }) =>
                ok(await (await returns(context, input.params.id)).show()),
            ),
        create: route('POST')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<z.input<typeof returnInputSchema>>(),
                }),
            )
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await returns(context, input.params.id, input.body)
                    ).create(input.body),
                ),
            ),
        reverse: route('POST', '/{returnId}/reverse')
            .input(
                z.object({
                    params: z.object({ id: z.string(), returnId: z.string() }),
                    body: z.custom<z.input<typeof returnReverseInputSchema>>(),
                }),
            )
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await returns(context, input.params.id, input.body)
                    ).reverse(input.params.returnId, input.body),
                ),
            ),
    };
}

export function dispensingReturnRoutes() {
    const prescription = returnRoutes(
        'prescription',
        `/api/modules/${moduleId}/v1/prescriptions/{id}/returns`,
    );
    const sale = returnRoutes(
        'otc-sale',
        `/api/modules/${moduleId}/v1/otc-sales/{id}/returns`,
    );
    return {
        pharmacyReturnList: prescription.list,
        pharmacyReturnCreate: prescription.create,
        pharmacyReturnReverse: prescription.reverse,
        pharmacyOtcSaleReturnList: sale.list,
        pharmacyOtcSaleReturnCreate: sale.create,
        pharmacyOtcSaleReturnReverse: sale.reverse,
    };
}
