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
import type { serviceLocationInputSchema } from './service-location.schema.ts';
import { ServiceLocations } from './service-location.service.ts';

type Input = z.input<typeof serviceLocationInputSchema>;
type ListQuery = z.input<typeof listParametersSchema>;

async function serviceLocations(context: Context, body?: unknown) {
    return new ServiceLocations(
        context.db,
        await moduleWorkspace(context, body),
    );
}

const searchParams = (context: Context) =>
    new URL(context.request.url).searchParams;

export function serviceLocationRoutes() {
    const root: `/${string}` = `/api/modules/${moduleId}/v1`;
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string) =>
        base.route({
            method,
            path: `${root}${path}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        pharmacyServiceLocationList: route('GET', '/service-locations')
            .input(typedQuery<ListQuery>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await serviceLocations(context)
                    ).list(searchParams(context)),
                ),
            ),
        pharmacyServiceLocationCreate: route('POST', '/service-locations')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await serviceLocations(context, input.body)).create(
                    input.body,
                ),
            ),
        pharmacyServiceLocationUpdate: route('PATCH', '/service-locations/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<{ location_id: string; version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await serviceLocations(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        pharmacyServiceLocationDelete: route(
            'DELETE',
            '/service-locations/{id}',
        )
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<{ version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await serviceLocations(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        pharmacyLocationLookup: route('GET', '/lookups/locations')
            .input(typedQuery<ListQuery>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await serviceLocations(context)
                    ).locations(searchParams(context)),
                ),
            ),
        pharmacyOperatingUnitLookup: route('GET', '/lookups/operating-units')
            .input(typedQuery<ListQuery>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await serviceLocations(context)
                    ).operatingUnits(searchParams(context)),
                ),
            ),
        pharmacySectionLookup: route('GET', '/lookups/sections')
            .input(typedQuery<ListQuery & { operating_unit_id?: string }>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await serviceLocations(context)
                    ).sections(searchParams(context)),
                ),
            ),
    };
}
