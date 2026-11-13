import { z } from 'zod';
import type { Workspace } from '../../../platform/access/index.ts';
import {
    isReferenced,
    nowSql,
    sqlErrorCode,
    type Database,
} from '../../../platform/database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '../../../platform/http/index.ts';
import { activeLegalEntity } from '../../inventory/index.ts';
import { isDiscountKind } from '../payment/payment.discount.ts';
import { discountInputSchema, discountRowSchema } from './discount.schema.ts';

const rowSql = `select * from (
                    select d.id, d.kode as code, d.nama as name, d.jenis as kind,
                           d.komponen_biaya_id as charge_component_id, k.nama as charge_component_name,
                           d.kelompok_jasa_id as service_group_id, d.kelompok_jasa_nama as service_group_name,
                           d.aktif as is_active, d.version
                    from discount d
                    left join komponen_biaya k on k.tenant_id = d.tenant_id and k.id = d.komponen_biaya_id
                    where d.tenant_id = $1 and d.legal_entity_id = $2 and d.deleted_at is null) discounts
                where true`;

// Kelompok jasa yang sudah dikirim layanan kesehatan bersama baris biaya, nama terakhirnya.
const serviceGroupsSql = `select distinct on (kelompok_jasa_id) kelompok_jasa_id as id, kelompok_jasa_nama as name
                          from kunjungan_kasir_detail
                          where tenant_id = $1 and legal_entity_id = $2 and kelompok_jasa_id is not null
                            and kelompok_jasa_nama is not null
                          order by kelompok_jasa_id, updated_at desc`;

function checked(body: unknown) {
    const parsed = discountInputSchema.safeParse(body);
    const errors: Record<string, string> = {};
    const data = parsed.success ? parsed.data : null;
    const code = data?.code.trim().toUpperCase() ?? '';
    const name = data?.name.trim() ?? '';
    const kind = data?.kind ?? '';
    if (!code) errors.code = 'Isi kode diskon.';
    else if (code.length > 20)
        errors.code = 'Kode diskon paling banyak 20 karakter.';
    if (!name) errors.name = 'Isi nama diskon.';
    else if (name.length > 100)
        errors.name = 'Nama diskon paling banyak 100 karakter.';
    if (!isDiscountKind(kind)) errors.kind = 'Pilih jenis diskon dari daftar.';
    const componentId =
        kind === 'komponen' ? data?.charge_component_id?.trim() || null : null;
    const serviceGroupId =
        kind === 'kelompok_jasa'
            ? data?.service_group_id?.trim() || null
            : null;
    if (kind === 'komponen' && !componentId)
        errors.charge_component_id = 'Pilih komponen biaya.';
    if (kind === 'kelompok_jasa' && !serviceGroupId)
        errors.service_group_id = 'Pilih kelompok jasa.';
    if (Object.keys(errors).length || !data || !isDiscountKind(kind))
        validation(errors);
    return {
        kode: code,
        nama: name,
        jenis: kind,
        komponen_biaya_id: componentId,
        kelompok_jasa_id: serviceGroupId,
        aktif: data.is_active ?? true,
    };
}

function codeTaken(error: unknown): void {
    if (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes('discount_kode_unique')
    )
        validation({ code: 'Kode ini sudah dipakai diskon lain.' });
}

export class Discounts {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    // Dibaca sesudah izin diperiksa, supaya anggota tanpa izin mendapat 403, bukan permintaan memilih legal entity.
    private get scope() {
        return {
            tenantId: this.workspace.tenantId,
            legalEntityId: activeLegalEntity(this.workspace),
        };
    }

    // `active=1` hanya diskon yang aktif.
    async list(parameters: URLSearchParams) {
        this.workspace.guard('discount', 'read');
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${parameters.get('active') === '1' ? ' and is_active' : ''}`,
            bindings: [this.scope.tenantId, this.scope.legalEntityId],
            parameters,
            columns: { code: 'code', name: 'name' },
            searchColumns: ['code', 'name'],
            numericColumns: [],
            defaultSort: 'code',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => discountRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has('core.discount.update'),
        };
    }

    // Pilihan kartu diskon: komponen biaya Core dan kelompok jasa dari baris biaya yang sudah masuk kasir.
    async metadata() {
        this.workspace.guard('discount', 'read');
        return {
            charge_components: await this.db.rows(
                z.object({
                    id: z.string(),
                    code: z.string(),
                    name: z.string(),
                    active: z.boolean(),
                }),
                `select id, kode as code, nama as name, aktif as active from komponen_biaya
                 where tenant_id = $1 and deleted_at is null order by urutan, kode`,
                [this.scope.tenantId],
            ),
            service_groups: await this.db.rows(
                z.object({ id: z.string(), name: z.string() }),
                serviceGroupsSql,
                [this.scope.tenantId, this.scope.legalEntityId],
            ),
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  discountRowSchema,
                  `${rowSql} and discounts.id = $3`,
                  [this.scope.tenantId, this.scope.legalEntityId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    // Komponen biaya dan kelompok jasa yang dipilih harus ada; nilai yang sudah tersimpan tetap boleh dipakai.
    private async resolved(
        data: ReturnType<typeof checked>,
        saved: z.infer<typeof discountRowSchema> | null,
    ) {
        const errors: Record<string, string> = {};
        if (
            data.komponen_biaya_id !== null &&
            data.komponen_biaya_id !== saved?.charge_component_id &&
            !(
                lookupId(data.komponen_biaya_id) &&
                (await this.db.one(
                    z.object({ id: z.string() }),
                    `select id from komponen_biaya
                     where tenant_id = $1 and id = $2 and aktif and deleted_at is null`,
                    [this.scope.tenantId, data.komponen_biaya_id],
                ))
            )
        )
            errors.charge_component_id = 'Pilih komponen biaya dari daftar.';
        let serviceGroupName: string | null = null;
        if (data.kelompok_jasa_id !== null) {
            if (data.kelompok_jasa_id === saved?.service_group_id)
                serviceGroupName = saved.service_group_name;
            else if (lookupId(data.kelompok_jasa_id))
                serviceGroupName =
                    (
                        await this.db.one(
                            z.object({ name: z.string() }),
                            `select name from (${serviceGroupsSql}) groups where id = $3`,
                            [
                                this.scope.tenantId,
                                this.scope.legalEntityId,
                                data.kelompok_jasa_id,
                            ],
                        )
                    )?.name ?? null;
            if (serviceGroupName === null)
                errors.service_group_id = 'Pilih kelompok jasa dari daftar.';
        }
        if (Object.keys(errors).length) validation(errors);
        return { ...data, kelompok_jasa_nama: serviceGroupName };
    }

    async create(body: unknown) {
        this.workspace.guard('discount', 'update');
        const data = await this.resolved(checked(body), null);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('discount', {
                id,
                tenant_id: this.scope.tenantId,
                legal_entity_id: this.scope.legalEntityId,
                ...data,
                created_at: stamp,
                updated_at: stamp,
            });
        } catch (error) {
            codeTaken(error);
            throw error;
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('discount', 'update');
        const current = await this.row(id);
        const data = await this.resolved(checked(body), current);
        let updated = 0;
        try {
            const columns = Object.entries(data);
            updated = await this.db.execute(
                `update discount
                 set ${columns.map(([column], index) => `${column} = $${index + 1}`).join(', ')},
                     updated_at = $${columns.length + 1}
                 where tenant_id = $${columns.length + 2} and legal_entity_id = $${columns.length + 3}
                   and id = $${columns.length + 4} and version = $${columns.length + 5} and deleted_at is null`,
                [
                    ...columns.map(([, value]) => value),
                    nowSql(),
                    this.scope.tenantId,
                    this.scope.legalEntityId,
                    current.id,
                    expectedVersion(request, body),
                ],
            );
        } catch (error) {
            codeTaken(error);
            throw error;
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('discount', 'update');
        const current = await this.row(id);
        if (
            await isReferenced(this.db, 'discount', {
                tenantId: this.scope.tenantId,
                id: current.id,
            })
        )
            validation({
                _form: 'Diskon ini sudah dipakai pembayaran, jadi tidak bisa dihapus. Nonaktifkan saja supaya tidak dipilih lagi.',
            });
        const deleted = await this.db.execute(
            `update discount set deleted_at = $1, updated_at = $1
             where tenant_id = $2 and legal_entity_id = $3 and id = $4 and version = $5 and deleted_at is null`,
            [
                nowSql(),
                this.scope.tenantId,
                this.scope.legalEntityId,
                current.id,
                expectedVersion(request, body),
            ],
        );
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }
}
