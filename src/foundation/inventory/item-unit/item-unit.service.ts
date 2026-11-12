import { z } from 'zod';
import type { Workspace } from '../../../platform/access/index.ts';
import { nowSql, type Database } from '../../../platform/database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '../../../platform/http/index.ts';
import {
    activeLegalEntity,
    exists,
    parseInput,
    violates,
} from '../inventory.service.ts';
import { decimalInput, quantityScale, toNumeric } from '../quantity.ts';
import { itemUnitInputSchema, itemUnitRowSchema } from './item-unit.schema.ts';

// Satuan dasar ditulis sebagai baris pertama dengan isi 1. Satuan kemasan yang kebetulan sama dengan satuan dasar
// (satuan dasar barang diganti sesudahnya) tidak ditampilkan, supaya satu satuan hanya punya satu isi.
const unitsSql = `select * from (
                      select s.id, null::uuid as entry_id, b.id as item_id, s.kode as code, s.nama as name,
                             1::numeric as conversion, '1' as quantity_per_unit, true as is_base, 0 as version
                      from gd_m_barang b
                      join gd_m_satuan s on s.tenant_id = b.tenant_id and s.id = b.satuan_dasar_id
                      where b.tenant_id = $1 and b.legal_entity_id = $2 and b.id = $3 and b.deleted_at is null
                      union all
                      select s.id, k.id, k.barang_id, s.kode, s.nama, k.konversi, trim_scale(k.konversi)::text,
                             false, k.version
                      from gd_m_barang_satuan k
                      join gd_m_barang b on b.tenant_id = k.tenant_id and b.id = k.barang_id and b.deleted_at is null
                      join gd_m_satuan s on s.tenant_id = k.tenant_id and s.id = k.satuan_id
                      where k.tenant_id = $1 and k.legal_entity_id = $2 and k.barang_id = $3 and k.deleted_at is null
                        and k.satuan_id <> b.satuan_dasar_id) units
                  where true`;

const messages = {
    item_id: 'Pilih barang dari daftar.',
    unit_id: 'Pilih satuan dari daftar.',
    quantity_per_unit: 'Isi jumlah satuan dasar dalam satu satuan ini.',
};

const storedSchema = z.object({
    id: z.string(),
    item_id: z.string(),
    version: z.number(),
});

export class ItemUnits {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private get scope() {
        return {
            tenantId: this.workspace.tenantId,
            legalEntityId: activeLegalEntity(this.workspace),
        };
    }

    private async item(id: string) {
        if (!(await exists(this.db, 'gd_m_barang', this.scope, id)))
            validation({ item_id: messages.item_id });
        return id;
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('inventory-item', 'read');
        const itemId = await this.item(parameters.get('item_id') ?? '');
        const batch = await incrementalList(this.db, {
            query: unitsSql,
            bindings: [this.scope.tenantId, this.scope.legalEntityId, itemId],
            parameters,
            columns: {
                quantity_per_unit: 'conversion',
                code: 'code',
                name: 'name',
            },
            searchColumns: ['code', 'name'],
            numericColumns: ['conversion'],
            defaultSort: 'quantity_per_unit',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => itemUnitRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has(
                'core.inventory-item.update',
            ),
        };
    }

    private async row(entryId: string) {
        const stored = await this.stored(entryId);
        const found = await this.db.one(
            itemUnitRowSchema,
            `${unitsSql} and units.entry_id = $4`,
            [
                this.scope.tenantId,
                this.scope.legalEntityId,
                stored.item_id,
                entryId,
            ],
        );
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private async stored(entryId: string) {
        const found = lookupId(entryId)
            ? await this.db.one(
                  storedSchema,
                  `select id, barang_id as item_id, version from gd_m_barang_satuan
                   where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null`,
                  [this.scope.tenantId, this.scope.legalEntityId, entryId],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private async checked(body: unknown, itemId: string | null) {
        const data = parseInput(itemUnitInputSchema, body, messages);
        const errors: Record<string, string> = {};
        if (itemId !== null && data.item_id !== itemId)
            errors.item_id =
                'Barang satuan kemasan tidak bisa diganti. Hapus satuan ini, lalu buat di barang yang benar.';
        const item = lookupId(data.item_id)
            ? await this.db.one(
                  z.object({ base_unit_id: z.string() }),
                  `select satuan_dasar_id as base_unit_id from gd_m_barang
                   where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null`,
                  [this.scope.tenantId, this.scope.legalEntityId, data.item_id],
              )
            : undefined;
        if (!item) errors.item_id = messages.item_id;
        if (!(await exists(this.db, 'gd_m_satuan', this.scope, data.unit_id)))
            errors.unit_id = messages.unit_id;
        else if (item?.base_unit_id === data.unit_id)
            errors.unit_id =
                'Satuan ini satuan dasar barang, yang isinya selalu 1. Pilih satuan kemasan lain.';
        const conversion = decimalInput(data.quantity_per_unit);
        if (conversion === null || conversion <= 0n)
            errors.quantity_per_unit =
                'Isi jumlah lebih dari 0, paling banyak empat angka di belakang koma.';
        if (Object.keys(errors).length || conversion === null)
            validation(errors);
        return {
            itemId: data.item_id,
            unitId: data.unit_id,
            conversion: toNumeric(conversion, quantityScale),
        };
    }

    private unitTaken(error: unknown): void {
        if (violates(error, 'gd_m_barang_satuan_unique'))
            validation({
                unit_id: 'Satuan ini sudah ada di barang ini.',
            });
    }

    async create(body: unknown) {
        this.workspace.guard('inventory-item', 'update');
        const data = await this.checked(body, null);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('gd_m_barang_satuan', {
                id,
                tenant_id: this.scope.tenantId,
                legal_entity_id: this.scope.legalEntityId,
                barang_id: data.itemId,
                satuan_id: data.unitId,
                konversi: data.conversion,
                created_at: stamp,
                updated_at: stamp,
            });
        } catch (error) {
            this.unitTaken(error);
            throw error;
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    // Baris dokumen menyalin isinya saat disimpan, jadi mengubah isi tidak mengubah dokumen yang sudah ada.
    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-item', 'update');
        const current = await this.stored(id);
        const data = await this.checked(body, current.item_id);
        let updated = 0;
        try {
            updated = await this.db.execute(
                `update gd_m_barang_satuan set satuan_id = $1, konversi = $2, updated_at = $3
                 where tenant_id = $4 and id = $5 and version = $6 and deleted_at is null`,
                [
                    data.unitId,
                    data.conversion,
                    nowSql(),
                    this.scope.tenantId,
                    current.id,
                    expectedVersion(request, body),
                ],
            );
        } catch (error) {
            this.unitTaken(error);
            throw error;
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-item', 'update');
        const current = await this.stored(id);
        const deleted = await this.db.execute(
            `update gd_m_barang_satuan set deleted_at = $1, updated_at = $1
             where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null`,
            [
                nowSql(),
                this.scope.tenantId,
                current.id,
                expectedVersion(request, body),
            ],
        );
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }
}
