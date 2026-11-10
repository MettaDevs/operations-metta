import type { z } from 'zod';
import { coreWorkspace } from '../access/index.ts';
import { base, ok, typedQuery, type Context } from '../http/index.ts';
import type {
    divisionQuerySchema,
    hierarchyLevelQuerySchema,
    regionLookupQuerySchema,
} from './address-setup.schema.ts';
import { AddressSetup } from './address-setup.service.ts';

const path = '/api/v1/settings/address-setup';

async function addressSetup(context: Context) {
    return new AddressSetup(context.db, await coreWorkspace(context));
}
const query = (context: Context) => new URL(context.request.url).searchParams;
const read = (route: `/${string}` | '') =>
    base.route({
        method: 'GET',
        path: `${path}${route}`,
        inputStructure: 'detailed',
        outputStructure: 'detailed',
    });

// Bacaan master wilayah. Di CoreERP route ini ada di bawah `/settings/address-setup`; di sini berawalan `/api/v1`,
// karena alamat lain milik layar.
export function addressSetupRoutes() {
    return {
        // Props layar Setup alamat, dijaga izin Lihat data referensi seperti layar CoreERP.
        addressSetupPage: read('').handler(async ({ context }) =>
            ok((await addressSetup(context)).page()),
        ),
        // Pemilih wilayah di form alamat; cukup anggota aktif tenant, sama dengan CoreERP yang hanya meminta login.
        regionLookup: read('/lookup/top-down')
            .input(typedQuery<z.input<typeof regionLookupQuerySchema>>())
            .handler(async ({ context }) =>
                ok(await (await addressSetup(context)).topDown(query(context))),
            ),
        // Daftar layar Address setup, dijaga izin Lihat data referensi.
        regionSearch: read('/divisions')
            .input(typedQuery<z.input<typeof divisionQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await addressSetup(context)
                    ).divisions(query(context)),
                ),
            ),
        regionLevels: read('/hierarchy-levels')
            .input(typedQuery<z.input<typeof hierarchyLevelQuerySchema>>())
            .handler(async ({ context }) =>
                ok(
                    await (
                        await addressSetup(context)
                    ).hierarchyLevels(query(context)),
                ),
            ),
    };
}
