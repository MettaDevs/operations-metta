import { z } from 'zod';
import type { Workspace } from '@core/platform/access/index.ts';
import {
    Parties,
    registerPartyRole,
} from '@core/platform/address-book/index.ts';
import {
    nowSql,
    sqlErrorCode,
    type Database,
} from '@core/platform/database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '@core/platform/http/index.ts';
import { moduleId } from '../../module.ts';
import {
    guarantorInputSchema,
    guarantorRowSchema,
} from './guarantor.schema.ts';

export const guarantorRole = `${moduleId}.guarantor`;

const rowSql = `select g.id, g.party_id, p.name, g.tipe_pasien_id as patient_type_id, t.nama as patient_type_name,
                       g.aktif as is_active, g.bawaan as is_default, g.version
                from sim_m_penjamin g
                join parties p on p.tenant_id = g.tenant_id and p.id = g.party_id
                join sim_m_tipe_pasien t on t.tenant_id = g.tenant_id and t.id = g.tipe_pasien_id
                where g.tenant_id = $1 and g.deleted_at is null`;

function taken(error: unknown): void {
    if (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes('sim_m_penjamin_party_tipe_unique')
    )
        validation({
            patient_type_id:
                'Penjamin ini sudah terdaftar untuk tipe pasien yang dipilih.',
        });
    if (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes('sim_m_penjamin_bawaan_unique')
    )
        validation({
            is_default:
                'Penjamin lain baru saja dijadikan bawaan tipe pasien ini. Muat ulang, lalu coba lagi.',
        });
}

// Penjamin cara bayar pasien. Identitasnya party organisasi di buku alamat; tabel module hanya mencatat untuk tipe
// pasien mana ia menjamin.
export class Guarantors {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    // Daftar bertahap, dipakai juga pilihan penjamin di form pasien, jadi pemegang izin lihat pasien ikut boleh
    // membacanya. `patient_type_id` menyaring penjamin satu tipe pasien, dan `active=1` hanya yang aktif.
    async list(parameters: URLSearchParams) {
        if (
            !this.workspace.permissions.has('healthcare.guarantor.read') &&
            !this.workspace.permissions.has('healthcare.patient.read')
        )
            abort(403, 'Tidak diizinkan.');
        const bindings: (string | null)[] = [this.workspace.tenantId];
        const filters: string[] = [];
        const type = lookupId(parameters.get('patient_type_id') ?? '');
        if (type) {
            bindings.push(type);
            filters.push(`g.tipe_pasien_id = $${bindings.length}`);
        }
        if (parameters.get('active') === '1') filters.push('g.aktif');
        const batch = await incrementalList(this.db, {
            query: `select * from (${rowSql}${filters.map((filter) => ` and ${filter}`).join('')}) guarantors`,
            bindings,
            parameters,
            columns: { name: 'name', patient_type_name: 'patient_type_name' },
            searchColumns: ['name', 'patient_type_name'],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => guarantorRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has(
                'healthcare.guarantor.update',
            ),
        };
    }

    async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(guarantorRowSchema, `${rowSql} and g.id = $2`, [
                  this.workspace.tenantId,
                  id,
              ])
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private async patientType(id: string | undefined): Promise<string> {
        const found =
            id && lookupId(id)
                ? await this.db.one(
                      z.object({ id: z.string() }),
                      'select id from sim_m_tipe_pasien where tenant_id = $1 and id = $2 and deleted_at is null',
                      [this.workspace.tenantId, id],
                  )
                : undefined;
        if (!found)
            validation({ patient_type_id: 'Pilih tipe pasien dari daftar.' });
        return found.id;
    }

    async create(body: unknown) {
        this.workspace.guard('guarantor', 'update');
        const parsed = guarantorInputSchema.safeParse(body);
        const data = parsed.success ? parsed.data : null;
        const legalEntityId = this.workspace.legalEntityId;
        if (!legalEntityId)
            validation({
                legal_entity_id:
                    'Pilih perusahaan di tempat kerja sebelum melanjutkan.',
            });
        const patientTypeId = await this.patientType(data?.patient_type_id);
        const name = data?.name?.trim() ?? '';
        if (!data?.party_id && !name)
            validation({ name: 'Isi nama penjamin.' });
        const id = Bun.randomUUIDv7();
        try {
            await this.db.transaction(async () => {
                let partyId: string;
                if (data?.party_id) {
                    const party = lookupId(data.party_id)
                        ? await this.db.one(
                              z.object({ id: z.string() }),
                              "select id from parties where tenant_id = $1 and id = $2 and type = 'organization' and deleted_at is null",
                              [this.workspace.tenantId, data.party_id],
                          )
                        : undefined;
                    if (!party)
                        validation({
                            party_id: 'Pilih organisasi dari buku alamat.',
                        });
                    partyId = party.id;
                } else
                    partyId = await new Parties(
                        this.db,
                        this.workspace,
                    ).createForRole(
                        { type: 'organization', status: 'active', name },
                        `${guarantorRole}:${id}`,
                    );
                await registerPartyRole(this.db, {
                    tenantId: this.workspace.tenantId,
                    partyId,
                    roleCode: guarantorRole,
                    legalEntityId,
                    owningAppId: moduleId,
                });
                const stamp = nowSql();
                if (data?.is_default)
                    await this.clearDefault(patientTypeId, id);
                await this.db.insert('sim_m_penjamin', {
                    id,
                    tenant_id: this.workspace.tenantId,
                    party_id: partyId,
                    tipe_pasien_id: patientTypeId,
                    aktif: data?.is_active ?? true,
                    bawaan: data?.is_default ?? false,
                    created_at: stamp,
                    updated_at: stamp,
                });
            });
        } catch (error) {
            taken(error);
            throw error;
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    // Tipe pasien dan status aktif. Nama penjamin diubah lewat buku alamat, karena party-nya bisa dipakai peran lain.
    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('guarantor', 'update');
        const current = await this.row(id);
        const parsed = guarantorInputSchema.safeParse(body);
        const data = parsed.success ? parsed.data : null;
        const patientTypeId = await this.patientType(data?.patient_type_id);
        const version = expectedVersion(request, body);
        const isDefault = data?.is_default ?? current.is_default;
        let updated = 0;
        try {
            await this.db.transaction(async () => {
                if (isDefault)
                    await this.clearDefault(patientTypeId, current.id);
                updated = await this.db.execute(
                    'update sim_m_penjamin set tipe_pasien_id = $1, aktif = $2, bawaan = $7, updated_at = $3 where tenant_id = $4 and id = $5 and version = $6 and deleted_at is null',
                    [
                        patientTypeId,
                        data?.is_active ?? current.is_active,
                        nowSql(),
                        this.workspace.tenantId,
                        current.id,
                        version,
                        isDefault,
                    ],
                );
            });
        } catch (error) {
            taken(error);
            throw error;
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    // Penjamin bawaan berpindah di dalam satu tipe pasien, sama dengan tipe pasien bawaan.
    private async clearDefault(patientTypeId: string, keepId: string) {
        await this.db.execute(
            'update sim_m_penjamin set bawaan = false, updated_at = $1 where tenant_id = $2 and tipe_pasien_id = $3 and bawaan and id <> $4 and deleted_at is null',
            [nowSql(), this.workspace.tenantId, patientTypeId, keepId],
        );
    }

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('guarantor', 'update');
        const current = await this.row(id);
        const stamp = nowSql();
        const deleted = await this.db.execute(
            'update sim_m_penjamin set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null',
            [
                stamp,
                this.workspace.tenantId,
                current.id,
                expectedVersion(request, body),
            ],
        );
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }
}
