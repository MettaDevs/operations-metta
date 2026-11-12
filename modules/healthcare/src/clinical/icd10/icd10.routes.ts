import { z } from 'zod';
import {
    base,
    ok,
    typedBody,
    typedQuery,
    type Context,
} from '@core/platform/http/index.ts';
import { moduleId, moduleWorkspace } from '../../module.ts';
import type { icd10InputSchema, icd10ListQuerySchema } from './icd10.schema.ts';
import { Icd10Codes } from './icd10.service.ts';

type Input = z.input<typeof icd10InputSchema>;

async function codes(context: Context, body?: unknown) {
    return new Icd10Codes(context.db, await moduleWorkspace(context, body));
}

// ICD-10: dibaca pemegang izin lihat ICD-10, termasuk pemeriksa; tambah, ubah, dan hapus masing-masing dengan izinnya.
export function icd10Routes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/icd10`;
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        healthcareIcd10Metadata: route('GET', '/metadata').handler(
            async ({ context }) => ok((await codes(context)).metadata()),
        ),
        healthcareIcd10List: route('GET')
            .input(typedQuery<z.input<typeof icd10ListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await codes(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        healthcareIcd10Create: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await codes(context, input.body)).create(input.body),
            ),
        healthcareIcd10Update: route('PATCH', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<Input>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await codes(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        healthcareIcd10Delete: route('DELETE', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<{ version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await codes(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
