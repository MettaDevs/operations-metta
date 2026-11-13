import { z } from 'zod';
import { coreWorkspace } from '../../../platform/access/index.ts';
import {
    base,
    ok,
    typedBody,
    typedQuery,
    type Context,
} from '../../../platform/http/index.ts';
import type {
    clerkEndInputSchema,
    clerkListQuerySchema,
    clerkStartInputSchema,
} from './clerk.schema.ts';
import { Clerks, type PasswordCheck } from './clerk.service.ts';

const route = (method: 'GET' | 'POST', suffix = '') =>
    base.route({
        method,
        path: `/api/v1/billing/clerks${suffix}`,
        inputStructure: 'detailed',
        outputStructure: 'detailed',
    });

async function clerks(context: Context, body?: unknown) {
    return new Clerks(context.db, await coreWorkspace(context, body));
}

function password(context: Context): PasswordCheck {
    return {
        exists: context.session.requireUser().password !== null,
        confirm: (typed) => context.session.confirmPassword(typed),
    };
}

export function clerkRoutes() {
    return {
        billingClerkList: route('GET')
            .input(typedQuery<z.input<typeof clerkListQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await clerks(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        billingClerkCurrent: route('GET', '/current').handler(
            async ({ context }) =>
                ok(await (await clerks(context)).current(password(context))),
        ),
        billingClerkStart: route('POST', '/start')
            .input(typedBody<z.input<typeof clerkStartInputSchema>>())
            .handler(async ({ context, input }) =>
                (await clerks(context, input.body)).start(
                    input.body,
                    password(context),
                ),
            ),
        billingClerkShow: route('GET', '/{id}')
            .input(z.object({ params: z.object({ id: z.string() }) }))
            .handler(async ({ context, input }) =>
                ok(await (await clerks(context)).show(input.params.id)),
            ),
        billingClerkEnd: route('POST', '/{id}/end')
            .input(
                z.object({
                    params: z.object({ id: z.string() }),
                    body: z.custom<z.input<typeof clerkEndInputSchema>>(),
                }),
            )
            .handler(async ({ context, input }) =>
                ok(
                    await (
                        await clerks(context, input.body)
                    ).end(
                        context.request,
                        input.params.id,
                        input.body,
                        password(context),
                    ),
                ),
            ),
    };
}
