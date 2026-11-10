import type { z } from 'zod';
import type { Workspace } from '@core/platform/access/index.ts';
import {
    nowSql,
    sqlErrorCode,
    type Database,
} from '@core/platform/database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    lookupId,
    staleMessage,
    validation,
} from '@core/platform/http/index.ts';
import {
    patientTypeInputSchema,
    patientTypeRowSchema,
} from './patient-type.schema.ts';

const rowSql = `select id, kode as code, nama as name, memakai_penjamin as uses_guarantor, aktif as is_active, version
                from kes_tipe_pasien where tenant_id = $1 and deleted_at is null`;

function checked(body: unknown) {
    const parsed = patientTypeInputSchema.safeParse(body);
    const errors: Record<string, string> = {};
    const data = parsed.success ? parsed.data : null;
    const code = data?.code.trim() ?? '';
    const name = data?.name.trim() ?? '';
    if (!code) errors.code = 'Isi kode tipe pasien.';
    else if (code.length > 20) errors.code = 'Paling panjang 20 karakter.';
    if (!name) errors.name = 'Isi nama tipe pasien.';
    else if (name.length > 100) errors.name = 'Paling panjang 100 karakter.';
    if (Object.keys(errors).length || !data) validation(errors);
    return {
        code,
        name,
        uses_guarantor: data.uses_guarantor ?? false,
        is_active: data.is_active ?? true,
    };
}

function codeTaken(error: unknown): void {
    if (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes('kes_tipe_pasien_kode_unique')
    )
        validation({ code: 'Kode ini sudah dipakai tipe pasien lain.' });
}

// Tipe pasien milik tenant: Umum, BPJS, Asuransi, Perusahaan, dan seterusnya, diisi admin.
export class PatientTypes {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    // Daftar dipakai juga form pasien, jadi pemegang izin lihat pasien ikut boleh membacanya.
    async list() {
        if (
            !this.workspace.permissions.has('healthcare.patient-type.read') &&
            !this.workspace.permissions.has('healthcare.patient.read')
        )
            abort(403, 'Tidak diizinkan.');
        return {
            data: await this.db.rows(
                patientTypeRowSchema,
                `${rowSql} order by nama, id`,
                [this.workspace.tenantId],
            ),
            can_manage: this.workspace.permissions.has(
                'healthcare.patient-type.update',
            ),
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(patientTypeRowSchema, `${rowSql} and id = $2`, [
                  this.workspace.tenantId,
                  id,
              ])
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    async create(body: unknown) {
        this.workspace.guard('patient-type', 'update');
        const data = checked(body);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('kes_tipe_pasien', {
                id,
                tenant_id: this.workspace.tenantId,
                kode: data.code,
                nama: data.name,
                memakai_penjamin: data.uses_guarantor,
                aktif: data.is_active,
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
        this.workspace.guard('patient-type', 'update');
        const current = await this.row(id);
        const data = checked(body);
        const version = expectedVersion(request, body);
        let updated: number;
        try {
            updated = await this.db.execute(
                `update kes_tipe_pasien set kode = $1, nama = $2, memakai_penjamin = $3, aktif = $4, updated_at = $5
                 where tenant_id = $6 and id = $7 and version = $8 and deleted_at is null`,
                [
                    data.code,
                    data.name,
                    data.uses_guarantor,
                    data.is_active,
                    nowSql(),
                    this.workspace.tenantId,
                    current.id,
                    version,
                ],
            );
        } catch (error) {
            codeTaken(error);
            throw error;
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    // Menghapus berarti mengisi deleted_at. Cara bayar pasien yang sudah memakainya tetap menunjuk barisnya.
    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('patient-type', 'update');
        const current = await this.row(id);
        const stamp = nowSql();
        const deleted = await this.db.execute(
            'update kes_tipe_pasien set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null',
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

    // Tipe pasien aktif milik tenant, untuk memeriksa cara bayar.
    async active(ids: string[]) {
        if (!ids.length)
            return new Map<string, z.infer<typeof patientTypeRowSchema>>();
        const rows = await this.db.rows(
            patientTypeRowSchema,
            `${rowSql} and aktif and id in (${ids.map((_, index) => `$${index + 2}`).join(',')})`,
            [this.workspace.tenantId, ...ids],
        );
        return new Map(rows.map((row) => [row.id, row]));
    }
}
