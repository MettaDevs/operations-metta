import { z } from 'zod';
import { NumberIssuer } from '@core/foundation/number-sequence/index.ts';
import type { Workspace } from '@core/platform/access/index.ts';
import {
    checkContact,
    checkLocation,
    maskNumber,
    Parties,
    PartyAddresses,
    PartyIdentifications,
    placeholderNik,
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
    HttpFailure,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '@core/platform/http/index.ts';
import { moduleId } from '../../module.ts';
import {
    grantsUnit,
    PatientSharing,
} from '../patient-sharing/patient-sharing.service.ts';
import {
    patientAddressSchema,
    patientInputSchema,
    patientListRowSchema,
    paymentMethodSchema,
    type PatientAddressInput,
    type PatientInput,
} from './patient.schema.ts';

export const patientRole = `${moduleId}.patient`;
export const numberReference = `${moduleId}.medical-record-number`;
const identityPurpose = 'identity_card';
const domicilePurpose = 'domicile';
const indonesia = 'ID';

// Isian party yang diisi dari kartu pasien, dengan nama field party Core.
const partyFields = [
    'name',
    'nationality_country_code',
    'gender',
    'birth_date',
    'birth_place',
    'religion',
    'education',
    'marital_status',
    'anniversary_date',
    'occupation_id',
] as const;
const identificationFields = {
    nik: 'nik',
    family_card_number: 'family_card',
    passport_number: 'passport',
} as const;
const identificationKeys = [
    'nik',
    'family_card_number',
    'passport_number',
] as const;
const patientTexts = {
    document_number: 50,
    old_number: 50,
    institution: 50,
    father_name: 50,
    mother_name: 50,
    mother_nik: 16,
} as const;
const patientTextFields = [
    'document_number',
    'old_number',
    'institution',
    'father_name',
    'mother_name',
    'mother_nik',
] as const;

const patientSchema = z.object({
    id: z.string(),
    version: z.number(),
    party_id: z.string(),
    nrm: z.string(),
    legal_entity_id: z.string(),
    legal_entity_name: z.string(),
    org_unit_id: z.string(),
    org_unit_name: z.string(),
    // null: NRM dari sequence legal entity, karena unit pendaftar tidak ditempatkan di kelompok berbagi pasien.
    nrm_unit_id: z.string().nullable(),
    nrm_unit_name: z.string().nullable(),
    is_active: z.boolean(),
    document_number: z.string().nullable(),
    old_number: z.string().nullable(),
    blood_type: z.string().nullable(),
    family_status: z.string().nullable(),
    institution: z.string().nullable(),
    father_name: z.string().nullable(),
    mother_name: z.string().nullable(),
    mother_nik: z.string().nullable(),
    name: z.string(),
    nationality_country_code: z.string().nullable(),
    gender: z.string().nullable(),
    birth_date: z.string().nullable(),
    birth_place: z.string().nullable(),
    religion: z.string().nullable(),
    education: z.string().nullable(),
    marital_status: z.string().nullable(),
    anniversary_date: z.string().nullable(),
    occupation_id: z.string().nullable(),
    occupation_name: z.string().nullable(),
});

const today = () => new Date().toISOString().slice(0, 10);
const blank = (value: string | null | undefined) =>
    value === null || value === undefined || value.trim() === '';
const trimmed = (value: string | null | undefined) =>
    blank(value) ? null : (value ?? '').trim();

type Errors = Record<string, string[]>;
function add(errors: Errors, field: string, message: string): void {
    (errors[field] ??= []).push(message);
}

// Kesalahan isian dari Core (alamat, kontak, nomor identitas) diberi awalan isian kartu pasien.
async function prefixed<T>(
    prefix: string,
    action: () => Promise<T>,
): Promise<T> {
    try {
        return await action();
    } catch (error) {
        const errors =
            error instanceof HttpFailure && error.status === 422
                ? z
                      .object({
                          errors: z.record(z.string(), z.array(z.string())),
                      })
                      .safeParse(error.body).data?.errors
                : undefined;
        if (errors)
            validation(
                Object.fromEntries(
                    Object.entries(errors).map(([field, messages]) => [
                        prefix ? `${prefix}.${field}` : field,
                        messages,
                    ]),
                ),
            );
        throw error;
    }
}

// Master pasien. Pasien adalah peran party milik module ini: identitas, nomor identitas, alamat, dan kontak ada di
// party Core, sedangkan nomor rekam medis, data tambahan, dan cara bayar ada di tabel module. Siapa melihat pasien
// mana diatur PatientSharing.
export class Patients {
    private readonly sharing: PatientSharing;

    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {
        this.sharing = new PatientSharing(db, workspace.tenantId);
    }

    private async seesFullIdentification(): Promise<boolean> {
        return (
            await this.workspace.holds(this.db, [
                'core.party-identification.read',
            ])
        ).has('core.party-identification.read');
    }

    // Syarat SQL bahwa pasien `k` terlihat bagi pengguna (PatientSharing.visible).
    private visibility(bind: (value: Bind) => string): Promise<string> {
        return this.sharing.visible(this.workspace, bind);
    }

    // Tipe pasien bawaan beserta penjamin bawaannya, bila ada dan aktif. Pasien baru memakainya bila cara bayar tidak
    // diisi, dan kartu pasien baru mengisinya lebih dulu.
    private async defaultPaymentMethod() {
        return (
            (await this.db.one(
                z.object({
                    patient_type_id: z.string(),
                    patient_type_name: z.string(),
                    behaviors: z.array(z.string()),
                    guarantor_id: z.string().nullable(),
                    guarantor_name: z.string().nullable(),
                }),
                `select t.id as patient_type_id, t.nama as patient_type_name,
                        coalesce((select json_agg(b.perilaku order by b.perilaku) from sim_m_tipe_pasien_perilaku b
                         where b.tenant_id = t.tenant_id and b.tipe_pasien_id = t.id and b.deleted_at is null),
                        '[]'::json) as behaviors,
                        g.id as guarantor_id, gp.name as guarantor_name
                 from sim_m_tipe_pasien t
                 left join sim_m_penjamin g on g.tenant_id = t.tenant_id and g.tipe_pasien_id = t.id and g.bawaan
                      and g.aktif and g.deleted_at is null
                 left join parties gp on gp.tenant_id = g.tenant_id and gp.id = g.party_id
                 where t.tenant_id = $1 and t.bawaan and t.aktif and t.deleted_at is null
                 limit 1`,
                [this.workspace.tenantId],
            )) ?? null
        );
    }

    // Pasien tenant ini yang terlihat bagi pengguna. Yang lain dijawab 404, supaya keberadaannya tidak bocor.
    private async require(id: string) {
        const bindings: Bind[] = [this.workspace.tenantId, lookupId(id)];
        const bind = (value: Bind) => {
            bindings.push(value);
            return `$${bindings.length}`;
        };
        const found = bindings[1]
            ? await this.db.one(
                  z.object({
                      id: z.string(),
                      party_id: z.string(),
                      version: z.number(),
                      legal_entity_id: z.string(),
                  }),
                  `select k.id, k.party_id, k.version, k.legal_entity_id from sim_m_pasien k
                   where k.tenant_id = $1 and k.id = $2 and k.deleted_at is null and ${await this.visibility(bind)}`,
                  bindings,
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('patient', 'read');
        const bindings: Bind[] = [this.workspace.tenantId];
        const bind = (value: Bind) => {
            bindings.push(value);
            return `$${bindings.length}`;
        };
        const filters = [
            'k.tenant_id = $1',
            'k.deleted_at is null',
            await this.visibility(bind),
        ];
        const status = parameters.get('status');
        if (status === 'active' || status === 'inactive')
            filters.push(`k.aktif = ${bind(status === 'active')}`);
        const type = lookupId(parameters.get('patient_type_id') ?? '');
        if (type)
            filters.push(
                `exists (select 1 from sim_m_pasien_cara_bayar c where c.tenant_id = k.tenant_id and c.pasien_id = k.id and c.deleted_at is null and c.tipe_pasien_id = ${bind(type)})`,
            );
        const unit = lookupId(parameters.get('org_unit_id') ?? '');
        if (unit) filters.push(`k.org_unit_id = ${bind(unit)}`);
        // Kolom pencarian sistem lama: NRM, NRM lama, nama, nomor HP, alamat, nomor kartu, NIK, dan tanggal lahir
        // dalam bentuk yyyy-mm-dd, dd-mm-yyyy, ddmmyyyy, dan yyyymmdd.
        const batch = await incrementalList(this.db, {
            query: `
                select k.id, k.nrm, p.name, nik.number as nik, payment.nomor_kartu as card_number,
                       payment.patient_type_name, payment.guarantor_name, k.no_dokumen_rm as document_number,
                       k.nrm_lama as old_number, p.gender, p.birth_place, p.birth_date::text as birth_date,
                       address.formatted as address, phone.value as phone, k.aktif as is_active, k.org_unit_id,
                       unit.name as org_unit_name,
                       to_char(p.birth_date, 'DD-MM-YYYY') as birth_date_dmy,
                       to_char(p.birth_date, 'DDMMYYYY') as birth_date_compact,
                       to_char(p.birth_date, 'YYYYMMDD') as birth_date_iso_compact,
                       (select string_agg(c.nomor_kartu, ' ') from sim_m_pasien_cara_bayar c
                        where c.tenant_id = k.tenant_id and c.pasien_id = k.id and c.deleted_at is null) as card_numbers
                from sim_m_pasien k
                join parties p on p.tenant_id = k.tenant_id and p.id = k.party_id
                join organizations unit on unit.id = k.org_unit_id
                left join party_identifications nik on nik.tenant_id = k.tenant_id and nik.party_id = k.party_id
                    and nik.type_code = 'nik' and nik.deleted_at is null
                left join lateral (
                    select c.nomor_kartu, t.nama as patient_type_name, g.name as guarantor_name
                    from sim_m_pasien_cara_bayar c
                    join sim_m_tipe_pasien t on t.tenant_id = c.tenant_id and t.id = c.tipe_pasien_id
                    left join sim_m_penjamin j on j.tenant_id = c.tenant_id and j.id = c.penjamin_id
                    left join parties g on g.tenant_id = j.tenant_id and g.id = j.party_id
                    where c.tenant_id = k.tenant_id and c.pasien_id = k.id and c.deleted_at is null
                    order by c.utama desc, c.urutan limit 1) payment on true
                left join lateral (
                    select pa.formatted from party_locations pl
                    join postal_addresses pa on pa.location_id = pl.location_id
                    join party_location_purposes plp on plp.party_location_id = pl.id and plp.deleted_at is null
                    where pl.tenant_id = k.tenant_id and pl.party_id = k.party_id and pl.deleted_at is null
                      and not pl.is_private and plp.purpose_code in ('${identityPurpose}', '${domicilePurpose}')
                    order by plp.purpose_code = '${domicilePurpose}' desc limit 1) address on true
                left join lateral (
                    select e.value from electronic_addresses e
                    join party_locations pl on pl.location_id = e.location_id and pl.party_id = k.party_id
                        and pl.deleted_at is null and not pl.is_private
                    where e.tenant_id = k.tenant_id and e.type = 'phone' and e.deleted_at is null
                    order by e.is_primary desc, e.created_at limit 1) phone on true
                where ${filters.join(' and ')}`,
            bindings,
            parameters,
            columns: { name: 'name', nrm: 'nrm' },
            searchColumns: [
                'nrm',
                'old_number',
                'name',
                'phone',
                'address',
                'card_numbers',
                'nik',
                'birth_date',
                'birth_date_dmy',
                'birth_date_compact',
                'birth_date_iso_compact',
            ],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
        const full = await this.seesFullIdentification();
        return {
            data: batch.data.map((row) => {
                const parsed = patientListRowSchema.parse(row);
                return {
                    ...parsed,
                    nik:
                        parsed.nik !== null && !full
                            ? maskNumber(parsed.nik)
                            : parsed.nik,
                };
            }),
            next_cursor: batch.next_cursor,
        };
    }

    // Data form pasien: nilai acuan party dan pasien, tipe pasien, penjamin, dan pekerjaan. Nama yang tampil datang
    // dari database.
    async metadata() {
        this.workspace.guard('patient', 'read');
        const references = await this.db.rows(
            z.object({
                category: z.string(),
                code: z.string(),
                name: z.string(),
            }),
            `select category, code, name from party_reference_values
             where category in ('gender', 'marital_status', 'religion', 'education', 'blood_type', 'family_status')
             order by category, name`,
        );
        return {
            reference_values: Object.fromEntries(
                Map.groupBy(references, (row) => row.category).entries(),
            ),
            countries: await this.db.rows(
                z.object({ code: z.string(), name: z.string() }),
                'select code, name from country_regions order by name',
            ),
            default_payment_method: await this.defaultPaymentMethod(),
            permissions: {
                create: this.workspace.permissions.has(
                    'healthcare.patient.create',
                ),
                update: this.workspace.permissions.has(
                    'healthcare.patient.update',
                ),
                delete: this.workspace.permissions.has(
                    'healthcare.patient.delete',
                ),
            },
            // Unit pendaftar pasien baru: unit aktif di tempat kerja, bila termasuk batas data pengguna.
            registering_unit:
                this.workspace.orgUnitId !== null &&
                grantsUnit(this.workspace, this.workspace.orgUnitId)
                    ? ((await this.db.one(
                          z.object({ id: z.string(), name: z.string() }),
                          'select id, name from organizations where tenant_id = $1 and id = $2',
                          [this.workspace.tenantId, this.workspace.orgUnitId],
                      )) ?? null)
                    : null,
        };
    }

    // Pilihan pekerjaan untuk isian pekerjaan pasien (master Pekerjaan Core), bertahap. Daftar Core dijaga izin buku
    // alamat, yang tidak dipegang petugas pendaftaran.
    async occupations(parameters: URLSearchParams) {
        this.workspace.guard('patient', 'read');
        const batch = await incrementalList(this.db, {
            query: 'select id, name from occupations where tenant_id = $1 and deleted_at is null',
            bindings: [this.workspace.tenantId],
            parameters,
            columns: { name: 'name' },
            searchColumns: ['name'],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) =>
                z.object({ id: z.string(), name: z.string() }).parse(row),
            ),
            next_cursor: batch.next_cursor,
        };
    }

    async show(id: string) {
        this.workspace.guard('patient', 'read');
        const found = await this.require(id);
        return { data: await this.present(found.id) };
    }

    private async present(id: string) {
        const patient = await this.db.one(
            patientSchema,
            `select k.id, k.version, k.party_id, k.nrm, k.legal_entity_id, le.name as legal_entity_name,
                    k.org_unit_id, unit.name as org_unit_name, k.nrm_unit_id, numbering.name as nrm_unit_name,
                    k.aktif as is_active, k.no_dokumen_rm as document_number, k.nrm_lama as old_number,
                    k.golongan_darah as blood_type, k.status_keluarga as family_status, k.instansi as institution,
                    k.nama_ayah as father_name, k.nama_ibu as mother_name, k.nik_ibu as mother_nik,
                    p.name, p.nationality_country_code, p.gender, p.birth_date::text as birth_date, p.birth_place,
                    p.religion, p.education, p.marital_status, p.anniversary_date::text as anniversary_date,
                    p.occupation_id, occupation.name as occupation_name
             from sim_m_pasien k
             join parties p on p.tenant_id = k.tenant_id and p.id = k.party_id
             join organizations le on le.id = k.legal_entity_id
             join organizations unit on unit.id = k.org_unit_id
             left join organizations numbering on numbering.id = k.nrm_unit_id
             left join occupations occupation on occupation.id = p.occupation_id
             where k.tenant_id = $1 and k.id = $2`,
            [this.workspace.tenantId, id],
        );
        if (!patient) abort(404, 'Not Found');
        // Nomor berklasifikasi sensitive (NIK, No. KK) disamarkan seperti di buku alamat, bagi yang tidak memegang
        // izin Core Lihat nomor identitas utuh. Izin Core tidak ada di workspace module, jadi dibaca terpisah.
        const identifications = await this.db.rows(
            z.object({
                type_code: z.string(),
                number: z.string(),
                data_sensitivity: z.string(),
            }),
            `select i.type_code, i.number, t.data_sensitivity from party_identifications i
             join party_identification_types t on t.code = i.type_code
             where i.tenant_id = $1 and i.party_id = $2 and i.deleted_at is null`,
            [this.workspace.tenantId, patient.party_id],
        );
        const full = await this.seesFullIdentification();
        const identification = (type: string) => {
            const row = identifications.find((item) => item.type_code === type);
            if (!row) return { number: null, masked: false };
            const masked = row.data_sensitivity === 'sensitive' && !full;
            return {
                number: masked ? maskNumber(row.number) : row.number,
                masked,
            };
        };
        const addresses = new PartyAddresses(this.db, this.workspace);
        const locations = await addresses.locations(patient.party_id);
        const address = (purpose: string) => {
            const link = locations.find((item) =>
                item.purposes.includes(purpose),
            );
            return link ? patientAddressSchema.parse(link) : null;
        };
        const contacts = await addresses.contacts(patient.party_id);
        const contact = (type: string) =>
            contacts.find((item) => item.type === type && item.is_primary)
                ?.value ??
            contacts.find((item) => item.type === type)?.value ??
            null;
        const motherMasked = patient.mother_nik !== null && !full;
        return {
            ...patient,
            mother_nik: motherMasked
                ? maskNumber(patient.mother_nik ?? '')
                : patient.mother_nik,
            mother_nik_masked: motherMasked,
            nik: identification('nik'),
            family_card_number: identification('family_card'),
            passport_number: identification('passport'),
            phone: contact('phone'),
            email: contact('email'),
            identity_address: address(identityPurpose),
            domicile_address: address(domicilePurpose),
            payment_methods: await this.db.rows(
                paymentMethodSchema,
                `select c.id, c.tipe_pasien_id as patient_type_id, t.nama as patient_type_name,
                        coalesce((select json_agg(b.perilaku order by b.perilaku) from sim_m_tipe_pasien_perilaku b
                         where b.tenant_id = t.tenant_id and b.tipe_pasien_id = t.id and b.deleted_at is null),
                        '[]'::json) as behaviors,
                        c.penjamin_id as guarantor_id, g.name as guarantor_name,
                        c.nomor_kartu as card_number, c.kelas as class, c.utama as is_primary
                 from sim_m_pasien_cara_bayar c
                 join sim_m_tipe_pasien t on t.tenant_id = c.tenant_id and t.id = c.tipe_pasien_id
                 left join sim_m_penjamin j on j.tenant_id = c.tenant_id and j.id = c.penjamin_id
                 left join parties g on g.tenant_id = j.tenant_id and g.id = j.party_id
                 where c.tenant_id = $1 and c.pasien_id = $2 and c.deleted_at is null
                 order by c.utama desc, c.urutan, c.id`,
                [this.workspace.tenantId, id],
            ),
        };
    }

    // Party pemilik NIK ini. NIK pengganti dipakai banyak orang, jadi tidak pernah menunjuk satu party.
    private async partyByNik(nik: string): Promise<string | null> {
        if (nik === placeholderNik) return null;
        const found = await this.db.one(
            z.object({ party_id: z.string() }),
            `select i.party_id from party_identifications i
             join parties p on p.id = i.party_id and p.deleted_at is null
             where i.tenant_id = $1 and i.type_code = 'nik' and i.number = $2 and i.deleted_at is null`,
            [this.workspace.tenantId, nik],
        );
        return found?.party_id ?? null;
    }

    // Aturan wajib form pasien sistem lama (common/patients/form.php dan Patient_m::rules):
    // - nama dan jenis kelamin wajib, begitu pula nomor HP;
    // - warga negara Indonesia: NIK wajib, alamat KTP wajib sampai kelurahan/desa beserta alamatnya;
    // - warga negara asing: nomor paspor dan alamat domisili wajib;
    // - alamat domisili yang diisi warga negara Indonesia wajib lengkap sampai kelurahan/desa beserta alamatnya;
    // - tipe pasien wajib (Patient_model::rules pendaftaran).
    // Isian identitas tidak diperiksa bila party sudah ada (pasien dari party lama): yang ditambahkan hanya perannya.
    private check(input: PatientInput, checkParty: boolean, creating: boolean) {
        const errors: Errors = {};
        if (checkParty) {
            if (blank(input.name)) add(errors, 'name', 'Isi nama.');
            if (blank(input.gender))
                add(errors, 'gender', 'Pilih jenis kelamin.');
            if (blank(input.phone)) add(errors, 'phone', 'Isi nomor HP.');
            const nationality = trimmed(input.nationality_country_code);
            const domestic = nationality?.toUpperCase() === indonesia;
            const requireAddress = (
                field: 'identity_address' | 'domicile_address',
                address: PatientAddressInput | null | undefined,
                regions: boolean,
            ) => {
                if (!address) {
                    add(errors, field, 'Isi alamat.');
                    return;
                }
                if (regions)
                    for (const part of [
                        'province_id',
                        'regency_id',
                        'district_id',
                        'village_id',
                    ] as const)
                        if (blank(address[part]))
                            add(
                                errors,
                                `${field}.${part}`,
                                'Pilih dari daftar.',
                            );
                if (blank(address.street))
                    add(errors, `${field}.street`, 'Isi alamat.');
            };
            if (domestic) {
                // NIK yang tidak dikirim saat mengubah berarti tidak diubah.
                if ('nik' in input || creating)
                    if (blank(input.nik))
                        add(errors, 'nik', 'No Identitas harus diisi!');
                requireAddress(
                    'identity_address',
                    input.identity_address,
                    true,
                );
                if (input.domicile_address)
                    requireAddress(
                        'domicile_address',
                        input.domicile_address,
                        true,
                    );
            } else if (nationality !== null) {
                if ('passport_number' in input || creating)
                    if (blank(input.passport_number))
                        add(errors, 'passport_number', 'Isi nomor paspor.');
                requireAddress(
                    'domicile_address',
                    input.domicile_address,
                    false,
                );
            }
        }
        for (const field of patientTextFields) {
            const max = patientTexts[field];
            const value = input[field];
            if (value && value.trim().length > max)
                add(errors, field, `Paling panjang ${max} karakter.`);
        }
        const methods = input.payment_methods ?? [];
        if (
            !methods.length &&
            (!creating || input.payment_methods !== undefined)
        )
            add(errors, 'payment_methods', 'Pilih tipe pasien.');
        if (methods.filter((method) => method.is_primary).length > 1)
            add(errors, 'payment_methods', 'Pilih satu cara bayar utama.');
        methods.forEach((method, index) => {
            if ((method.card_number ?? '').trim().length > 50)
                add(
                    errors,
                    `payment_methods.${index}.card_number`,
                    'Paling panjang 50 karakter.',
                );
            if ((method.class ?? '').trim().length > 50)
                add(
                    errors,
                    `payment_methods.${index}.class`,
                    'Paling panjang 50 karakter.',
                );
        });
        return errors;
    }

    // Nilai acuan pasien (golongan darah, status di KK) harus dari daftar.
    private async checkReferences(input: PatientInput, errors: Errors) {
        const rows = await this.db.rows(
            z.object({ key: z.string() }),
            "select category || ':' || code as key from party_reference_values where category in ('blood_type', 'family_status')",
        );
        const known = new Set(rows.map((row) => row.key));
        for (const [field, category] of [
            ['blood_type', 'blood_type'],
            ['family_status', 'family_status'],
        ] as const) {
            const value = trimmed(input[field]);
            if (value !== null && !known.has(`${category}:${value}`))
                add(errors, field, 'Pilih dari daftar.');
        }
    }

    private parse(body: unknown): PatientInput {
        const parsed = patientInputSchema.safeParse(body);
        if (parsed.success) return parsed.data;
        return validation(
            Object.fromEntries(
                parsed.error.issues.map((issue) => [
                    issue.path.join('.') || 'input',
                    'Isian ini tidak sah.',
                ]),
            ),
        );
    }

    private partyInput(input: PatientInput) {
        const data: Record<string, unknown> = {};
        for (const field of partyFields)
            if (field in input) data[field] = trimmed(input[field]);
        if (typeof data.nationality_country_code === 'string')
            data.nationality_country_code =
                data.nationality_country_code.toUpperCase();
        return data;
    }

    async create(request: Request, body: unknown) {
        this.workspace.guard('patient', 'create');
        const input = this.parse(body);
        const unitId = this.workspace.orgUnitId;
        const legalEntityId = this.workspace.legalEntityId;
        if (!legalEntityId || !unitId)
            validation({
                org_unit_id:
                    'Pilih perusahaan dan unit kerja di tempat kerja sebelum mendaftarkan pasien.',
            });
        if (!grantsUnit(this.workspace, unitId))
            abort(403, 'Unit kerja ini di luar unit yang dapat Anda akses.');
        const header = request.headers.get('idempotency-key');
        const key =
            header && /^[A-Za-z0-9._:-]{8,120}$/.test(header)
                ? header
                : Bun.randomUUIDv7();
        const replay = await this.db.one(
            z.object({ id: z.string() }),
            'select id from sim_m_pasien where tenant_id = $1 and creation_key = $2',
            [this.workspace.tenantId, key],
        );
        if (replay)
            return {
                status: 200,
                headers: {},
                body: {
                    data: await this.present(replay.id),
                    party_reused: false,
                },
            };
        // Form lama mengisi NIK warga negara asing dengan NIK pengganti (common/views/patients/form.php).
        const nationality = trimmed(input.nationality_country_code);
        if (
            nationality !== null &&
            nationality.toUpperCase() !== indonesia &&
            blank(input.nik)
        )
            input.nik = placeholderNik;
        const nik = trimmed(input.nik)?.replace(/\s+/gu, '') ?? null;
        const existingParty = nik ? await this.partyByNik(nik) : null;
        // Cara bayar yang tidak dikirim memakai tipe pasien bawaan beserta penjamin bawaannya.
        if (input.payment_methods === undefined) {
            const fallback = await this.defaultPaymentMethod();
            if (fallback)
                input.payment_methods = [
                    {
                        patient_type_id: fallback.patient_type_id,
                        guarantor_id: fallback.guarantor_id,
                        is_primary: true,
                    },
                ];
        }
        const errors = this.check(input, existingParty === null, true);
        await this.checkReferences(input, errors);
        if (Object.keys(errors).length) validation(errors);
        const id = Bun.randomUUIDv7();
        await this.db.transaction(async () => {
            const numberingUnit = await this.sharing.numberingUnit(unitId);
            let partyId: string;
            if (existingParty) {
                const already = await this.patientInGroup(
                    existingParty,
                    legalEntityId,
                    unitId,
                );
                // Pesan form lama persis (common/controllers/Patients.php, create). Pasien itu terlihat bagi pengguna,
                // jadi NRM dan namanya tidak membocorkan data di luar cakupan berbaginya.
                if (already)
                    validation({
                        nik: `NIK sudah terdaftar! dengan NRM: ${already.nrm} dan Nama: ${already.name}`,
                    });
                partyId = existingParty;
            } else {
                partyId = await new Parties(
                    this.db,
                    this.workspace,
                ).createForRole(
                    {
                        ...this.partyInput(input),
                        type: 'person',
                        status: 'active',
                    },
                    `${patientRole}:${key}`,
                );
                await this.writeIdentity(partyId, input, true);
            }
            const nrm = await prefixed('', () =>
                new NumberIssuer(this.db, {
                    tenantId: this.workspace.tenantId,
                    moduleId,
                }).issue({
                    reference: numberReference,
                    key: `patient:${key}`,
                    documentDate: today(),
                    // Tepat satu nilai scope: unit kepala kelompok, atau legal entity bila unit tidak ditempatkan.
                    legalEntityId:
                        numberingUnit === null ? legalEntityId : null,
                    operatingUnitId: numberingUnit,
                }),
            );
            const stamp = nowSql();
            try {
                await this.db.insert('sim_m_pasien', {
                    id,
                    tenant_id: this.workspace.tenantId,
                    party_id: partyId,
                    legal_entity_id: legalEntityId,
                    org_unit_id: unitId,
                    nrm_unit_id: numberingUnit,
                    nrm,
                    creation_key: key,
                    ...this.patientColumns(input, true),
                    created_at: stamp,
                    updated_at: stamp,
                });
            } catch (error) {
                if (
                    sqlErrorCode(error) === '23505' &&
                    error instanceof Error &&
                    (error.message.includes('sim_m_pasien_party_unit_unique') ||
                        error.message.includes(
                            'sim_m_pasien_party_legal_entity_unique',
                        ))
                )
                    validation({
                        nik: 'Orang ini sudah terdaftar sebagai pasien di kelompok ini.',
                    });
                throw error;
            }
            await this.writePaymentMethods(id, input);
            await registerPartyRole(this.db, {
                tenantId: this.workspace.tenantId,
                partyId,
                roleCode: patientRole,
                legalEntityId,
                owningAppId: moduleId,
            });
        });
        return {
            status: 201,
            headers: {},
            body: {
                data: await this.present(id),
                party_reused: existingParty !== null,
            },
        };
    }

    // Pasien party ini yang sudah terlihat dari legal entity dan unit pendaftar. Padanan "NIK sudah ada di mPasien"
    // form lama: di sana satu database satu klinik, di sini cakupannya cakupan berbagi pasien unit pendaftar.
    private async patientInGroup(
        partyId: string,
        legalEntityId: string,
        unitId: string,
    ) {
        const bindings: Bind[] = [this.workspace.tenantId, partyId];
        const bind = (value: Bind) => {
            bindings.push(value);
            return `$${bindings.length}`;
        };
        return (
            (await this.db.one(
                z.object({ nrm: z.string(), name: z.string() }),
                `select k.nrm, p.name from sim_m_pasien k
                 join parties p on p.tenant_id = k.tenant_id and p.id = k.party_id
                 where k.tenant_id = $1 and k.party_id = $2 and k.deleted_at is null
                   and ${await this.sharing.clause(legalEntityId, [unitId], bind)}
                 order by k.created_at limit 1`,
                bindings,
            )) ?? null
        );
    }

    // Kolom pasien dari kiriman. Saat mengubah, isian yang tidak dikirim tidak diubah.
    private patientColumns(
        input: PatientInput,
        creating: boolean,
    ): Record<string, Bind> {
        const columns: Record<string, [keyof PatientInput, Bind]> = {
            aktif: ['is_active', input.is_active ?? true],
            no_dokumen_rm: ['document_number', trimmed(input.document_number)],
            nrm_lama: ['old_number', trimmed(input.old_number)],
            golongan_darah: ['blood_type', trimmed(input.blood_type)],
            status_keluarga: ['family_status', trimmed(input.family_status)],
            instansi: ['institution', trimmed(input.institution)],
            nama_ayah: ['father_name', trimmed(input.father_name)],
            nama_ibu: ['mother_name', trimmed(input.mother_name)],
            nik_ibu: ['mother_nik', trimmed(input.mother_nik)],
        };
        return Object.fromEntries(
            Object.entries(columns)
                .filter(([, [field]]) => creating || field in input)
                .map(([column, [, value]]) => [column, value]),
        );
    }

    // Nomor identitas, alamat KTP dan domisili, serta nomor HP dan email ditulis ke party lewat pintu Core.
    private async writeIdentity(
        partyId: string,
        input: PatientInput,
        creating: boolean,
    ): Promise<void> {
        const identifications = new PartyIdentifications(
            this.db,
            this.workspace,
        );
        for (const key of identificationKeys) {
            const type = identificationFields[key];
            const field = key;
            if (!(key in input) && !creating) continue;
            const value = trimmed(input[key]);
            if (value === null && creating) continue;
            await identifications.replaceNumber(partyId, type, value, field);
        }
        const addresses = new PartyAddresses(this.db, this.workspace);
        const references = await addresses.references();
        const purposes = new Map(
            (
                await this.db.rows(
                    z.object({ code: z.string(), name: z.string() }),
                    'select code, name from location_purposes where code in ($1, $2)',
                    [identityPurpose, domicilePurpose],
                )
            ).map((row) => [row.code, row.name]),
        );
        const links = creating ? [] : await addresses.locations(partyId);
        for (const [field, purpose] of [
            ['identity_address', identityPurpose],
            ['domicile_address', domicilePurpose],
        ] as const) {
            const value = input[field];
            if (value === undefined && !creating) continue;
            const link = links.find((item) => item.purposes.includes(purpose));
            if (!value) {
                if (link)
                    await addresses.deleteLocation(
                        partyId,
                        link.id,
                        link.version,
                    );
                continue;
            }
            const { data, problems } = checkLocation(
                {
                    name: purposes.get(purpose) ?? purpose,
                    purposes: [purpose],
                    country_region_code:
                        trimmed(value.country_region_code) ?? indonesia,
                    province_id: trimmed(value.province_id),
                    regency_id: trimmed(value.regency_id),
                    district_id: trimmed(value.district_id),
                    village_id: trimmed(value.village_id),
                    postal_code_id: trimmed(value.postal_code_id),
                    group_of_houses_id: trimmed(value.group_of_houses_id),
                    group_of_houses: trimmed(value.group_of_houses),
                    street: trimmed(value.street),
                    rt: trimmed(value.rt),
                    rw: trimmed(value.rw),
                },
                references,
            );
            await prefixed(field, async () => {
                problems.fail();
                await addresses.saveLocation(
                    partyId,
                    data,
                    link?.id ?? null,
                    link?.version ?? 0,
                );
            });
        }
        const contacts = creating ? [] : await addresses.contacts(partyId);
        for (const type of ['phone', 'email'] as const) {
            if (!(type in input) && !creating) continue;
            const value = trimmed(input[type]);
            const current =
                contacts.find(
                    (item) => item.type === type && item.is_primary,
                ) ?? contacts.find((item) => item.type === type);
            if (value === null) {
                if (current)
                    await addresses.deleteContact(
                        partyId,
                        current.id,
                        current.version,
                    );
                continue;
            }
            if (current?.value === value) continue;
            const { data, problems } = checkContact({ type, value });
            await prefixed('', async () => {
                if (problems.failed)
                    validation({
                        [type]: problems.errors.value ?? [
                            'Isian ini tidak sah.',
                        ],
                    });
                await addresses.saveContact(
                    partyId,
                    data,
                    current?.id ?? null,
                    current?.version ?? 0,
                );
            });
        }
    }

    // Cara bayar diganti seluruhnya: yang lama diarsipkan, yang dikirim ditulis baru. Pemanggil sudah memegang baris
    // pasiennya. Tipe pasien harus aktif, dan penjamin harus terdaftar untuk tipe pasien itu, seperti pilihan
    // Perusahaan form lama yang disaring per tipe pasien.
    private async writePaymentMethods(patientId: string, input: PatientInput) {
        const methods = input.payment_methods ?? [];
        const types = await this.db.rows(
            z.object({ id: z.string() }),
            'select id from sim_m_tipe_pasien where tenant_id = $1 and deleted_at is null and aktif',
            [this.workspace.tenantId],
        );
        const typeIds = new Set(types.map((row) => row.id));
        const guarantors = new Map(
            (
                await this.db.rows(
                    z.object({ id: z.string(), tipe_pasien_id: z.string() }),
                    'select id, tipe_pasien_id from sim_m_penjamin where tenant_id = $1 and deleted_at is null and aktif',
                    [this.workspace.tenantId],
                )
            ).map((row) => [row.id, row.tipe_pasien_id]),
        );
        const errors: Errors = {};
        methods.forEach((method, index) => {
            if (!typeIds.has(method.patient_type_id))
                add(
                    errors,
                    `payment_methods.${index}.patient_type_id`,
                    'Pilih tipe pasien dari daftar.',
                );
            const guarantor = trimmed(method.guarantor_id);
            if (
                guarantor !== null &&
                guarantors.get(guarantor) !== method.patient_type_id
            )
                add(
                    errors,
                    `payment_methods.${index}.guarantor_id`,
                    'Pilih penjamin untuk tipe pasien ini.',
                );
        });
        if (Object.keys(errors).length) validation(errors);
        const stamp = nowSql();
        await this.db.execute(
            'update sim_m_pasien_cara_bayar set deleted_at = $1, updated_at = $1 where tenant_id = $2 and pasien_id = $3 and deleted_at is null',
            [stamp, this.workspace.tenantId, patientId],
        );
        const primary = Math.max(
            methods.findIndex((method) => method.is_primary),
            0,
        );
        for (const [index, method] of methods.entries())
            await this.db.insert('sim_m_pasien_cara_bayar', {
                id: Bun.randomUUIDv7(),
                tenant_id: this.workspace.tenantId,
                pasien_id: patientId,
                tipe_pasien_id: method.patient_type_id,
                penjamin_id: trimmed(method.guarantor_id),
                nomor_kartu: trimmed(method.card_number),
                kelas: trimmed(method.class),
                utama: index === primary,
                urutan: index,
                created_at: stamp,
                updated_at: stamp,
            });
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('patient', 'update');
        const found = await this.require(id);
        const input = this.parse(body);
        const version = expectedVersion(request, body);
        const errors = this.check(input, true, false);
        await this.checkReferences(input, errors);
        if (Object.keys(errors).length) validation(errors);
        await this.db.transaction(async () => {
            const claimed = await this.db.execute(
                'update sim_m_pasien set version = $1 where tenant_id = $2 and id = $3 and version = $1 and deleted_at is null',
                [version, this.workspace.tenantId, found.id],
            );
            if (!claimed) coded(409, 'stale_version', staleMessage);
            await new Parties(this.db, this.workspace).updateForRole(
                found.party_id,
                this.partyInput(input),
            );
            await this.writeIdentity(found.party_id, input, false);
            const columns = this.patientColumns(input, false);
            const names = Object.keys(columns);
            if (names.length)
                await this.db.execute(
                    `update sim_m_pasien set ${names.map((name, index) => `${name} = $${index + 1}`).join(', ')},
                     updated_at = $${names.length + 1}
                 where tenant_id = $${names.length + 2} and id = $${names.length + 3}`,
                    [
                        ...Object.values(columns),
                        nowSql(),
                        this.workspace.tenantId,
                        found.id,
                    ],
                );
            if (input.payment_methods !== undefined)
                await this.writePaymentMethods(found.id, input);
        });
        return {
            status: 200,
            headers: {},
            body: { data: await this.present(found.id) },
        };
    }

    // Menghapus berarti mengisi deleted_at. Party dan perannya tetap, karena orangnya tetap ada di buku alamat.
    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('patient', 'delete');
        const found = await this.require(id);
        const stamp = nowSql();
        const deleted = await this.db.execute(
            'update sim_m_pasien set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null',
            [
                stamp,
                this.workspace.tenantId,
                found.id,
                expectedVersion(request, body),
            ],
        );
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }
}
