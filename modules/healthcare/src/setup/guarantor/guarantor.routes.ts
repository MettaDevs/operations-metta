import { z } from 'zod';
import {
    base,
    ok,
    typedBody,
    typedQuery,
    type Context,
} from '@core/platform/http/index.ts';
import { moduleId, moduleWorkspace } from '../../module.ts';
import type {
    guarantorInputSchema,
    guarantorListQuerySchema,
} from './guarantor.schema.ts';
import { Guarantors } from './guarantor.service.ts';

type Input = z.input<typeof guarantorInputSchema>;
const recordBody = z.object({
    params: z.object({ id: z.string() }),
    body: z.custom<Input>(),
});

async function guarantors(context: Context, body?: unknown) {
    return new Guarantors(context.db, await moduleWorkspace(context, body));
}

// Penjamin: dibaca pemegang izin penjamin atau izin lihat pasien, diubah pemegang izin ubah penjamin.
export function guarantorRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/guarantors`;
    const route = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        healthcareGuarantorList: route('GET')
            .input(typedQuery<z.input<typeof guarantorListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await guarantors(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        healthcareGuarantorCreate: route('POST')
            .input(typedBody<Input>())
            .handler(async ({ context, input }) =>
                (await guarantors(context, input.body)).create(input.body),
            ),
        healthcareGuarantorUpdate: route('PATCH', '/{id}')
            .input(recordBody)
            .handler(async ({ context, input }) =>
                (await guarantors(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        healthcareGuarantorDelete: route('DELETE', '/{id}')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<{ version: number }>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await guarantors(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
