import { z } from 'zod';
import {
    base,
    ok,
    recordInput,
    type Context,
    type listParametersSchema,
} from '@core/platform/http/index.ts';
import { moduleId, moduleWorkspace } from '../../module.ts';
import type { MedicalRecordInput } from './medical-record.schema.ts';
import { MedicalRecords } from './medical-record.service.ts';

async function records(context: Context, body?: unknown) {
    return new MedicalRecords(context.db, await moduleWorkspace(context, body));
}

// Isi tab Rekam Medis satu tujuan kunjungan di halaman pemeriksaan: data acuan, baca, dan Simpan.
export function medicalRecordRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/examination`;
    const route = (method: 'GET' | 'PUT' | 'POST', suffix: string) =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        healthcareMedicalRecordMetadata: route(
            'GET',
            '/medical-record/metadata',
        ).handler(async ({ context }) =>
            ok(await (await records(context)).metadata()),
        ),
        healthcareMedicalRecordShow: route(
            'GET',
            '/destinations/{id}/medical-record',
        )
            .input(recordInput)
            .handler(async ({ context, input }) =>
                ok(await (await records(context)).show(input.params.id)),
            ),
        healthcareDiagnosisHistory: route(
            'GET',
            '/destinations/{id}/diagnosis-history',
        )
            .input(
                recordInput.extend({
                    query: z.custom<z.input<typeof listParametersSchema>>(),
                }),
            )
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await records(context)
                    ).diagnosisHistory(
                        input.params.id,
                        new URL(context.request.url).searchParams,
                    ),
                ),
            ),
        healthcareMedicalRecordSave: route(
            'PUT',
            '/destinations/{id}/medical-record',
        )
            .input(
                recordInput.extend({
                    body: z.custom<MedicalRecordInput>(),
                }),
            )
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await records(context, input.body)
                    ).save(input.params.id, input.body),
                ),
            ),
        healthcarePrescriptionSend: route(
            'POST',
            '/destinations/{id}/prescriptions/{prescriptionId}/send',
        )
            .input(
                z.object({
                    params: z.object({
                        id: z.string(),
                        prescriptionId: z.string(),
                    }),
                    body: z.custom<{ version: number | null }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await records(context, input.body)
                    ).sendPrescription(
                        input.params.id,
                        input.params.prescriptionId,
                        input.body,
                    ),
                ),
            ),
    };
}
