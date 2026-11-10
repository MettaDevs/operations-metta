import { base, ok } from '../http/index.ts';
import { coreNavigation, visibleNavigation } from './navigation.ts';
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
                const shell = await Workspace.shell(
                    context.db,
                    context.session,
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
                        coreNavigation,
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
