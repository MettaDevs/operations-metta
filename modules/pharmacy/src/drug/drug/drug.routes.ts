import { z } from 'zod';
import {
    base,
    ok,
    typedQuery,
    type Context,
} from '@core/platform/http/index.ts';
import { moduleId, moduleWorkspace } from '../../module.ts';
import type { drugInputSchema, drugListQuerySchema } from './drug.schema.ts';
import { Drugs } from './drug.service.ts';

async function drugs(context: Context, body?: unknown) {
    return new Drugs(context.db, await moduleWorkspace(context, body));
}

export function drugRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/drugs`;
    return {
        pharmacyDrugList: base
            .route({
                method: 'GET',
                path,
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(typedQuery<z.input<typeof drugListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await drugs(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        pharmacyDrugUpdate: base
            .route({
                method: 'PUT',
                path: `${path}/{id}`,
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<z.input<typeof drugInputSchema>>(),
                }),
            )
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await drugs(context, input.body)
                    ).update(input.params.id, input.body),
                ),
            ),
    };
}
