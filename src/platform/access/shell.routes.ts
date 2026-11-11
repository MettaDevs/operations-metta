import { z } from 'zod';
import { base, ok } from '../http/index.ts';
import {
    navigationGroupSchema,
    sysAdminArea,
    visibleNavigation,
} from './navigation.ts';
import { Workspace } from './workspace.ts';

const organization = (item: {
    id: string;
    name: string;
    classification: 'legal_entity' | 'operating_unit';
}) => ({ id: item.id, name: item.name, classification: item.classification });

// Data bersama Shell, pengganti shared props HandleInertiaRequests CoreERP: pengguna, workspace aktif beserta
// pilihannya, dan menu yang sudah disaring izin. Nama field mengikuti CoreERP supaya komponen Shell pindah apa adanya.
export function shellRoutes() {
    return {
        shell: base
            .route({
                method: 'GET',
                path: '/api/v1/shell',
                outputStructure: 'detailed',
            })
            .handler(async ({ context }) => {
                // Satu aplikasi per module di katalog, dengan nama dari baris apps dan kelompok dari apps.navigation yang ditulis
                // migration module-nya, jadi Core tidak menulis nama atau label module mana pun.
                const moduleAreas = (
                    await context.db.rows(
                        z.object({
                            id: z.string(),
                            name: z.string(),
                            navigation: z.unknown(),
                        }),
                        "select id, name, navigation from apps where id <> 'core' and navigation is not null order by id",
                    )
                ).map((row) => ({
                    id: row.id,
                    label: row.name,
                    groups:
                        z.array(navigationGroupSchema).safeParse(row.navigation)
                            .data ?? [],
                }));
                const shell = await Workspace.shell(
                    context.db,
                    context.session,
                    moduleAreas.flatMap((area) =>
                        area.groups.flatMap((group) =>
                            group.items.flatMap((item) =>
                                item.permission ? [item.permission] : [],
                            ),
                        ),
                    ),
                );
                // Module hanya tampil di katalog bila tenant aktif berhak memakainya dan module itu sudah terpasang
                // (core_module_installations). Entitlement saja tidak cukup: migration module belum tentu berjalan.
                const usable = new Set(
                    shell.membership
                        ? (
                              await context.db.rows(
                                  z.object({ module_id: z.string() }),
                                  `select i.module_id from core_module_installations i
                                   where i.tenant_id = $1 and i.status = 'installed'
                                     and exists (select 1 from tenant_app_entitlements e
                                                 where e.tenant_id = i.tenant_id and e.app_id = i.module_id and e.status = 'active'
                                                   and (e.ends_at is null or e.ends_at > current_timestamp))`,
                                  [shell.membership.tenant_id],
                              )
                          ).map((row) => row.module_id)
                        : [],
                );
                return ok({
                    auth: {
                        user: {
                            id: shell.user.id,
                            name: shell.user.name,
                            email: shell.user.email,
                        },
                        membership: shell.membership,
                    },
                    workspace: {
                        memberships: shell.memberships,
                        active_legal_entity: shell.legalEntity
                            ? organization(shell.legalEntity)
                            : null,
                        active_org_unit: shell.orgUnit
                            ? organization(shell.orgUnit)
                            : null,
                        legal_entities: shell.legalEntities.map(organization),
                        org_units: shell.orgUnits.map(organization),
                    },
                    navigation: visibleNavigation(
                        [
                            sysAdminArea,
                            ...moduleAreas.filter((area) =>
                                usable.has(area.id),
                            ),
                        ],
                        shell.permissions,
                    ),
                    environment: context.session.environment
                        ? {
                              kind: context.session.environment.kind,
                              name: context.session.environment.name,
                          }
                        : null,
                });
            }),
    };
}
