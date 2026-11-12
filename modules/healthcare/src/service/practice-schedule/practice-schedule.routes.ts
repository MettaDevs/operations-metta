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
    generateInputSchema,
    practiceScheduleChangeSchema,
    practiceScheduleInputSchema,
    practiceScheduleListQuerySchema,
    practiceSessionInputSchema,
    practiceSessionListQuerySchema,
    scheduleParameterInputSchema,
    scheduleTemplateInputSchema,
    scheduleTemplateListQuerySchema,
} from './practice-schedule.schema.ts';
import { PracticeSchedules } from './practice-schedule.service.ts';
import { PracticeSessions } from './practice-session.service.ts';
import { ScheduleParameters } from './schedule-parameter.service.ts';
import {
    practiceScheduleMetadata,
    schedulePractitioners,
    ScheduleTemplates,
} from './schedule-template.service.ts';

type SessionInput = z.input<typeof practiceSessionInputSchema>;
type TemplateInput = z.input<typeof scheduleTemplateInputSchema>;
type ChangeInput = z.input<typeof practiceScheduleChangeSchema>;

const searchParams = (context: Context) =>
    new URL(context.request.url).searchParams;

const recordBody = <T>() =>
    z.object({
        params: z.object({ id: z.string() }),
        body: z.custom<T>(),
    });

// Sesi praktik, template jadwal, dan jadwal bertanggal. Semuanya dibaca dengan izin lihat jadwal praktik; tambah,
// ubah, dan hapus masing-masing dengan izinnya sendiri. Generate butuh izin tambah dan ubah.
export function practiceScheduleRoutes() {
    const root = `/api/modules/${moduleId}/v1`;
    const route = (
        method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        path: `/${string}`,
    ) =>
        base.route({
            method,
            path: `${root}${path}`,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    const sessions = async (context: Context, body?: unknown) =>
        new PracticeSessions(context.db, await moduleWorkspace(context, body));
    const templates = async (context: Context, body?: unknown) =>
        new ScheduleTemplates(context.db, await moduleWorkspace(context, body));
    const schedules = async (context: Context, body?: unknown) =>
        new PracticeSchedules(context.db, await moduleWorkspace(context, body));
    const parameters = async (context: Context, body?: unknown) =>
        new ScheduleParameters(
            context.db,
            await moduleWorkspace(context, body),
        );
    return {
        healthcarePracticeScheduleMetadata: route(
            'GET',
            '/practice-schedules/metadata',
        ).handler(async ({ context }) =>
            ok(
                await practiceScheduleMetadata(
                    context.db,
                    await moduleWorkspace(context),
                ),
            ),
        ),
        healthcareScheduleParameters: route(
            'GET',
            '/practice-schedules/parameters',
        ).handler(async ({ context }) =>
            ok(await (await parameters(context)).show()),
        ),
        healthcareScheduleParametersUpdate: route(
            'PUT',
            '/practice-schedules/parameters',
        )
            .input(typedBody<z.input<typeof scheduleParameterInputSchema>>())
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await parameters(context, input.body)
                    ).update(context.request, input.body),
                ),
            ),
        healthcarePracticeSchedulePractitioners: route(
            'GET',
            '/practice-schedules/practitioners',
        ).handler(async ({ context }) =>
            ok(
                await schedulePractitioners(
                    context.db,
                    await moduleWorkspace(context),
                    searchParams(context),
                ),
            ),
        ),
        healthcarePracticeSessionList: route('GET', '/practice-sessions')
            .input(typedQuery<z.input<typeof practiceSessionListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(await (await sessions(context)).list(searchParams(context))),
            ),
        healthcarePracticeSessionCreate: route('POST', '/practice-sessions')
            .input(typedBody<SessionInput>())
            .handler(async ({ context, input }) =>
                (await sessions(context, input.body)).create(input.body),
            ),
        healthcarePracticeSessionUpdate: route(
            'PATCH',
            '/practice-sessions/{id}',
        )
            .input(recordBody<SessionInput>())
            .handler(async ({ context, input }) =>
                (await sessions(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        healthcarePracticeSessionDelete: route(
            'DELETE',
            '/practice-sessions/{id}',
        )
            .input(recordBody<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await sessions(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        healthcareScheduleTemplateList: route('GET', '/schedule-templates')
            .input(
                typedQuery<z.input<typeof scheduleTemplateListQuerySchema>>(),
            )
            .handler(async ({ context }) =>
                ok(
                    await (
                        await templates(context)
                    ).list(searchParams(context)),
                ),
            ),
        healthcareScheduleTemplateCreate: route('POST', '/schedule-templates')
            .input(typedBody<TemplateInput>())
            .handler(async ({ context, input }) =>
                (await templates(context, input.body)).create(input.body),
            ),
        healthcareScheduleTemplateUpdate: route(
            'PATCH',
            '/schedule-templates/{id}',
        )
            .input(recordBody<TemplateInput>())
            .handler(async ({ context, input }) =>
                (await templates(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        healthcareScheduleTemplateDelete: route(
            'DELETE',
            '/schedule-templates/{id}',
        )
            .input(recordBody<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await templates(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        healthcarePracticeScheduleList: route('GET', '/practice-schedules')
            .input(
                typedQuery<z.input<typeof practiceScheduleListQuerySchema>>(),
            )
            .handler(async ({ context }) =>
                ok(
                    await (
                        await schedules(context)
                    ).list(searchParams(context)),
                ),
            ),
        healthcarePracticeScheduleCreate: route('POST', '/practice-schedules')
            .input(typedBody<z.input<typeof practiceScheduleInputSchema>>())
            .handler(async ({ context, input }) =>
                (await schedules(context, input.body)).create(input.body),
            ),
        healthcarePracticeScheduleGenerate: route(
            'POST',
            '/practice-schedules/generate',
        )
            .input(typedBody<z.input<typeof generateInputSchema>>())
            .handler(async ({ context, input }) =>
                (await schedules(context, input.body)).generate(input.body),
            ),
        healthcarePracticeScheduleUpdate: route(
            'PATCH',
            '/practice-schedules/{id}',
        )
            .input(recordBody<ChangeInput>())
            .handler(async ({ context, input }) =>
                (await schedules(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
