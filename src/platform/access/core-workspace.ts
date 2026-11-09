import type { Context } from '../http/index.ts';
import { Workspace } from './workspace.ts';

// Tenant aktif untuk fitur Core. Izinnya diperiksa per route lewat guard(). CSRF diperiksa untuk setiap request yang
// mengubah data; GET dilewati oleh Session.csrf sendiri.
export async function coreWorkspace(
    context: Context,
    body?: unknown,
): Promise<Workspace> {
    context.session.csrf(body);
    return Workspace.core(context.db, context.session);
}
