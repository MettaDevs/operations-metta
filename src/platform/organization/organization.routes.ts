import { Workspace } from '../access/index.ts';
import {
    base,
    bodyInput,
    lookupId,
    mutationInput,
    ok,
    type Context,
} from '../http/index.ts';
import { OrganizationHierarchies } from './hierarchy.service.ts';
import { failOn, operatingUnitTypes } from './organization.schema.ts';
import { Organizations, timezoneOptions } from './organization.service.ts';

type Section = 'legal-entities' | 'operating-units' | 'hierarchies';

// `$request->boolean()` Laravel.
const truthy = (value: string | null) =>
    ['1', 'true', 'on', 'yes'].includes((value ?? '').toLowerCase());

// Fitur Core memeriksa izinnya per route lewat guard(); CSRF diperiksa untuk setiap request yang mengubah data.
export async function coreWorkspace(context: Context, body?: unknown) {
    context.session.csrf(body);
    return Workspace.core(context.db, context.session);
}

// OrganizationController::index CoreERP untuk tiga layar organisasi. Tanpa `incremental`, jawabannya props
// halaman; dengan `incremental`, satu batch daftar.
async function page(context: Context, section: Section) {
    const workspace = await coreWorkspace(context);
    workspace.guard('organization', 'read');
    const organizations = new Organizations(context.db, workspace);
    const hierarchies = new OrganizationHierarchies(context.db, workspace);
    const parameters = new URL(context.request.url).searchParams;
    if (truthy(parameters.get('incremental'))) {
        const resource = parameters.get('resource') || null;
        const excluded = parameters.get('exclude_version_id') || null;
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
        if (section === 'hierarchies' && resource !== 'organizations') {
            const recordId = parameters.get('record_id') || null;
            if (recordId === null)
                return ok(await hierarchies.batch(parameters));
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
        return ok(
            await organizations.batch(
                parameters,
                section === 'hierarchies'
                    ? {
                          activeOnly: true,
                          excludeVersionId: excluded
                              ? await hierarchies.ownVersion(excluded)
                              : null,
                      }
                    : {
                          classification:
                              section === 'legal-entities'
                                  ? 'legal_entity'
                                  : 'operating_unit',
                      },
            ),
        );
    }
    const props = {
        scopeKey: workspace.tenantId,
        canManage: organizations.canManage,
        operatingUnitTypes,
        organizations: [],
    };
    return ok(
        section === 'hierarchies'
            ? {
                  ...props,
                  hierarchies: [],
                  purposes: await hierarchies.purposes(),
              }
            : { ...props, timezones: timezoneOptions() },
    );
}

export function organizationRoutes() {
    const sectionPage = (path: `/${string}`, section: Section) =>
        base
            .route({ method: 'GET', path, outputStructure: 'detailed' })
            .handler(({ context }) => page(context, section));
    return {
        legalEntityPage: sectionPage(
            '/api/v1/settings/legal-entities',
            'legal-entities',
        ),
        operatingUnitPage: sectionPage(
            '/api/v1/settings/operating-units',
            'operating-units',
        ),
        hierarchyPage: sectionPage(
            '/api/v1/settings/organization-hierarchies',
            'hierarchies',
        ),
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
