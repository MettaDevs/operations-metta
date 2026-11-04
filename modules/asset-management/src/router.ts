import {
    base,
    bodyInput,
    mutationInput,
    ok,
    recordInput,
    type Context,
} from '@core/platform/rpc.ts';
import { Workspace } from '@core/platform/security.ts';
import { Receipts } from './receipts.ts';

// Kode app module ini di CoreERP. Route, izin, kebijakan data, dan referensi nomor diturunkan darinya.
const moduleId = 'management-aset';

export function assetManagementRoutes() {
    async function domain(context: Context, body?: unknown) {
        context.session.csrf(body);
        const workspace = await Workspace.resolve(
            context.db,
            context.session,
            moduleId,
            moduleId + '.asset-responsibility',
        );
        return new Receipts(context.db, workspace);
    }
    const receiptPath: `/${string}` = `/api/modules/${moduleId}/v1/penerimaan-aset`;
    const assetPath: `/${string}` = `/api/modules/${moduleId}/v1/aset`;
    return {
        receiptList: base
            .route({
                method: 'GET',
                path: receiptPath,
                outputStructure: 'detailed',
            })
            .handler(async ({ context }) =>
                ok(
                    await (
                        await domain(context)
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
        receiptCreate: base
            .route({
                method: 'POST',
                path: receiptPath,
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(bodyInput)
            .handler(async ({ context, input }) =>
                (await domain(context, input.body)).create(
                    context.request,
                    input.body,
                ),
            ),
        receiptShow: base
            .route({
                method: 'GET',
                path: `${receiptPath}/{id}`,
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(recordInput)
            .handler(async ({ context, input }) =>
                (await domain(context)).show(input.params.id),
            ),
        receiptUpdate: base
            .route({
                method: 'PATCH',
                path: `${receiptPath}/{id}`,
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(mutationInput)
            .handler(async ({ context, input }) =>
                (await domain(context, input.body)).update(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        receiptComplete: base
            .route({
                method: 'POST',
                path: `${receiptPath}/{id}/selesaikan`,
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(mutationInput)
            .handler(async ({ context, input }) =>
                (await domain(context, input.body)).complete(
                    context.request,
                    input.params.id,
                    input.body,
                ),
            ),
        receiptPreview: base
            .route({
                method: 'GET',
                path: `${receiptPath}/{id}/pratinjau-posting`,
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(recordInput)
            .handler(async ({ context, input }) =>
                ok(await (await domain(context)).preview(input.params.id)),
            ),
        receiptAssets: base
            .route({
                method: 'GET',
                path: `${receiptPath}/{id}/aset`,
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(recordInput)
            .handler(async ({ context, input }) =>
                ok(await (await domain(context)).assets(input.params.id)),
            ),
        assetList: base
            .route({
                method: 'GET',
                path: assetPath,
                outputStructure: 'detailed',
            })
            .handler(async ({ context }) =>
                ok(
                    await (
                        await domain(context)
                    ).inventory.list(new URL(context.request.url).searchParams),
                ),
            ),
        assetShow: base
            .route({
                method: 'GET',
                path: `${assetPath}/{id}`,
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(recordInput)
            .handler(async ({ context, input }) =>
                (await domain(context)).inventory.show(input.params.id),
            ),
    };
}
