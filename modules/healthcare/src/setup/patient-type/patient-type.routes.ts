import { z } from 'zod';
import {
    base,
    ok,
    typedBody,
    type Context,
} from '@core/platform/http/index.ts';
import { moduleId, moduleWorkspace } from '../../module.ts';
import type { patientTypeInputSchema } from './patient-type.schema.ts';
import { PatientTypes } from './patient-type.service.ts';

type Input = z.input<typeof patientTypeInputSchema>;
const recordBody = z.object({
    params: z.object({ id: z.string() }),
    body: z.custom<Input>(),
});

async function patientTypes(context: Context, body?: unknown) {
    return new PatientTypes(context.db, await moduleWorkspace(context, body));
}

// Tipe pasien: dibaca pemegang izin tipe pasien atau izin lihat pasien, diubah pemegang izin ubah tipe pasien.
export function patientTypeRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/patient-types`;
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        healthcarePatientTypeList: route('GET').handler(async ({ context }) =>
            ok(await (await patientTypes(context)).list()),
        ),
        healthcarePatientTypeCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await patientTypes(context, input.body)).create(input.body),
            ),
        healthcarePatientTypeUpdate: route('PATCH', '/{id}')
            .input(recordBody)
            .handler(async ({ context, input }) =>
                (await patientTypes(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        healthcarePatientTypeDelete: route('DELETE', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<{ version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await patientTypes(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
