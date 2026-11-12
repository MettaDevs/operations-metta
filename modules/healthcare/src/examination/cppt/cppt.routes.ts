import { z } from 'zod';
import {
    base,
    ok,
    recordInput,
    type Context,
    type listParametersSchema,
} from '@core/platform/http/index.ts';
import { moduleId, moduleWorkspace } from '../../module.ts';
import { Cppts } from './cppt.service.ts';

async function cppts(context: Context) {
    return new Cppts(context.db, await moduleWorkspace(context));
}

// CPPT satu pemeriksaan dan Riwayat kunjungan pasiennya, dibaca halaman pemeriksaan dan cetak rekam medis.
export function cpptRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/examination/destinations/{id}`;
    const route = (suffix: string) =>
        base.route({
            method: 'GET',
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        healthcareCppt: route('/cppt')
            .input(recordInput)
            .handler(async ({ context, input }) =>
                ok(await (await cppts(context)).show(input.params.id)),
            ),
        healthcareVisitHistory: route('/visit-history')
            .input(
                recordInput.extend({
                    query: z.custom<z.input<typeof listParametersSchema>>(),
                }),
            )
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await cppts(context)
                    ).history(
                        input.params.id,
                        new URL(context.request.url).searchParams,
                    ),
                ),
            ),
    };
}
