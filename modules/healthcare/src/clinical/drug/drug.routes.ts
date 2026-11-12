import { z } from 'zod';
import {
    base,
    ok,
    typedBody,
    typedQuery,
    type Context,
} from '@core/platform/http/index.ts';
import { moduleId, moduleWorkspace } from '../../module.ts';
import type { drugInputSchema, drugListQuerySchema } from './drug.schema.ts';
import { Drugs } from './drug.service.ts';

type Input = z.input<typeof drugInputSchema>;

async function drugs(context: Context, body?: unknown) {
    return new Drugs(context.db, await moduleWorkspace(context, body));
}

// Obat: dibaca pemegang izin lihat obat, termasuk pemeriksa; tambah, ubah, dan hapus masing-masing dengan izinnya.
export function drugRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/drugs`;
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        healthcareDrugMetadata: route('GET', '/metadata').handler(
            async ({ context }) => ok(await (await drugs(context)).metadata()),
        ),
        healthcareDrugList: route('GET')
            .input(typedQuery<z.input<typeof drugListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await drugs(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        healthcareDrugCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await drugs(context, input.body)).create(input.body),
            ),
        healthcareDrugUpdate: route('PATCH', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<Input>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await drugs(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        healthcareDrugDelete: route('DELETE', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<{ version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await drugs(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
