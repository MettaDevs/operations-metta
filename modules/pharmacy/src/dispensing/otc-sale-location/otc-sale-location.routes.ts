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
import type { otcSaleLocationInputSchema } from './otc-sale-location.schema.ts';
import { OtcSaleLocations } from './otc-sale-location.service.ts';

type Input = z.input<typeof otcSaleLocationInputSchema>;
type ListQuery = z.input<typeof listParametersSchema>;

async function otcSaleLocations(context: Context, body?: unknown) {
    return new OtcSaleLocations(
        context.db,
        await moduleWorkspace(context, body),
    );
}

const searchParams = (context: Context) =>
    new URL(context.request.url).searchParams;

// Pilihan lokasi setelan ini memakai /lookups/locations milik Lokasi layanan resep.
export function otcSaleLocationRoutes() {
    const root: `/${string}` = `/api/modules/${moduleId}/v1`;
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string) =>
        base.route({
            method,
            path: `${root}${path}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        pharmacyOtcSaleLocationList: route('GET', '/otc-sale-locations')
            .input(typedQuery<ListQuery>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await otcSaleLocations(context)
                    ).list(searchParams(context)),
                ),
            ),
        pharmacyOtcSaleLocationCreate: route('POST', '/otc-sale-locations')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await otcSaleLocations(context, input.body)).create(
                    input.body,
                ),
            ),
        pharmacyOtcSaleLocationUpdate: route(
            'PATCH',
            '/otc-sale-locations/{id}',
        )
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<{
                        price_group_id: string | null;
                        version: number;
                    }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await otcSaleLocations(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        pharmacyOtcSaleLocationDelete: route(
            'DELETE',
            '/otc-sale-locations/{id}',
        )
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<{ version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await otcSaleLocations(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        pharmacyPriceGroupLookup: route('GET', '/lookups/price-groups')
            .input(typedQuery<ListQuery>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await otcSaleLocations(context)
                    ).priceGroups(searchParams(context)),
                ),
            ),
    };
}
