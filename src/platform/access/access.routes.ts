import type { z } from 'zod';
import {
    base,
    listParametersSchema,
    ok,
    recordInput,
    typedBody,
    typedQuery,
    type Context,
} from '../http/index.ts';
import { coreWorkspace } from './core-workspace.ts';
import type { membershipInputSchema } from './membership.schema.ts';
import { Memberships } from './membership.service.ts';
import type { roleInputSchema } from './role.schema.ts';
import { Roles } from './role.service.ts';
import { SecurityConfiguration } from './security-configuration.service.ts';

type MemberListQuery = z.input<typeof listParametersSchema> & {
    role_id?: string;
    organization_id?: string;
    status?: 'active' | 'inactive';
};

const route = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: `/api/v1/${string}`,
) =>
    base.route({
        method,
        path,
        inputStructure: 'detailed',
        outputStructure: 'detailed',
    });

async function memberships(context: Context, body?: unknown) {
    return new Memberships(context.db, await coreWorkspace(context, body));
}

async function roles(context: Context, body?: unknown) {
    return new Roles(context.db, await coreWorkspace(context, body));
}

const parameters = (context: Context) =>
    new URL(context.request.url).searchParams;

// Role dan akses staf, dipindah dari AccessController, RoleController, MembershipController, dan
// SecurityConfigurationController CoreERP. Dibaca dengan `core.access.read` dan diubah dengan `core.access.update`.
export function accessRoutes() {
    return {
        accessPage: route('GET', '/api/v1/access').handler(
            async ({ context }) =>
                ok({ data: await (await memberships(context)).page() }),
        ),
        accessMemberList: route('GET', '/api/v1/access/members')
            .input(typedQuery<MemberListQuery>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await memberships(context)
                    ).list(parameters(context)),
                ),
            ),
        membershipShow: route('GET', '/api/v1/memberships/{id}')
            .input(recordInput)
            .handler(async ({ context, input }) =>
                (await memberships(context)).show(input.params.id),
            ),
        membershipUpdate: route('PATCH', '/api/v1/memberships/{id}')
            .input(
                recordInput.extend(
                    typedBody<z.input<typeof membershipInputSchema>>().shape,
                ),
            )
            .handler(async ({ context, input }) =>
                (await memberships(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        roleList: route('GET', '/api/v1/roles')
            .input(typedQuery<z.input<typeof listParametersSchema>>())
            .handler(async ({ context }) =>
                ok(await (await roles(context)).list(parameters(context))),
            ),
        roleCreate: route('POST', '/api/v1/roles')
            .input(typedBody<z.input<typeof roleInputSchema>>())
            .handler(async ({ context, input }) =>
                (await roles(context, input.body)).create(input.body),
            ),
        roleShow: route('GET', '/api/v1/roles/{id}')
            .input(recordInput)
            .handler(async ({ context, input }) =>
                (await roles(context)).show(input.params.id),
            ),
        roleUpdate: route('PUT', '/api/v1/roles/{id}')
            .input(
                recordInput.extend(
                    typedBody<z.input<typeof roleInputSchema>>().shape,
                ),
            )
            .handler(async ({ context, input }) =>
                (await roles(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        roleDelete: route('DELETE', '/api/v1/roles/{id}')
            .input(
                recordInput.extend(
                    typedBody<{ version?: number | string }>().shape,
                ),
            )
            .handler(async ({ context, input }) =>
                (await roles(context, input.body)).delete(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        securityConfiguration: route(
            'GET',
            '/api/v1/security-configuration',
        ).handler(async ({ context }) =>
            ok({
                data: await new SecurityConfiguration(
                    context.db,
                    await coreWorkspace(context),
                ).catalog(),
            }),
        ),
    };
}
