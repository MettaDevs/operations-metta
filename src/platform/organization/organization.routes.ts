import type { z } from 'zod';
import { Workspace } from '../access/index.ts';
import {
    base,
    bodyInput,
    lookupId,
    mutationInput,
    ok,
    typedQuery,
    type Context,
} from '../http/index.ts';
import { OrganizationHierarchies } from './hierarchy.service.ts';
import {
    failOn,
    operatingUnitTypes,
    organizationPageQuerySchema,
} from './organization.schema.ts';
import { Organizations, timezoneOptions } from './organization.service.ts';

// `$request->boolean()` Laravel.
const truthy = (value: string | null) =>
    ['1', 'true', 'on', 'yes'].includes((value ?? '').toLowerCase());

// Fitur Core memeriksa izinnya per route lewat guard(); CSRF diperiksa untuk setiap request yang mengubah data.
export async function coreWorkspace(context: Context, body?: unknown) {
    context.session.csrf(body);
    return Workspace.core(context.db, context.session);
}

// OrganizationController::index CoreERP untuk tiga layar organisasi. Tanpa `incremental`, jawabannya props
// halaman; dengan `incremental`, satu batch daftar. Layar daftar dan layar hierarchy ditulis sebagai dua fungsi
// supaya tipe jawaban setiap route sampai ke layar tanpa cabang milik route lain.
async function pageContext(context: Context) {
    const workspace = await coreWorkspace(context);
    workspace.guard('organization', 'read');
    const parameters = new URL(context.request.url).searchParams;
    const incremental = truthy(parameters.get('incremental'));
    const resource = parameters.get('resource') || null;
    const excluded = parameters.get('exclude_version_id') || null;
    if (incremental)
        failOn({
            resource:
                resource === null ||
                ['organizations', 'hierarchies'].includes(resource)
                    ? []
                    : ['The selected resource is invalid.'],
            exclude_version_id:
                excluded === null || lookupId(excluded)
                    ? []
                    : ['The exclude version id field must be a valid UUID.'],
        });
    return {
        workspace,
        parameters,
        incremental,
        resource,
        excluded,
        organizations: new Organizations(context.db, workspace),
        hierarchies: new OrganizationHierarchies(context.db, workspace),
    };
}

const pageProps = (workspace: Workspace, organizations: Organizations) => ({
    scopeKey: workspace.tenantId,
    canManage: organizations.canManage,
    operatingUnitTypes,
    organizations: [],
});

async function directoryPage(
    context: Context,
    classification: 'legal_entity' | 'operating_unit',
) {
    const { workspace, parameters, incremental, organizations } =
        await pageContext(context);
    if (incremental)
        return ok(await organizations.batch(parameters, { classification }));
    return ok({
        ...pageProps(workspace, organizations),
        timezones: timezoneOptions(),
    });
}

async function hierarchyPage(context: Context) {
    const {
        workspace,
        parameters,
        incremental,
        resource,
        excluded,
        organizations,
        hierarchies,
    } = await pageContext(context);
    if (!incremental)
        return ok({
            ...pageProps(workspace, organizations),
            hierarchies: [],
            purposes: await hierarchies.purposes(),
        });
    if (resource === 'organizations')
        return ok(
            await organizations.batch(parameters, {
                activeOnly: true,
                excludeVersionId: excluded
                    ? await hierarchies.ownVersion(excluded)
                    : null,
            }),
        );
    const recordId = parameters.get('record_id') || null;
    if (recordId === null) return ok(await hierarchies.batch(parameters));
    failOn({
        record_id: lookupId(recordId)
            ? []
            : ['The record id field must be a valid UUID.'],
    });
    return ok({
        data: [await hierarchies.graph(recordId)],
        next_cursor: null,
    });
}

export function organizationRoutes() {
    const pageRoute = (path: `/${string}`) =>
        base
            .route({
                method: 'GET',
                path,
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(typedQuery<z.input<typeof organizationPageQuerySchema>>());
    return {
        legalEntityPage: pageRoute('/api/v1/settings/legal-entities').handler(
            ({ context }) => directoryPage(context, 'legal_entity'),
        ),
        operatingUnitPage: pageRoute(
            '/api/v1/settings/operating-units',
        ).handler(({ context }) => directoryPage(context, 'operating_unit')),
        hierarchyPage: pageRoute(
            '/api/v1/settings/organization-hierarchies',
        ).handler(({ context }) => hierarchyPage(context)),
        // Daftar API CoreERP tidak dijaga izin layar; cukup anggota aktif tenant.
        organizationList: base
            .route({
                method: 'GET',
                path: '/api/v1/organizations',
                outputStructure: 'detailed',
            })
            .handler(async ({ context }) =>
                ok(
                    await new Organizations(
                        context.db,
                        await coreWorkspace(context),
                    ).index(),
                ),
            ),
        organizationCreate: base
            .route({
                method: 'POST',
                path: '/api/v1/organizations',
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(bodyInput)
            .handler(async ({ context, input }) =>
                new Organizations(
                    context.db,
                    await coreWorkspace(context, input.body),
                ).create(input.body),
            ),
        organizationUpdate: base
            .route({
                method: 'PATCH',
                path: '/api/v1/organizations/{id}',
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(mutationInput)
            .handler(async ({ context, input }) =>
                new Organizations(
                    context.db,
                    await coreWorkspace(context, input.body),
                ).update(context.request, input.params.id, input.body),
            ),
    };
}
