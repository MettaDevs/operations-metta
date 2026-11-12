import { z } from 'zod';
import {
    base,
    ok,
    typedQuery,
    type Context,
    type listParametersSchema,
} from '@core/platform/http/index.ts';
import { moduleId, moduleWorkspace } from '../../module.ts';
import type {
    dispensingInputSchema,
    handOverInputSchema,
    versionInputSchema,
} from './dispensing.schema.ts';
import { Dispensings } from './dispensing.service.ts';

type ListQuery = z.input<typeof listParametersSchema>;

async function dispensings(context: Context, body?: unknown) {
    return new Dispensings(context.db, await moduleWorkspace(context, body));
}

const record = <T>() =>
    z.object({
        params: z.object({ id: z.string() }),
        body: z.custom<T>(),
    });

// Penyerahan obat dibuka dari resepnya: satu penyerahan aktif per resep, jadi alamatnya memakai id resep.
export function dispensingRoutes() {
    const root: `/${string}` = `/api/modules/${moduleId}/v1`;
    const route = (method: 'GET' | 'POST' | 'PUT', path: string) =>
        base.route({
            method,
            path: `${root}${path}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    const dispensing = '/prescriptions/{id}/dispensing';
    return {
        pharmacyDispensingShow: route('GET', dispensing)
            .input(z.object({ params: z.object({ id: z.string() }) }))
            .handler(async ({ context, input }) =>
                ok(await (await dispensings(context)).show(input.params.id)),
            ),
        pharmacyDispensingSave: route('PUT', dispensing)
            .input(record<z.input<typeof dispensingInputSchema>>())
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await dispensings(context, input.body)
                    ).save(input.params.id, input.body),
                ),
            ),
        pharmacyDispensingPrepare: route('POST', `${dispensing}/prepare`)
            .input(
                record<
                    | z.input<typeof dispensingInputSchema>
                    | z.input<typeof versionInputSchema>
                    | Record<string, never>
                >(),
            )
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await dispensings(context, input.body)
                    ).prepare(input.params.id, input.body),
                ),
            ),
        pharmacyDispensingCall: route('POST', `${dispensing}/call`)
            .input(record<Record<string, never>>())
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await dispensings(context, input.body)
                    ).call(input.params.id),
                ),
            ),
        pharmacyDispensingHandOver: route('POST', `${dispensing}/hand-over`)
            .input(record<z.input<typeof handOverInputSchema>>())
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await dispensings(context, input.body)
                    ).handOver(input.params.id, input.body),
                ),
            ),
        pharmacyDispensingCancelPreparation: route(
            'POST',
            `${dispensing}/cancel-preparation`,
        )
            .input(record<z.input<typeof versionInputSchema>>())
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await dispensings(context, input.body)
                    ).cancelPreparation(input.params.id, input.body),
                ),
            ),
        pharmacyBatchLookup: route('GET', '/lookups/batches')
            .input(
                typedQuery<
                    ListQuery & { item_id?: string; location_id?: string }
                >(),
            )
            .handler(async ({ context }) =>
                ok(
                    await (
                        await dispensings(context)
                    ).batches(new URL(context.request.url).searchParams),
                ),
            ),
        pharmacyStaffLookup: route('GET', '/lookups/staff')
            .input(typedQuery<ListQuery>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await dispensings(context)
                    ).staff(new URL(context.request.url).searchParams),
                ),
            ),
    };
}
