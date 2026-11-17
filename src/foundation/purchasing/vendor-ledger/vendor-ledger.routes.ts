import { coreWorkspace } from '../../../platform/access/index.ts';
import { base, ok, typedQuery } from '../../../platform/http/index.ts';
import type { z } from 'zod';
import type { vendorLedgerQuerySchema } from './vendor-ledger.schema.ts';
import { VendorLedger } from './vendor-ledger.service.ts';

export function vendorLedgerRoutes() {
    return {
        purchasingVendorLedgerList: base
            .route({
                method: 'GET',
                path: '/api/v1/purchasing/vendor-ledger',
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(typedQuery<z.input<typeof vendorLedgerQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await new VendorLedger(
                        context.db,
                        await coreWorkspace(context),
                    ).list(new URL(context.request.url).searchParams),
                ),
            ),
    };
}
