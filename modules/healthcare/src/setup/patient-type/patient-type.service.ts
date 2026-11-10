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
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '@core/platform/http/index.ts';
import {
    patientTypeInputSchema,
    patientTypeRowSchema,
} from './patient-type.schema.ts';
import {
    isPatientTypeBehavior,
    type PatientTypeBehavior,
} from './patient-type.behaviors.ts';

const rowSql = `select * from (
                    select t.id, t.kode as code, t.nama as name, coalesce((select json_agg(b.perilaku order by b.perilaku) from kes_tipe_pasien_perilaku b
                         where b.tenant_id = t.tenant_id and b.tipe_pasien_id = t.id and b.deleted_at is null),
                        '[]'::json) as behaviors,
                           t.aktif as is_active, t.version
                    from kes_tipe_pasien t where t.tenant_id = $1 and t.deleted_at is null) patient_types
                where true`;

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
    const behaviors = [...new Set(data?.behaviors ?? [])];
    if (!behaviors.every(isPatientTypeBehavior))
        errors.behaviors = 'Pilih perilaku dari daftar.';
    if (Object.keys(errors).length || !data) validation(errors);
    return {
        code,
        name,
        behaviors: behaviors.filter(isPatientTypeBehavior),
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

// Tipe pasien milik tenant, diisi admin. Perilakunya dibaca dari kes_tipe_pasien_perilaku, tidak dari nama atau id.
// memakai_penjamin (0001) tetap ditulis sama dengan perilaku requires_guarantor untuk kode rilis sebelumnya.
export class PatientTypes {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    // Daftar bertahap, dipakai juga pilihan tipe pasien di form pasien, jadi pemegang izin lihat pasien ikut boleh
    // membacanya. `active=1` hanya tipe yang aktif.
    async list(parameters: URLSearchParams) {
        if (
            !this.workspace.permissions.has('healthcare.patient-type.read') &&
            !this.workspace.permissions.has('healthcare.patient.read')
        )
            abort(403, 'Tidak diizinkan.');
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${parameters.get('active') === '1' ? ' and is_active' : ''}`,
            bindings: [this.workspace.tenantId],
            parameters,
            columns: { name: 'name', code: 'code' },
            searchColumns: ['code', 'name'],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => patientTypeRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has(
                'healthcare.patient-type.update',
            ),
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  patientTypeRowSchema,
                  `${rowSql} and patient_types.id = $2`,
                  [this.workspace.tenantId, id],
              )
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
            await this.db.transaction(async () => {
                await this.db.insert('kes_tipe_pasien', {
                    id,
                    tenant_id: this.workspace.tenantId,
                    kode: data.code,
                    nama: data.name,
                    memakai_penjamin:
                        data.behaviors.includes('requires_guarantor'),
                    aktif: data.is_active,
                    created_at: stamp,
                    updated_at: stamp,
                });
                await this.writeBehaviors(id, data.behaviors);
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
        let updated = 0;
        try {
            await this.db.transaction(async () => {
                updated = await this.db.execute(
                    `update kes_tipe_pasien set kode = $1, nama = $2, memakai_penjamin = $3, aktif = $4, updated_at = $5
                 where tenant_id = $6 and id = $7 and version = $8 and deleted_at is null`,
                    [
                        data.code,
                        data.name,
                        data.behaviors.includes('requires_guarantor'),
                        data.is_active,
                        nowSql(),
                        this.workspace.tenantId,
                        current.id,
                        version,
                    ],
                );
                if (updated)
                    await this.writeBehaviors(current.id, data.behaviors);
            });
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

    // Perilaku yang dinyalakan tipe ini: yang tidak dipilih lagi diarsipkan, yang baru ditambah.
    private async writeBehaviors(
        typeId: string,
        behaviors: PatientTypeBehavior[],
    ): Promise<void> {
        const stamp = nowSql();
        const bindings = [stamp, this.workspace.tenantId, typeId, ...behaviors];
        await this.db.execute(
            `update kes_tipe_pasien_perilaku set deleted_at = $1, updated_at = $1
             where tenant_id = $2 and tipe_pasien_id = $3 and deleted_at is null
             ${behaviors.length ? `and perilaku not in (${behaviors.map((_, index) => `$${index + 4}`).join(',')})` : ''}`,
            bindings,
        );
        for (const behavior of behaviors)
            await this.db.execute(
                `insert into kes_tipe_pasien_perilaku (id, tenant_id, tipe_pasien_id, perilaku, created_at, updated_at)
                 select $1::uuid, $2::uuid, $3::uuid, $4::varchar, $5::timestamp, $5::timestamp
                 where not exists (select 1 from kes_tipe_pasien_perilaku where tenant_id = $2 and tipe_pasien_id = $3
                                   and perilaku = $4::varchar and deleted_at is null)`,
                [
                    Bun.randomUUIDv7(),
                    this.workspace.tenantId,
                    typeId,
                    behavior,
                    stamp,
                ],
            );
    }
}
