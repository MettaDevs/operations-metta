import { z } from 'zod';
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
    visitCancelInputSchema,
    visitInputSchema,
    visitListQuerySchema,
} from './visit.schema.ts';
import { Visits } from './visit.service.ts';

async function visits(context: Context, body?: unknown) {
    return new Visits(context.db, await moduleWorkspace(context, body));
}

// Pendaftaran kunjungan: data form, daftar dengan penghitung status, detail, daftarkan, dan batalkan.
export function visitRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/visits`;
    const route = (method: 'GET' | 'POST', suffix = '') =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        healthcareVisitMetadata: route('GET', '/metadata').handler(
            async ({ context }) => ok(await (await visits(context)).metadata()),
        ),
        healthcareVisitList: route('GET')
            .input(typedQuery<z.input<typeof visitListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await visits(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        healthcareVisitShow: route('GET', '/{id}')
            .input(recordInput)
            .handler(async ({ context, input }) =>
                ok(await (await visits(context)).show(input.params.id)),
            ),
        healthcareVisitCreate: route('POST')
            .input(typedBody<z.input<typeof visitInputSchema>>())
            .handler(async ({ context, input }) =>
                (await visits(context, input.body)).create(
                    context.request,
                    input.body,
                ),
            ),
        healthcareVisitCancel: route('POST', '/{id}/cancel')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<z.input<typeof visitCancelInputSchema>>(),
                }),
            )
            .handler(async ({ context, input }) =>
                (await visits(context, input.body)).cancel(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
