import { Workspace } from '@core/platform/access/index.ts';
import type { Context } from '@core/platform/http/index.ts';

// Kode app module ini di CoreERP. Route, izin, kebijakan data, dan referensi nomor diturunkan darinya.
export const moduleId = 'management-aset';

export async function moduleWorkspace(context: Context, body?: unknown) {
    context.session.csrf(body);
    return Workspace.resolve(
        context.db,
        context.session,
        moduleId,
        moduleId + '.asset-responsibility',
    );
}
