import { z } from 'zod';
import { coreWorkspace } from '../../platform/access/index.ts';
import {
    base,
    ok,
    typedBody,
    typedQuery,
    type Context,
    type listParametersSchema,
} from '../../platform/http/index.ts';
import type {
    calendarDayInputSchema,
    calendarInputSchema,
    calendarListQuerySchema,
    composeInputSchema,
    daysQuerySchema,
    workingTimeTemplateInputSchema,
} from './calendar.schema.ts';
import { Calendars } from './calendar.service.ts';
import { WorkingTimeTemplates } from './working-time-template.service.ts';

type CalendarInput = z.input<typeof calendarInputSchema>;
type TemplateInput = z.input<typeof workingTimeTemplateInputSchema>;
type DayInput = z.input<typeof calendarDayInputSchema>;
type ListQuery = z.input<typeof calendarListQuerySchema>;

async function calendars(context: Context, body?: unknown) {
    return new Calendars(context.db, await coreWorkspace(context, body));
}

async function templates(context: Context, body?: unknown) {
    return new WorkingTimeTemplates(
        context.db,
        await coreWorkspace(context, body),
    );
}

const route = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: `/${string}`,
) =>
    base.route({
        method,
        path,
        inputStructure: 'detailed',
        outputStructure: 'detailed',
    });

const searchParams = (context: Context) =>
    new URL(context.request.url).searchParams;

const record = <T>() =>
    z.object({ params: z.object({ id: z.string() }), body: z.custom<T>() });
const day = <T>() =>
    z.object({
        params: z.object({ id: z.string(), date: z.string() }),
        body: z.custom<T>(),
    });

// Kalender dan template jam kerja (Sys Admin → Kalender): dibaca dengan core.calendar.read, diubah dengan
// core.calendar.update.
export function calendarRoutes() {
    const calendarPath = '/api/v1/calendars';
    const templatePath = '/api/v1/working-time-templates';
    return {
        calendarList: route('GET', calendarPath)
            .input(typedQuery<ListQuery>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await calendars(context)
                    ).list(searchParams(context)),
                ),
            ),
        calendarCreate: route('POST', calendarPath)
            .input(typedBody<CalendarInput>())
            .handler(async ({ context, input }) =>
                (await calendars(context, input.body)).create(input.body),
            ),
        calendarUpdate: route('PATCH', `${calendarPath}/{id}`)
            .input(record<CalendarInput>())
            .handler(async ({ context, input }) =>
                (await calendars(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        calendarDelete: route('DELETE', `${calendarPath}/{id}`)
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await calendars(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        calendarDays: route('GET', `${calendarPath}/{id}/days`)
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    query: z.custom<z.input<typeof daysQuerySchema>>(),
                }),
            )
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await calendars(context)
                    ).days(input.params.id, searchParams(context)),
                ),
            ),
        calendarDaySet: route('PUT', `${calendarPath}/{id}/days/{date}`)
            .input(day<DayInput>())
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await calendars(context, input.body)
                    ).setDay(input.params.id, input.params.date, input.body),
                ),
            ),
        calendarDayDelete: route('DELETE', `${calendarPath}/{id}/days/{date}`)
            .input(day<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await calendars(context, input.body)).deleteDay(
                    context.request,
                    input.params.id,
                    input.params.date,
                    input.body,
                ),
            ),
        calendarCompose: route('POST', `${calendarPath}/{id}/compose`)
            .input(record<z.input<typeof composeInputSchema>>())
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await calendars(context, input.body)
                    ).compose(input.params.id, input.body),
                ),
            ),
        workingTimeTemplateList: route('GET', templatePath)
            .input(typedQuery<z.input<typeof listParametersSchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await templates(context)
                    ).list(searchParams(context)),
                ),
            ),
        workingTimeTemplateCreate: route('POST', templatePath)
            .input(typedBody<TemplateInput>())
            .handler(async ({ context, input }) =>
                (await templates(context, input.body)).create(input.body),
            ),
        workingTimeTemplateUpdate: route('PATCH', `${templatePath}/{id}`)
            .input(record<TemplateInput>())
            .handler(async ({ context, input }) =>
                (await templates(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        workingTimeTemplateDelete: route('DELETE', `${templatePath}/{id}`)
            .input(record<{ version: number }>())
            .handler(async ({ context, input }) =>
                (await templates(context, input.body)).destroy(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
    };
}
