import { z } from 'zod';
import { base, ok, recordInput } from '@core/platform/http/index.ts';
import { moduleId, moduleWorkspace } from '../../module.ts';
import { MedicalRecords } from '../medical-record/medical-record.service.ts';
import type { internalReferralInputSchema } from './discharge.schema.ts';
import { Discharges } from './discharge.service.ts';

// Rujuk internal dari halaman pemeriksaan: pilihan poli dan jadwalnya, lalu Tambah Rujuk Internal, yang menjawab isi
// rekam medis terbaru supaya layar langsung menampilkan rujukan dan status pasiennya.
export function dischargeRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/examination/destinations/{id}/internal-referrals`;
    const route = (method: 'GET' | 'POST', suffix: string) =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        healthcareInternalReferralOptions: route('GET', '/options')
            .input(recordInput)
            .handler(async ({ context, input }) =>
                ok(
                    await new Discharges(
                        context.db,
                        await moduleWorkspace(context),
                    ).referralOptions(input.params.id),
                ),
            ),
        healthcareInternalReferralCreate: route('POST', '')
            .input(
                recordInput.extend({
                    body: z.custom<
                        z.input<typeof internalReferralInputSchema>
                    >(),
                }),
            )
            .handler(async ({ context, input }) => {
                const workspace = await moduleWorkspace(context, input.body);
                await new Discharges(context.db, workspace).refer(
                    input.params.id,
                    input.body,
                );
                return ok(
                    await new MedicalRecords(context.db, workspace).show(
                        input.params.id,
                    ),
                );
            }),
    };
}
