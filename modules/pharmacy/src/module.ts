import { Workspace } from '@core/platform/access/index.ts';
import type { Context } from '@core/platform/http/index.ts';

// Kode app module ini. Route, izin, menu, dan reference nomor diturunkan darinya.
export const moduleId = 'pharmacy';

// Tahap ini tidak menyatakan kebijakan data per unit kerja: resep dan setelan dibatasi legal entity tempat kerja dan
// izin duty, sama dengan dokumen persediaan Core. Pembatasan per lokasi atau unit dicatat sebagai gap di README.
export async function moduleWorkspace(context: Context, body?: unknown) {
    context.session.csrf(body);
    return Workspace.resolve(context.db, context.session, moduleId, moduleId);
}
