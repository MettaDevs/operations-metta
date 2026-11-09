import {
    base,
    ok,
    recordInput,
    type Context,
} from '@core/platform/http/index.ts';
import { moduleId, moduleWorkspace } from '../../module.ts';
import { Inventory } from './asset.service.ts';

export function assetRoutes() {
    async function domain(context: Context) {
        return new Inventory(context.db, await moduleWorkspace(context));
    }
    const assetPath: `/${string}` = `/api/modules/${moduleId}/v1/aset`;
    return {
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
                    ).list(new URL(context.request.url).searchParams),
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
                (await domain(context)).show(input.params.id),
            ),
    };
}
