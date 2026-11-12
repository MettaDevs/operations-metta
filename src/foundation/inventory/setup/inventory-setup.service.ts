import type { Workspace } from '../../../platform/access/index.ts';
import { nowSql, type Database } from '../../../platform/database/index.ts';
import {
    abort,
    coded,
    lookupId,
    staleMessage,
} from '../../../platform/http/index.ts';
import {
    activeLegalEntity,
    parseInput,
    violates,
} from '../inventory.service.ts';
import {
    inventorySetupInputSchema,
    inventorySetupRowSchema,
    unitSetupInputSchema,
    unitSetupRowSchema,
} from './inventory-setup.schema.ts';

const messages = {
    picking_method:
        'Pilih cara pengambilan: FEFO, FIFO, atau pilih batch manual.',
    refuse_negative_stock: 'Pilih apakah stok minus ditolak.',
    transfer_mode: 'Pilih cara mutasi: langsung, atau kirim lalu terima.',
    costing_method: 'Metode harga pokok yang tersedia baru FIFO.',
    version: 'Muat ulang parameter, lalu ulangi perubahanmu.',
};

// Baris parameter lahir bersama legal entity (trigger gd_isi_acuan di migration 0024), jadi di sini hanya dibaca dan
// diubah.
export class InventorySetup {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private async row() {
        const found = await this.db.one(
            inventorySetupRowSchema,
            `select metode_pengambilan as picking_method, tolak_stok_minus as refuse_negative_stock,
                    cara_mutasi as transfer_mode, metode_harga_pokok as costing_method, version
             from gd_m_parameter where tenant_id = $1 and legal_entity_id = $2`,
            [this.workspace.tenantId, activeLegalEntity(this.workspace)],
        );
        if (!found) abort(404, 'Not Found');
        return found;
    }

    async show() {
        this.workspace.guard('inventory-setup', 'read');
        return {
            data: await this.row(),
            can_manage: this.workspace.permissions.has(
                'core.inventory-setup.update',
            ),
        };
    }

    async update(body: unknown) {
        this.workspace.guard('inventory-setup', 'update');
        const data = parseInput(inventorySetupInputSchema, body, messages);
        const updated = await this.db.execute(
            `update gd_m_parameter set metode_pengambilan = $1, tolak_stok_minus = $2, cara_mutasi = $3, updated_at = $4
             where tenant_id = $5 and legal_entity_id = $6 and version = $7`,
            [
                data.picking_method,
                data.refuse_negative_stock,
                data.transfer_mode,
                nowSql(),
                this.workspace.tenantId,
                activeLegalEntity(this.workspace),
                data.version,
            ],
        );
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { data: await this.row() };
    }

    private async units(unitId: string | null) {
        return this.db.rows(
            unitSetupRowSchema,
            `select json_build_object('id', o.id, 'name', o.name) as operating_unit,
                    u.metode_pengambilan as picking_method, u.version
             from organizations o
             left join gd_m_parameter_unit u on u.tenant_id = o.tenant_id and u.legal_entity_id = $2
                  and u.operating_unit_id = o.id
             where o.tenant_id = $1 and o.classification = 'operating_unit' and o.status = 'active'
               and ($3::uuid is null or o.id = $3)
             order by o.name, o.id`,
            [
                this.workspace.tenantId,
                activeLegalEntity(this.workspace),
                unitId,
            ],
        );
    }

    async unitList() {
        this.workspace.guard('inventory-setup', 'read');
        return {
            data: await this.units(null),
            can_manage: this.workspace.permissions.has(
                'core.inventory-setup.update',
            ),
        };
    }

    // Baris timpaan dibuat saat unit pertama kali diubah (version kosong), lalu diubah dengan versinya.
    async unitUpdate(unitId: string, body: unknown) {
        this.workspace.guard('inventory-setup', 'update');
        const [unit] = lookupId(unitId) ? await this.units(unitId) : [];
        if (!unit) abort(404, 'Not Found');
        const data = parseInput(unitSetupInputSchema, body, messages);
        const legalEntityId = activeLegalEntity(this.workspace);
        const stamp = nowSql();
        let written = 0;
        if (data.version === null) {
            try {
                written = await this.db.execute(
                    `insert into gd_m_parameter_unit (id, tenant_id, legal_entity_id, operating_unit_id,
                                                      metode_pengambilan, created_at, updated_at)
                     values ($1, $2, $3, $4, $5, $6, $6)`,
                    [
                        Bun.randomUUIDv7(),
                        this.workspace.tenantId,
                        legalEntityId,
                        unit.operating_unit.id,
                        data.picking_method,
                        stamp,
                    ],
                );
            } catch (error) {
                if (!violates(error, 'gd_m_parameter_unit_unique')) throw error;
            }
        } else
            written = await this.db.execute(
                `update gd_m_parameter_unit set metode_pengambilan = $1, updated_at = $2
                 where tenant_id = $3 and legal_entity_id = $4 and operating_unit_id = $5 and version = $6`,
                [
                    data.picking_method,
                    stamp,
                    this.workspace.tenantId,
                    legalEntityId,
                    unit.operating_unit.id,
                    data.version,
                ],
            );
        if (!written) coded(409, 'stale_version', staleMessage);
        const [saved] = await this.units(unit.operating_unit.id);
        if (!saved) abort(404, 'Not Found');
        return { data: saved };
    }
}
