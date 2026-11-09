import { z } from 'zod';
import { base, bodyInput, ok } from '../http/index.ts';
import { OrganizationHierarchies } from './hierarchy.service.ts';
import { coreWorkspace } from './organization.routes.ts';

const versionInput = z.object({
    params: z.object({ version: z.string() }),
    body: z.unknown(),
});
const nodeInput = z.object({
    params: z.object({ version: z.string(), node: z.string() }),
    body: z.unknown(),
});

// Di CoreERP setiap penyimpanan ini kembali ke halaman hierarchy dengan props savedHierarchy dan flash.status.
// Di sini kedua props itu langsung menjadi jawabannya.
export function hierarchyRoutes() {
    const versionPath = '/settings/organization/hierarchy-versions/{version}';
    return {
        hierarchyCreate: base
            .route({
                method: 'POST',
                path: '/settings/organization/hierarchies',
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(bodyInput)
            .handler(async ({ context, input }) =>
                ok(
                    await new OrganizationHierarchies(
                        context.db,
                        await coreWorkspace(context, input.body),
                    ).create(input.body),
                ),
            ),
        hierarchyPlace: base
            .route({
                method: 'POST',
                path: `${versionPath}/placements`,
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(versionInput)
            .handler(async ({ context, input }) =>
                ok(
                    await new OrganizationHierarchies(
                        context.db,
                        await coreWorkspace(context, input.body),
                    ).place(context.request, input.params.version, input.body),
                ),
            ),
        hierarchyUnplace: base
            .route({
                method: 'DELETE',
                path: `${versionPath}/placements/{node}`,
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(nodeInput)
            .handler(async ({ context, input }) =>
                ok(
                    await new OrganizationHierarchies(
                        context.db,
                        await coreWorkspace(context, input.body),
                    ).unplace(
                        context.request,
                        input.params.version,
                        input.params.node,
                        input.body,
                    ),
                ),
            ),
        hierarchyDraft: base
            .route({
                method: 'POST',
                path: `${versionPath}/drafts`,
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(versionInput)
            .handler(async ({ context, input }) =>
                ok(
                    await new OrganizationHierarchies(
                        context.db,
                        await coreWorkspace(context, input.body),
                    ).createDraft(
                        context.request,
                        input.params.version,
                        input.body,
                    ),
                ),
            ),
        hierarchyPublish: base
            .route({
                method: 'POST',
                path: `${versionPath}/publish`,
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(versionInput)
            .handler(async ({ context, input }) =>
                ok(
                    await new OrganizationHierarchies(
                        context.db,
                        await coreWorkspace(context, input.body),
                    ).publish(
                        context.request,
                        input.params.version,
                        input.body,
                    ),
                ),
            ),
    };
}
