import { Workspace } from '@core/platform/access/index.ts';
import type { Context } from '@core/platform/http/index.ts';

// Kode app module ini. Route, izin, kebijakan data, peran party, dan reference nomor diturunkan darinya.
export const moduleId = 'healthcare';
// Kebijakan data pasien per unit kerja (app_data_policies), dipasang migration module ini.
export const patientPolicy = `${moduleId}.patient-unit`;

export async function moduleWorkspace(context: Context, body?: unknown) {
    context.session.csrf(body);
    return Workspace.resolve(
        context.db,
        context.session,
        moduleId,
        patientPolicy,
    );
}
