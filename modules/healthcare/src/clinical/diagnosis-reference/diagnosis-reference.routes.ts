import { z } from 'zod';
import { base, ok, type Context } from '@core/platform/http/index.ts';
import { moduleId, moduleWorkspace } from '../../module.ts';
import type {
    DiagnosisReferenceList,
    diagnosisReferenceInputSchema,
    diagnosisReferenceListQuerySchema,
} from './diagnosis-reference.schema.ts';
import { DiagnosisReferences } from './diagnosis-reference.service.ts';

type Input = z.input<typeof diagnosisReferenceInputSchema>;

async function references(context: Context, list: string, body?: unknown) {
    return new DiagnosisReferences(
        context.db,
        await moduleWorkspace(context, body),
        list,
    );
}

const listParams = z.object({ list: z.custom<DiagnosisReferenceList>() });
const recordParams = listParams.extend({ id: z.string() });

// Jenis diagnosa, kasus diagnosa, prognosa, dan penyakit kronis: satu set endpoint, daftarnya dipilih di path.
export function diagnosisReferenceRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/diagnosis-references/{list}`;
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        healthcareDiagnosisReferenceMetadata: route('GET', '/metadata')
            .input(z.object({ params: listParams }))
            .handler(async ({ context, input }) =>
                ok((await references(context, input.params.list)).metadata()),
            ),
        healthcareDiagnosisReferenceList: route('GET')
            .input(
                z.object({
                    params: listParams,
                    query: z.custom<
                        z.input<typeof diagnosisReferenceListQuerySchema>
                    >(),
                }),
            )
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await references(context, input.params.list)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        healthcareDiagnosisReferenceCreate: route('POST')
            .input(z.object({ params: listParams, body: z.custom<Input>() }))
            .handler(async ({ context, input }) =>
                (
                    await references(context, input.params.list, input.body)
                ).create(input.body),
            ),
        healthcareDiagnosisReferenceUpdate: route('PATCH', '/{id}')
            .input(z.object({ params: recordParams, body: z.custom<Input>() }))
            .handler(async ({ context, input }) =>
                (
                    await references(context, input.params.list, input.body)
                ).update(context.request, input.params.id, input.body),
            ),
        healthcareDiagnosisReferenceDelete: route('DELETE', '/{id}')
            .input(
                z.object({
                    params: recordParams,
                    body: z.custom<{ version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (
                    await references(context, input.params.list, input.body)
                ).destroy(context.request, input.params.id, input.body),
            ),
    };
}
