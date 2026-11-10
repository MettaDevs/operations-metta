import { z } from 'zod';
import { base, ok } from '../http/index.ts';
import {
    coreNavigation,
    navigationGroupSchema,
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
                // Menu module datang dari apps.navigation yang ditulis migration module-nya, jadi Core tidak menulis
                // nama atau label module mana pun.
                const moduleNavigation = (
                    await context.db.rows(
                        z.object({ navigation: z.unknown() }),
                        "select navigation from apps where id <> 'core' and navigation is not null order by id",
                    )
                ).flatMap(
                    (row) =>
                        z.array(navigationGroupSchema).safeParse(row.navigation)
                            .data ?? [],
                );
                const shell = await Workspace.shell(
                    context.db,
                    context.session,
                    moduleNavigation.flatMap((group) =>
                        group.items.flatMap((item) =>
                            item.permission ? [item.permission] : [],
                        ),
                    ),
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
                        [...coreNavigation, ...moduleNavigation],
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
