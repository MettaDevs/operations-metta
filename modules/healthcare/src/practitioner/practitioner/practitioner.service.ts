import { z } from 'zod';
import type { Workspace } from '@core/platform/access/index.ts';
import {
    checkContact,
    Parties,
    PartyAddresses,
    PartyIdentifications,
    registerPartyRole,
} from '@core/platform/address-book/index.ts';
import {
    nowSql,
    sqlErrorCode,
    type Bind,
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
    practitionerInputSchema,
    practitionerRowSchema,
    type PractitionerInput,
} from './practitioner.schema.ts';

export const practitionerRole = `${moduleId}.practitioner`;

const rowSql = `select n.id, n.party_id, p.name, n.profesi_id as profession_id, pr.nama as profession_name,
                       n.spesialisasi_id as specialty_id, sp.nama as specialty_name,
                       n.sub_spesialisasi_id as subspecialty_id, ss.nama as subspecialty_name,
                       n.no_sip as license_number, n.sip_berlaku_sampai::text as license_valid_until,
                       n.kode_dokter_bpjs as bpjs_doctor_code, n.user_id, u.name as user_name,
                       n.aktif as is_active, n.version
                from sim_m_nakes n
                join parties p on p.tenant_id = n.tenant_id and p.id = n.party_id
                join sim_m_profesi pr on pr.tenant_id = n.tenant_id and pr.id = n.profesi_id
                left join sim_m_spesialisasi sp on sp.tenant_id = n.tenant_id and sp.id = n.spesialisasi_id
                left join sim_m_sub_spesialisasi ss on ss.tenant_id = n.tenant_id and ss.id = n.sub_spesialisasi_id
                left join users u on u.id = n.user_id
                where n.tenant_id = $1 and n.deleted_at is null`;

function trimmed(value: string | null | undefined): string | null {
    const text = value?.trim() ?? '';
    return text === '' ? null : text;
}

function taken(error: unknown): void {
    if (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes('sim_m_nakes_party_unique')
    )
        validation({
            party_id: 'Orang ini sudah tercatat sebagai tenaga kesehatan.',
        });
}

// Tenaga kesehatan. Identitasnya party orang di buku alamat; tabel module mencatat profesi, spesialis, SIP, kode dokter
// BPJS, dan akun login. Master tenant, tidak dibatasi unit kerja.
export class Practitioners {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    // Daftar bertahap dengan pencarian nama dan nomor SIP, disaring profesi dan status.
    async list(parameters: URLSearchParams) {
        this.workspace.guard('practitioner', 'read');
        const bindings: Bind[] = [this.workspace.tenantId];
        const filters: string[] = [];
        const profession = lookupId(parameters.get('profession_id') ?? '');
        if (profession) {
            bindings.push(profession);
            filters.push(`profession_id = $${bindings.length}`);
        }
        const status = parameters.get('status');
        if (status === 'active') filters.push('is_active');
        if (status === 'inactive') filters.push('not is_active');
        const batch = await incrementalList(this.db, {
            query: `select * from (${rowSql}) practitioners${filters.length ? ` where ${filters.join(' and ')}` : ''}`,
            bindings,
            parameters,
            columns: { name: 'name', license_number: 'license_number' },
            searchColumns: ['name', 'license_number'],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => practitionerRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
        };
    }

    // Pilihan jenis kelamin untuk orang baru, profesi, spesialis beserta sub spesialisnya, dan apa yang boleh dilakukan
    // pengguna di layar.
    async metadata() {
        this.workspace.guard('practitioner', 'read');
        return {
            professions: await this.db.rows(
                z.object({
                    id: z.string(),
                    code: z.string(),
                    name: z.string(),
                    is_active: z.boolean(),
                }),
                `select id, kode as code, nama as name, aktif as is_active from sim_m_profesi
                 where tenant_id = $1 and deleted_at is null order by urutan, nama`,
                [this.workspace.tenantId],
            ),
            specialties: await this.db.rows(
                z.object({
                    id: z.string(),
                    name: z.string(),
                    subspecialties: z.array(
                        z.object({ id: z.string(), name: z.string() }),
                    ),
                }),
                `select s.id, s.nama as name,
                        coalesce((select json_agg(json_build_object('id', b.id, 'name', b.nama) order by b.nama, b.id)
                                  from sim_m_sub_spesialisasi b
                                  where b.tenant_id = s.tenant_id and b.spesialisasi_id = s.id and b.deleted_at is null),
                                 '[]'::json) as subspecialties
                 from sim_m_spesialisasi s
                 where s.tenant_id = $1 and s.deleted_at is null order by s.nama`,
                [this.workspace.tenantId],
            ),
            genders: await this.db.rows(
                z.object({ code: z.string(), name: z.string() }),
                "select code, name from party_reference_values where category = 'gender' order by name",
            ),
            can_manage: this.workspace.permissions.has(
                'healthcare.practitioner.update',
            ),
            // Memilih orang dari buku alamat memakai daftar party Core, yang butuh izin buku alamat.
            can_pick_party: (
                await this.workspace.holds(this.db, ['core.organization.read'])
            ).has('core.organization.read'),
        };
    }

    // Akun login anggota tenant ini, untuk ditautkan ke nakes.
    async users(parameters: URLSearchParams) {
        this.workspace.guard('practitioner', 'update');
        const batch = await incrementalList(this.db, {
            query: `select u.id, u.name, u.email from tenant_memberships m join users u on u.id = m.user_id
                    where m.tenant_id = $1 and m.status = 'active'`,
            bindings: [this.workspace.tenantId],
            parameters,
            columns: { name: 'name' },
            searchColumns: ['name', 'email'],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) =>
                z
                    .object({
                        id: z.string(),
                        name: z.string(),
                        email: z.string(),
                    })
                    .parse(row),
            ),
            next_cursor: batch.next_cursor,
        };
    }

    async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  practitionerRowSchema,
                  `${rowSql} and n.id = $2`,
                  [this.workspace.tenantId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    // Kolom nakes dari kiriman, diperiksa terhadap master profesi dan spesialis, panjang kolom, tanggal, dan akun anggota
    // tenant. Status yang tidak dikirim tetap. Profesi nonaktif hanya boleh tetap dipakai nakes yang sudah memegangnya.
    private async columns(
        data: PractitionerInput | null,
        active: boolean,
        currentProfessionId: string | null = null,
    ) {
        const errors: Record<string, string> = {};
        const professionId = lookupId(trimmed(data?.profession_id) ?? '');
        const profession = professionId
            ? await this.db.one(
                  z.object({ id: z.string(), code: z.string() }),
                  `select id, kode as code from sim_m_profesi
                   where tenant_id = $1 and id = $2 and deleted_at is null and (aktif or id = $3)`,
                  [this.workspace.tenantId, professionId, currentProfessionId],
              )
            : undefined;
        if (!profession) errors.profession_id = 'Pilih profesi dari daftar.';
        const specialtyId = trimmed(data?.specialty_id);
        const specialty = lookupId(specialtyId ?? '')
            ? await this.db.one(
                  z.object({ id: z.string() }),
                  'select id from sim_m_spesialisasi where tenant_id = $1 and id = $2 and deleted_at is null',
                  [this.workspace.tenantId, specialtyId],
              )
            : undefined;
        if (specialtyId !== null && !specialty)
            errors.specialty_id = 'Pilih spesialis dari daftar.';
        const subspecialtyId = trimmed(data?.subspecialty_id);
        const subspecialty =
            specialty && lookupId(subspecialtyId ?? '')
                ? await this.db.one(
                      z.object({ id: z.string() }),
                      `select id from sim_m_sub_spesialisasi
                       where tenant_id = $1 and id = $2 and spesialisasi_id = $3 and deleted_at is null`,
                      [this.workspace.tenantId, subspecialtyId, specialty.id],
                  )
                : undefined;
        if (subspecialtyId !== null && !subspecialty)
            errors.subspecialty_id =
                'Pilih sub spesialis dari spesialis yang dipilih.';
        // Panjang kolom teks sim_m_nakes.
        const text = (field: string, value: string | null, max: number) => {
            if (value !== null && value.length > max)
                errors[field] = `Paling banyak ${max} karakter.`;
            return value;
        };
        const licenseNumber = text(
            'license_number',
            trimmed(data?.license_number),
            100,
        );
        const bpjsDoctorCode = text(
            'bpjs_doctor_code',
            trimmed(data?.bpjs_doctor_code),
            50,
        );
        const validUntil = trimmed(data?.license_valid_until);
        if (validUntil !== null && !z.iso.date().safeParse(validUntil).success)
            errors.license_valid_until = 'Isi tanggal yang sah.';
        const userId = trimmed(data?.user_id);
        if (userId !== null) {
            const member = lookupId(userId)
                ? await this.db.one(
                      z.object({ user_id: z.string() }),
                      "select user_id from tenant_memberships where tenant_id = $1 and user_id = $2 and status = 'active'",
                      [this.workspace.tenantId, userId],
                  )
                : undefined;
            if (!member) errors.user_id = 'Pilih akun dari daftar.';
        }
        if (Object.keys(errors).length) validation(errors);
        return {
            profesi_id: profession?.id ?? null,
            // Kode profesi tetap ditulis untuk kode rilis sebelumnya yang masih membacanya; dibuang di rilis sesudahnya.
            profesi: profession?.code ?? null,
            spesialisasi_id: specialty?.id ?? null,
            sub_spesialisasi_id: subspecialty?.id ?? null,
            no_sip: licenseNumber,
            sip_berlaku_sampai: validUntil,
            kode_dokter_bpjs: bpjsDoctorCode,
            user_id: userId,
            aktif: data?.is_active ?? active,
        };
    }

    async create(body: unknown) {
        this.workspace.guard('practitioner', 'update');
        const parsed = practitionerInputSchema.safeParse(body);
        const data = parsed.success ? parsed.data : null;
        const legalEntityId = this.workspace.legalEntityId;
        if (!legalEntityId)
            validation({
                legal_entity_id:
                    'Pilih legal entity di tempat kerja sebelum melanjutkan.',
            });
        const name = trimmed(data?.name);
        if (!data?.party_id && name === null)
            validation({ name: 'Isi nama tenaga kesehatan.' });
        const columns = await this.columns(data, true);
        const id = Bun.randomUUIDv7();
        try {
            await this.db.transaction(async () => {
                const partyId = data?.party_id
                    ? await this.existingPerson(data.party_id)
                    : await this.newPerson(id, name ?? '', data);
                await registerPartyRole(this.db, {
                    tenantId: this.workspace.tenantId,
                    partyId,
                    roleCode: practitionerRole,
                    legalEntityId,
                    owningAppId: moduleId,
                });
                const stamp = nowSql();
                await this.db.insert('sim_m_nakes', {
                    id,
                    tenant_id: this.workspace.tenantId,
                    party_id: partyId,
                    ...columns,
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

    private async existingPerson(partyId: string): Promise<string> {
        const party = lookupId(partyId)
            ? await this.db.one(
                  z.object({ id: z.string() }),
                  "select id from parties where tenant_id = $1 and id = $2 and type = 'person' and deleted_at is null",
                  [this.workspace.tenantId, partyId],
              )
            : undefined;
        if (!party) validation({ party_id: 'Pilih orang dari buku alamat.' });
        return party.id;
    }

    // Party orang baru beserta NIK dan nomor HP, lewat pintu buku alamat Core.
    private async newPerson(
        id: string,
        name: string,
        data: PractitionerInput | null,
    ): Promise<string> {
        const partyId = await new Parties(
            this.db,
            this.workspace,
        ).createForRole(
            {
                type: 'person',
                status: 'active',
                name,
                gender: trimmed(data?.gender),
            },
            `${practitionerRole}:${id}`,
        );
        const nik = trimmed(data?.nik)?.replace(/\s+/gu, '') ?? null;
        if (nik !== null)
            await new PartyIdentifications(
                this.db,
                this.workspace,
            ).replaceNumber(partyId, 'nik', nik, 'nik');
        const phone = trimmed(data?.phone);
        if (phone !== null) {
            const { data: contact, problems } = checkContact({
                type: 'phone',
                value: phone,
            });
            if (problems.failed)
                validation({
                    phone: problems.errors.value ?? ['Isian ini tidak sah.'],
                });
            await new PartyAddresses(this.db, this.workspace).saveContact(
                partyId,
                contact,
            );
        }
        return partyId;
    }

    // Profesi, spesialis, SIP, kode dokter BPJS, akun login, dan status. Nama dan identitas diubah lewat buku alamat,
    // karena party-nya bisa dipakai peran lain.
    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('practitioner', 'update');
        const current = await this.row(id);
        const parsed = practitionerInputSchema.safeParse(body);
        const columns = await this.columns(
            parsed.success ? parsed.data : null,
            current.is_active,
            current.profession_id,
        );
        const names = Object.keys(columns);
        const updated = await this.db.execute(
            `update sim_m_nakes set ${names.map((column, index) => `${column} = $${index + 1}`).join(', ')},
                    updated_at = $${names.length + 1}
             where tenant_id = $${names.length + 2} and id = $${names.length + 3} and version = $${names.length + 4}
               and deleted_at is null`,
            [
                ...Object.values(columns),
                nowSql(),
                this.workspace.tenantId,
                current.id,
                expectedVersion(request, body),
            ],
        );
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('practitioner', 'update');
        const current = await this.row(id);
        const stamp = nowSql();
        const deleted = await this.db.execute(
            'update sim_m_nakes set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null',
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
