import type { z } from 'zod';
import { coreWorkspace } from '../../../platform/access/index.ts';
import { ok, typedQuery } from '../../../platform/http/index.ts';
import { route, searchParams } from '../inventory.routes.ts';
import type {
    ledgerQuerySchema,
    stockQuerySchema,
} from './item-ledger.schema.ts';
import { ItemLedger } from './item-ledger.service.ts';

export function itemLedgerRoutes() {
    return {
        inventoryStock: route('GET', '/api/v1/inventory/stock')
            .input(typedQuery<z.input<typeof stockQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await new ItemLedger(
                        context.db,
                        await coreWorkspace(context),
                    ).stock(searchParams(context)),
                ),
            ),
        inventoryItemLedgerEntries: route(
            'GET',
            '/api/v1/inventory/item-ledger-entries',
        )
            .input(typedQuery<z.input<typeof ledgerQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await new ItemLedger(
                        context.db,
                        await coreWorkspace(context),
                    ).ledger(searchParams(context)),
                ),
            ),
    };
}
