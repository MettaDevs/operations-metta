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
    callNextInputSchema,
    queueListQuerySchema,
    startInputSchema,
} from './queue.schema.ts';
import { ExaminationQueue } from './queue.service.ts';
import type { QueueAction } from './queue.statuses.ts';

async function queue(context: Context, body?: unknown) {
    return new ExaminationQueue(
        context.db,
        await moduleWorkspace(context, body),
    );
}

// Antrean poli: data layar, daftar hari ini dengan penghitung status, panggil berikutnya, dan tindakan per tujuan.
export function examinationQueueRoutes() {
    const path: `/${string}` = `/api/modules/${moduleId}/v1/examination`;
    const route = (method: 'GET' | 'POST', suffix: string) =>
        base.route({
            method,
            path: `${path}${suffix}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    const action = (suffix: string, name: Exclude<QueueAction, 'panggil'>) =>
        route('POST', `/destinations/{id}/${suffix}`)
            .input(recordInput.extend({ body: z.unknown().optional() }))
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await queue(context, input.body)
                    ).act(input.params.id, name, input.body),
                ),
            );
    return {
        healthcareExaminationMetadata: route('GET', '/metadata').handler(
            async ({ context }) => ok(await (await queue(context)).metadata()),
        ),
        healthcareExaminationQueue: route('GET', '/queue')
            .input(typedQuery<z.input<typeof queueListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await queue(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        healthcareExaminationCallNext: route('POST', '/queue/call-next')
            .input(typedBody<z.input<typeof callNextInputSchema>>())
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await queue(context, input.body)
                    ).callNext(input.body),
                ),
            ),
        healthcareExaminationShow: route('GET', '/destinations/{id}')
            .input(recordInput)
            .handler(async ({ context, input }) =>
                ok(await (await queue(context)).show(input.params.id)),
            ),
        healthcareExaminationRecall: action('recall', 'panggil_ulang'),
        healthcareExaminationSkip: action('skip', 'lewati'),
        healthcareExaminationNoShow: action('no-show', 'tidak_datang'),
        healthcareExaminationStart: route('POST', '/destinations/{id}/start')
            .input(
                recordInput.extend({
                    body: z.custom<z.input<typeof startInputSchema>>(),
                }),
            )
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await queue(context, input.body)
                    ).act(input.params.id, 'mulai_periksa', input.body),
                ),
            ),
        healthcareExaminationFinish: action('finish', 'selesai_periksa'),
    };
}
