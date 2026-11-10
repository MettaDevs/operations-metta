import { z } from 'zod';
import type { listParametersSchema } from '@core/platform/http/index.ts';
import {
    base,
    ok,
    recordInput,
    typedBody,
    typedQuery,
    type Context,
} from '@core/platform/http/index.ts';
import { moduleId, moduleWorkspace } from '../../module.ts';
import type {
    partyLookupInputSchema,
    patientInputSchema,
    patientListQuerySchema,
} from './patient.schema.ts';
import { Patients } from './patient.service.ts';

type Input = z.input<typeof patientInputSchema>;

async function patients(context: Context, body?: unknown) {
    return new Patients(context.db, await moduleWorkspace(context, body));
}

// Master pasien: daftar dan pencarian, data form, cari party lewat NIK, detail, daftar baru, ubah, dan hapus.
export function patientRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/patients`;
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        healthcarePatientList: route('GET')
            .input(typedQuery<z.input<typeof patientListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await patients(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        healthcarePatientMetadata: route('GET', '/metadata').handler(
            async ({ context }) =>
                ok(await (await patients(context)).metadata()),
        ),
        healthcarePatientOccupations: base
            .route({
                method: 'GET',
                path: `/api/modules/${moduleId}/v1/occupations`,
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(typedQuery<z.input<typeof listParametersSchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await patients(context)
                    ).occupations(new URL(context.request.url).searchParams),
                ),
            ),
        healthcarePatientPartyLookup: route('POST', '/party-lookup')
            .input(typedBody<z.input<typeof partyLookupInputSchema>>())
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await patients(context, input.body)
                    ).lookup(input.body),
                ),
            ),
        healthcarePatientShow: route('GET', '/{id}')
            .input(recordInput)
            .handler(async ({ context, input }) =>
                ok(await (await patients(context)).show(input.params.id)),
            ),
        healthcarePatientCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await patients(context, input.body)).create(
                    context.request,
                    input.body,
                ),
            ),
        healthcarePatientUpdate: route('PATCH', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<Input>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await patients(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        healthcarePatientDelete: route('DELETE', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<{ version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await patients(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
