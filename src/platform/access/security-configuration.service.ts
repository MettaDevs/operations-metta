import { z } from 'zod';
import type { Database } from '../database/index.ts';
import { tenantAppIds } from './security.service.ts';
import type { Workspace } from './workspace.ts';

const ids = (start: number, count: number) =>
    Array.from({ length: count }, (_, index) => `$${start + index}`).join(',');

// Katalog keamanan yang boleh dilihat tenant, dari SecurityConfigurationController::index CoreERP: app, duty,
// privilege, dan permission milik app yang dipakai tenant, ditambah konfigurasi milik tenant itu sendiri. Graf dikirim
// ternormalisasi; setiap tingkat hanya membawa kode anaknya. Hanya baca: menyusun duty dan privilege sendiri belum
// dipindah.
export class SecurityConfiguration {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    async catalog() {
        this.workspace.guard('access', 'read');
        const tenantId = this.workspace.tenantId;
        const appIds = await tenantAppIds(this.db, tenantId);
        const apps = ids(2, appIds.length);
        const visible = (alias: string) =>
            `(${alias}.app_id in (${apps}) or ${alias}.tenant_id=$1)`;
        const [appRows, duties, privileges, permissions] = await Promise.all([
            this.db.rows(
                z.object({ id: z.string(), name: z.string() }),
                `select id, name from apps where id in (${ids(1, appIds.length)}) order by name`,
                appIds,
            ),
            this.db.rows(
                z.object({
                    code: z.string(),
                    name: z.string(),
                    description: z.string().nullable(),
                    app_id: z.string().nullable(),
                    source: z.string(),
                    status: z.string(),
                    privilege_codes: z.array(z.string()),
                }),
                `select d.code, d.name, d.description, d.app_id, d.source, d.status,
                        coalesce(array_agg(dp.privilege_code order by dp.privilege_code)
                                 filter (where dp.privilege_code is not null), '{}') as privilege_codes
                 from security_duties d left join security_duty_privileges dp on dp.duty_code=d.code
                 where ${visible('d')} group by d.code order by d.name, d.code`,
                [tenantId, ...appIds],
            ),
            this.db.rows(
                z.object({
                    code: z.string(),
                    name: z.string(),
                    description: z.string().nullable(),
                    app_id: z.string().nullable(),
                    source: z.string(),
                    status: z.string(),
                    permission_codes: z.array(z.string()),
                }),
                `select p.code, p.name, p.description, p.app_id, p.source, p.status,
                        coalesce(array_agg(pp.permission_code order by pp.permission_code)
                                 filter (where pp.permission_code is not null), '{}') as permission_codes
                 from security_privileges p left join security_privilege_permissions pp on pp.privilege_code=p.code
                 where ${visible('p')} group by p.code order by p.name, p.code`,
                [tenantId, ...appIds],
            ),
            this.db.rows(
                z.object({
                    code: z.string(),
                    name: z.string(),
                    description: z.string().nullable(),
                    app_id: z.string(),
                    access_level: z.string(),
                    entry_point_code: z.string().nullable(),
                    entry_point_name: z.string().nullable(),
                    entry_point_type: z.string().nullable(),
                }),
                `select p.code, p.name, p.description, p.app_id, p.access_level, e.code as entry_point_code,
                        e.name as entry_point_name, e.type as entry_point_type
                 from permissions p left join app_entry_points e on e.code=p.entry_point_code
                 where p.app_id in (${ids(1, appIds.length)}) order by p.name, p.code`,
                appIds,
            ),
        ]);
        return {
            canManage: this.workspace.permissions.has('core.access.update'),
            apps: appRows,
            duties,
            privileges,
            permissions: permissions.map(
                ({
                    entry_point_code,
                    entry_point_name,
                    entry_point_type,
                    ...permission
                }) => ({
                    ...permission,
                    entry_point:
                        entry_point_code === null
                            ? null
                            : {
                                  code: entry_point_code,
                                  name: entry_point_name ?? '',
                                  type: entry_point_type ?? '',
                              },
                }),
            ),
        };
    }
}
