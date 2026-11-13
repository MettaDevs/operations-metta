import type { z } from 'zod';
import type { Workspace } from '@core/platform/access/index.ts';
import {
    nowSql,
    sqlErrorCode,
    type Database,
} from '@core/platform/database/index.ts';
import { coded, staleMessage } from '@core/platform/http/index.ts';
import {
    activeLegalEntity,
    parseInput,
} from '@core/foundation/inventory/index.ts';
import {
    pharmacySetupInputSchema,
    pharmacySetupRowSchema,
} from './pharmacy-setup.schema.ts';

type Scope = { tenantId: string; legalEntityId: string };

// Legal entity tanpa baris setelan memakai nilai bawaan kolomnya: harga satuan obat dibulatkan ke rupiah utuh, seperti
// Kuta 1 dan Penta.
export async function pharmacySetup(
    db: Database,
    scope: Scope,
): Promise<z.infer<typeof pharmacySetupRowSchema>> {
    return (
        (await db.one(
            pharmacySetupRowSchema,
            `select desimal_harga_satuan as unit_price_decimals, version
             from far_m_parameter where tenant_id = $1 and legal_entity_id = $2`,
            [scope.tenantId, scope.legalEntityId],
        )) ?? { unit_price_decimals: 0, version: null }
    );
}

// Setelan farmasi legal entity tempat kerja. Memakai izin harga obat, karena isinya aturan harga obat.
export class PharmacySetup {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private get scope(): Scope {
        return {
            tenantId: this.workspace.tenantId,
            legalEntityId: activeLegalEntity(this.workspace),
        };
    }

    async show() {
        this.workspace.guard('drug-price', 'read');
        return {
            data: await pharmacySetup(this.db, this.scope),
            can_manage: this.workspace.permissions.has(
                'pharmacy.drug-price.update',
            ),
        };
    }

    // Baris dibuat saat setelan pertama kali disimpan (version kosong), lalu diubah dengan versinya. Baris yang sudah
    // dibuat orang lain, atau versi yang sudah berubah sejak dibaca, ditolak sebagai versi basi.
    async update(body: unknown) {
        this.workspace.guard('drug-price', 'update');
        const data = parseInput(pharmacySetupInputSchema, body, {
            unit_price_decimals:
                'Pilih banyak angka di belakang koma, 0 sampai 4.',
            version: 'Muat ulang setelan, lalu ulangi perubahanmu.',
        });
        const scope = this.scope;
        const stamp = nowSql();
        let written = 0;
        if (data.version !== null)
            written = await this.db.execute(
                `update far_m_parameter set desimal_harga_satuan = $1, updated_at = $2
                 where tenant_id = $3 and legal_entity_id = $4 and version = $5`,
                [
                    data.unit_price_decimals,
                    stamp,
                    scope.tenantId,
                    scope.legalEntityId,
                    data.version,
                ],
            );
        else
            try {
                written = await this.db.execute(
                    `insert into far_m_parameter (id, tenant_id, legal_entity_id, desimal_harga_satuan, created_at,
                                                  updated_at)
                     values ($1, $2, $3, $4, $5, $5)`,
                    [
                        Bun.randomUUIDv7(),
                        scope.tenantId,
                        scope.legalEntityId,
                        data.unit_price_decimals,
                        stamp,
                    ],
                );
            } catch (error) {
                if (!(
                    sqlErrorCode(error) === '23505' &&
                    error instanceof Error &&
                    error.message.includes(
                        'far_m_parameter_legal_entity_unique',
                    )
                ))
                    throw error;
            }
        if (!written) coded(409, 'stale_version', staleMessage);
        return { data: await pharmacySetup(this.db, scope) };
    }
}
