import type { Workspace } from '../../../platform/access/index.ts';
import { nowSql, type Database } from '../../../platform/database/index.ts';
import {
    abort,
    coded,
    lookupId,
    staleMessage,
    validation,
} from '../../../platform/http/index.ts';
import { legalEntitySequences } from '../../number-sequence/index.ts';
import { adjustmentNumberReference } from '../adjustment/adjustment.service.ts';
import type { PickingMethod } from '../item-ledger/stock-policy.ts';
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
    operating_unit_id: 'Pilih operating unit dari daftar.',
};

type UnitChange = {
    operatingUnitId: string;
    picking: PickingMethod | null;
    version: number | null;
};

// Nomor dokumen persediaan yang tampil di bagian Penomoran. Reference baru ditambahkan di sini bersama dokumennya.
const numberReferences = [adjustmentNumberReference];

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
            numbering: await legalEntitySequences(
                this.db,
                this.workspace.tenantId,
                activeLegalEntity(this.workspace),
                numberReferences,
            ),
            can_manage: this.workspace.permissions.has(
                'core.inventory-setup.update',
            ),
            can_open_numbering: this.workspace.permissions.has(
                'core.number-sequence.read',
            ),
        };
    }

    // Setelan umum dan timpaan operating unit yang berubah disimpan dalam satu transaksi: satu versi yang basi
    // membatalkan semuanya, jadi layar tidak pernah melihat simpanan setengah jadi.
    async update(body: unknown) {
        this.workspace.guard('inventory-setup', 'update');
        const data = parseInput(inventorySetupInputSchema, body, messages);
        const legalEntityId = activeLegalEntity(this.workspace);
        const active = new Set(
            (await this.units(null)).map((unit) => unit.operating_unit.id),
        );
        const errors: Record<string, string> = {};
        const changes: UnitChange[] = [];
        for (const unit of data.units ?? []) {
            const field = `units.${unit.operating_unit_id}.operating_unit_id`;
            if (!active.has(unit.operating_unit_id))
                errors[field] =
                    'Operating unit ini tidak ditemukan atau sudah tidak aktif. Muat ulang halaman, lalu ulangi perubahanmu.';
            else if (
                changes.some(
                    (change) =>
                        change.operatingUnitId === unit.operating_unit_id,
                )
            )
                errors[field] = 'Operating unit ini dikirim lebih dari sekali.';
            else
                changes.push({
                    operatingUnitId: unit.operating_unit_id,
                    picking: unit.picking_method,
                    version: unit.version,
                });
        }
        if (Object.keys(errors).length) validation(errors);
        const stamp = nowSql();
        await this.db.transaction(async () => {
            const updated = await this.db.execute(
                `update gd_m_parameter set metode_pengambilan = $1, tolak_stok_minus = $2, cara_mutasi = $3, updated_at = $4
                 where tenant_id = $5 and legal_entity_id = $6 and version = $7`,
                [
                    data.picking_method,
                    data.refuse_negative_stock,
                    data.transfer_mode,
                    stamp,
                    this.workspace.tenantId,
                    legalEntityId,
                    data.version,
                ],
            );
            if (!updated) coded(409, 'stale_version', staleMessage);
            for (const change of changes)
                if (!(await this.writeUnit(legalEntityId, change, stamp)))
                    coded(409, 'stale_version', staleMessage);
        });
        return { data: await this.row(), units: await this.units(null) };
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

    async unitUpdate(unitId: string, body: unknown) {
        this.workspace.guard('inventory-setup', 'update');
        const [unit] = lookupId(unitId) ? await this.units(unitId) : [];
        if (!unit) abort(404, 'Not Found');
        const data = parseInput(unitSetupInputSchema, body, messages);
        const written = await this.writeUnit(
            activeLegalEntity(this.workspace),
            {
                operatingUnitId: unit.operating_unit.id,
                picking: data.picking_method,
                version: data.version,
            },
            nowSql(),
        );
        if (!written) coded(409, 'stale_version', staleMessage);
        const [saved] = await this.units(unit.operating_unit.id);
        if (!saved) abort(404, 'Not Found');
        return { data: saved };
    }

    // Baris timpaan dibuat saat unit pertama kali diubah (version kosong), lalu diubah dengan versinya. 0 berarti
    // versinya basi: baris sudah dibuat orang lain, atau sudah diubah sejak dibaca. Di dalam transaksi, pemanggil
    // langsung menolak tanpa perintah SQL berikutnya, karena transaksi PostgreSQL sudah batal setelah pelanggaran unik.
    private async writeUnit(
        legalEntityId: string,
        change: UnitChange,
        stamp: string,
    ): Promise<number> {
        if (change.version !== null)
            return this.db.execute(
                `update gd_m_parameter_unit set metode_pengambilan = $1, updated_at = $2
                 where tenant_id = $3 and legal_entity_id = $4 and operating_unit_id = $5 and version = $6`,
                [
                    change.picking,
                    stamp,
                    this.workspace.tenantId,
                    legalEntityId,
                    change.operatingUnitId,
                    change.version,
                ],
            );
        try {
            return await this.db.execute(
                `insert into gd_m_parameter_unit (id, tenant_id, legal_entity_id, operating_unit_id,
                                                  metode_pengambilan, created_at, updated_at)
                 values ($1, $2, $3, $4, $5, $6, $6)`,
                [
                    Bun.randomUUIDv7(),
                    this.workspace.tenantId,
                    legalEntityId,
                    change.operatingUnitId,
                    change.picking,
                    stamp,
                ],
            );
        } catch (error) {
            if (!violates(error, 'gd_m_parameter_unit_unique')) throw error;
            return 0;
        }
    }
}
