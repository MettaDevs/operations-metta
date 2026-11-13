import { z } from 'zod';
import type { Workspace } from '@core/platform/access/index.ts';
import {
    nowSql,
    type Bind,
    type Database,
} from '@core/platform/database/index.ts';
import {
    abort,
    coded,
    incrementalList,
    isRecord,
    lookupId,
    staleMessage,
    validation,
} from '@core/platform/http/index.ts';
import { visitVisibility } from '../../registration/visit/visit.service.ts';
import { Discharges } from '../discharge/discharge.service.ts';
import {
    examinerPanelMissingMessage,
    examinerRequiredMessage,
    isRequirableField,
    optionGroups,
    panelNames,
    panels,
    requirableFields,
    requiredMessage,
    type FieldSpec,
    type OptionGroup,
    type PanelName,
} from './medical-record.fields.ts';
import { publishExaminationCharges } from './charges.events.ts';
import { ExaminationOrders, practitionerId } from './medical-record.orders.ts';
import {
    examinationPanels,
    sectionPanels,
    type ExaminationPanel,
} from './medical-record.panels.ts';
import {
    allergySchema,
    anamnesisSchema,
    dentalSchema,
    fallRiskSchema,
    historySchema,
    medicalRecordInputSchema,
    prescriptionSendSchema,
    otherSchema,
    painSchema,
    physicalSchema,
    statusSchema,
    type MedicalRecord,
} from './medical-record.schema.ts';
import { lockChargeForChange } from '@core/foundation/billing/index.ts';
import { moduleId } from '../../module.ts';
import {
    destinationStatuses,
    recordLockedMessage,
} from '../queue/queue.statuses.ts';

type Errors = Record<string, string[]>;
type Values = Record<string, Bind>;

function add(errors: Errors, field: string, message: string): void {
    (errors[field] ??= []).push(message);
}

const panelSchemas = {
    history: historySchema,
    status: statusSchema,
    physical: physicalSchema,
    pain: painSchema,
    fall_risk: fallRiskSchema,
    dental: dentalSchema,
    other: otherSchema,
} satisfies Record<PanelName, z.ZodObject>;

function selectList(fields: Record<string, FieldSpec>): string {
    return Object.entries(fields)
        .map(([key, spec]) =>
            spec.kind === 'decimal'
                ? `${spec.column}::float8 as ${key}`
                : `${spec.column} as ${key}`,
        )
        .join(', ');
}

function emptyValues(fields: Record<string, FieldSpec>): Values {
    return Object.fromEntries(
        Object.entries(fields).map(([key, spec]) => [
            key,
            spec.kind === 'check' ? false : null,
        ]),
    );
}

function isEmpty(fields: Record<string, FieldSpec>, values: Values): boolean {
    return Object.entries(fields).every(([key, spec]) =>
        spec.kind === 'check' ? values[key] !== true : values[key] === null,
    );
}

function numeric(raw: unknown): number | null | undefined {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
    if (typeof raw !== 'string') return undefined;
    const trimmed = raw.trim().replace(',', '.');
    if (trimmed === '') return null;
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : undefined;
}

// Nilai satu isian dari kiriman layar, atau null bila kosong. Kesalahan dicatat di `errors` dengan nama isiannya.
function readField(
    spec: FieldSpec,
    raw: unknown,
    field: string,
    errors: Errors,
    options: ReadonlyMap<OptionGroup, ReadonlySet<string>>,
): Bind {
    switch (spec.kind) {
        case 'text':
        case 'option': {
            if (raw === null || raw === undefined) return null;
            if (typeof raw !== 'string') {
                add(errors, field, 'Isian ini tidak sah.');
                return null;
            }
            const value = raw.trim();
            if (value === '') return null;
            if (spec.kind === 'option') {
                if (!options.get(spec.group)?.has(value)) {
                    add(errors, field, 'Pilih dari daftar.');
                    return null;
                }
                return value;
            }
            // eslint-disable-next-line @typescript-eslint/no-misused-spread -- dihitung per code point
            if ([...value].length > spec.max) {
                add(errors, field, `Paling banyak ${spec.max} karakter.`);
                return null;
            }
            return value;
        }
        case 'check':
            if (raw === null || raw === undefined) return false;
            if (typeof raw !== 'boolean') {
                add(errors, field, 'Isian ini tidak sah.');
                return false;
            }
            return raw;
        case 'flag':
            if (raw === null || raw === undefined) return null;
            if (typeof raw !== 'boolean') {
                add(errors, field, 'Isian ini tidak sah.');
                return null;
            }
            return raw;
        case 'whole': {
            const value = numeric(raw);
            if (value === null) return null;
            if (value === undefined || !Number.isInteger(value)) {
                add(errors, field, 'Isi bilangan bulat.');
                return null;
            }
            if (value < spec.min || value > spec.max) {
                add(errors, field, `Isi angka ${spec.min} sampai ${spec.max}.`);
                return null;
            }
            return value;
        }
        case 'decimal': {
            const value = numeric(raw);
            if (value === null) return null;
            if (value === undefined || value < 0 || value >= spec.max) {
                add(errors, field, 'Isi angka 0 atau lebih.');
                return null;
            }
            return Math.round(value * 10) / 10;
        }
        default: {
            const unknown: never = spec;
            throw new Error(`Unknown field ${JSON.stringify(unknown)}`);
        }
    }
}

function readPanel(
    fields: Record<string, FieldSpec>,
    raw: Record<string, unknown> | undefined,
    prefix: string,
    errors: Errors,
    options: ReadonlyMap<OptionGroup, ReadonlySet<string>>,
): Values {
    return Object.fromEntries(
        Object.entries(fields).map(([key, spec]) => [
            key,
            readField(spec, raw?.[key], `${prefix}.${key}`, errors, options),
        ]),
    );
}

const destinationSchema = z.object({
    id: z.string(),
    status: z.enum(destinationStatuses),
    section_id: z.string(),
    visit_id: z.string(),
    legal_entity_id: z.string(),
    patient_id: z.string(),
    practitioner_id: z.string().nullable(),
    referral_note: z.string().nullable(),
    height: z.number().nullable(),
    weight: z.number().nullable(),
    gender: z.string().nullable(),
    religion: z.string().nullable(),
    occupation: z.string().nullable(),
    marital_status: z.string().nullable(),
    guarantee: z.string(),
});
type Destination = z.infer<typeof destinationSchema>;

const headerSchema = z.object({
    id: z.string(),
    version: z.number(),
    doctor_id: z.string().nullable(),
    nurse_id: z.string().nullable(),
    chief_complaint: z.string().nullable(),
    additional_complaint: z.string().nullable(),
    illness_years: z.number().nullable(),
    illness_months: z.number().nullable(),
    illness_days: z.number().nullable(),
    prognosis_id: z.string().nullable(),
});

// Daftar pendek panel Diagnosa, aturan pakai, dan rute pemberian resep milik tenant. Baris nonaktif ikut dikirim supaya
// nilai tersimpan tetap berlabel; layar hanya menawarkan yang aktif.
const referenceTables = {
    diagnosis_types: 'sim_m_diagnosa_jenis',
    diagnosis_cases: 'sim_m_diagnosa_kasus',
    prognoses: 'sim_m_prognosa',
    chronic_diseases: 'sim_m_penyakit_kronis',
    usage_instructions: 'sim_m_aturan_pakai',
    medication_routes: 'sim_m_rute_obat',
} as const;
type ReferenceList = keyof typeof referenceTables;
const referenceRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    active: z.boolean(),
});

const diagnosisRowSchema = z.object({
    id: z.string(),
    urutan: z.number(),
    icd10_id: z.string(),
    icd10_code: z.string(),
    icd10_name: z.string(),
    type_id: z.string(),
    case_id: z.string(),
    doctor_id: z.string().nullable(),
    nurse_id: z.string().nullable(),
    tooth_position: z.string().nullable(),
});
// tooth_position undefined: section ini tidak memakai Pemeriksaan dasar gigi, jadi posisi gigi tersimpan dibiarkan.
type Diagnosis = {
    icd10_id: string;
    type_id: string;
    case_id: string;
    doctor_id: string | null;
    nurse_id: string | null;
    tooth_position: string | null | undefined;
};

const historyRowSchema = z.object({
    id: z.string(),
    date: z.string(),
    icd10_code: z.string(),
    icd10_name: z.string(),
    type_name: z.string(),
    case_name: z.string(),
    doctor_name: z.string().nullable(),
    nurse_name: z.string().nullable(),
});

// Pesan sistem lama bila baris diagnosa belum berisi jenis atau kasus.
const diagnosisIncompleteMessage =
    'Field Kasus dan Jenis pada diagnosa harus di isi';

const allergyRowSchema = z.object({
    id: z.string(),
    none: z.boolean(),
    food_allergy_id: z.string().nullable(),
    airborne_allergy_id: z.string().nullable(),
    other: z.string().nullable(),
});

const anamnesisFields = {
    chief_complaint: {
        kind: 'text',
        column: 'keluhan_utama',
        max: 10000,
    },
    additional_complaint: {
        kind: 'text',
        column: 'keluhan_tambahan',
        max: 10000,
    },
    illness_years: {
        kind: 'whole',
        column: 'lama_sakit_tahun',
        min: 0,
        max: 32767,
    },
    illness_months: {
        kind: 'whole',
        column: 'lama_sakit_bulan',
        min: 0,
        max: 32767,
    },
    illness_days: {
        kind: 'whole',
        column: 'lama_sakit_hari',
        min: 0,
        max: 32767,
    },
} satisfies Record<string, FieldSpec>;

// Isian wajib periksa fisik yang kosong, dengan pesan sistem lama. Nol dihitung kosong, seperti sistem lama.
async function requiredErrors(
    db: Database,
    tenantId: string,
    physical: Values | undefined,
): Promise<Errors> {
    const required = await db.rows(
        z.object({ field: z.string() }),
        `select isian as field from sim_m_pemeriksaan_wajib
         where tenant_id = $1 and deleted_at is null order by urutan, isian`,
        [tenantId],
    );
    const errors: Errors = {};
    for (const { field } of required) {
        if (!isRequirableField(field)) continue;
        const value = physical?.[field];
        if (value === null || value === undefined || value === 0)
            add(
                errors,
                `physical.${field}`,
                requiredMessage(requirableFields[field]),
            );
    }
    return errors;
}

// Bagian yang tidak dipakai section tetapi dikirim. Sistem lama tidak pernah merender panel itu, jadi kirimannya
// ditolak, tidak diabaikan diam-diam: layar yang masih memuat susunan lama perlu dimuat ulang.
function inactivePanelErrors(
    active: readonly ExaminationPanel[],
    input: Record<string, unknown>,
): Errors {
    const errors: Errors = {};
    for (const panel of examinationPanels)
        if (!active.includes(panel.code))
            for (const key of panel.inputs)
                if (input[key] !== undefined)
                    add(
                        errors,
                        key,
                        `Bagian ${panel.label} tidak dipakai di poli ini. Muat ulang halaman pemeriksaan.`,
                    );
    return errors;
}

// Isian wajib yang belum terisi pada pemeriksaan tersimpan satu tujuan. Dipakai Selesai periksa, yang menolak
// menyelesaikan pemeriksaan yang belum lengkap. Dokter / tenaga medis yang memeriksa selalu wajib (keputusan pemilik
// produk, 13 November 2026: kunjungan tidak boleh selesai tanpa nakes tercatat); isian periksa fisik hanya wajib di
// section yang memakai Periksa fisik.
export async function missingRequired(
    db: Database,
    tenantId: string,
    destinationId: string,
    sectionId: string,
): Promise<Errors> {
    const used = await sectionPanels(db, tenantId, sectionId);
    const errors: Errors = {};
    const examiner = await db.one(
        z.object({ doctor_id: z.string().nullable() }),
        `select dokter_id as doctor_id from sim_tr_pemeriksaan
         where tenant_id = $1 and tujuan_id = $2 and deleted_at is null`,
        [tenantId, destinationId],
    );
    if (!examiner?.doctor_id)
        if (used.includes('anamnesis'))
            add(errors, 'anamnesis.doctor_id', examinerRequiredMessage);
        else add(errors, 'status', examinerPanelMissingMessage);
    if (!used.includes('physical')) return errors;
    const fields = panels.physical.fields;
    const physical = await db.one(
        z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
        `select ${selectList(fields)}
         from sim_tr_pemeriksaan_fisik f
         join sim_tr_pemeriksaan p on p.tenant_id = f.tenant_id and p.id = f.pemeriksaan_id
         where f.tenant_id = $1 and p.tujuan_id = $2 and p.deleted_at is null and f.deleted_at is null`,
        [tenantId, destinationId],
    );
    return { ...errors, ...(await requiredErrors(db, tenantId, physical)) };
}

// Isi tab Rekam Medis satu tujuan kunjungan: dibaca siapa pun yang boleh melihat antrean pemeriksaan, diubah oleh yang
// boleh memeriksa sesudah Mulai periksa, juga sesudah Selesai periksa (recordLockedMessage). Biaya yang sudah dibayar di
// kasir dikunci kasir lewat lockChargeForChange.
export class MedicalRecords {
    private readonly orders: ExaminationOrders;
    private readonly discharges: Discharges;

    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {
        this.orders = new ExaminationOrders(db, workspace);
        this.discharges = new Discharges(db, workspace);
    }

    // Data acuan layar: pilihan isian, kode alergi, bagian keadaan fisik, isian wajib, dan tenaga kesehatan.
    async metadata() {
        this.workspace.guard('examination', 'read');
        const tenantId = this.workspace.tenantId;
        const options = await this.db.rows(
            z.object({
                group: z.string(),
                code: z.string(),
                name: z.string(),
                color: z.string().nullable(),
            }),
            `select kelompok as group, kode as code, nama as name, warna as color from sim_m_pemeriksaan_pilihan
             where tenant_id = $1 and deleted_at is null order by kelompok, urutan, kode`,
            [tenantId],
        );
        const allergies = await this.db.rows(
            z.object({
                id: z.string(),
                kind: z.string(),
                code: z.string(),
                name: z.string(),
            }),
            `select id, jenis as kind, kode as code, nama as name from sim_m_alergi
             where tenant_id = $1 and deleted_at is null order by jenis, urutan, kode`,
            [tenantId],
        );
        const findings = await this.db.rows(
            z.object({
                id: z.string(),
                name: z.string(),
                gender: z.string().nullable(),
                aspects: z.array(
                    z.object({
                        id: z.string(),
                        name: z.string(),
                        normal_text: z.string().nullable(),
                    }),
                ),
            }),
            `select b.id, b.nama as name, b.jenis_kelamin as gender,
                    coalesce((select json_agg(json_build_object('id', a.id, 'name', a.nama, 'normal_text', a.teks_normal)
                                              order by a.urutan, a.kode)
                              from sim_m_keadaan_fisik_aspek a
                              where a.tenant_id = b.tenant_id and a.bagian_id = b.id and a.deleted_at is null),
                             '[]'::json) as aspects
             from sim_m_keadaan_fisik_bagian b
             where b.tenant_id = $1 and b.deleted_at is null
             order by b.urutan, b.kode`,
            [tenantId],
        );
        const required = await this.db.rows(
            z.object({ field: z.string() }),
            `select isian as field from sim_m_pemeriksaan_wajib
             where tenant_id = $1 and deleted_at is null order by urutan, isian`,
            [tenantId],
        );
        const practitioners = await this.db.rows(
            z.object({
                id: z.string(),
                name: z.string(),
                profession: z.string(),
                fills_medical_staff: z.boolean(),
                fills_nurse: z.boolean(),
                active: z.boolean(),
            }),
            `select n.id, p.name, pr.nama as profession, pr.isi_tenaga_medis as fills_medical_staff,
                    pr.isi_perawat as fills_nurse, n.aktif as active
             from sim_m_nakes n
             join parties p on p.tenant_id = n.tenant_id and p.id = n.party_id
             join sim_m_profesi pr on pr.tenant_id = n.tenant_id and pr.id = n.profesi_id
             where n.tenant_id = $1 and n.deleted_at is null
             order by p.name`,
            [tenantId],
        );
        const reference = (table: string) =>
            this.db.rows(
                referenceRowSchema,
                `select id, kode as code, nama as name, aktif as active from ${table}
                 where tenant_id = $1 and deleted_at is null order by urutan, kode`,
                [tenantId],
            );
        return {
            diagnosis_types: await reference(referenceTables.diagnosis_types),
            diagnosis_cases: await reference(referenceTables.diagnosis_cases),
            prognoses: await reference(referenceTables.prognoses),
            chronic_diseases: await reference(referenceTables.chronic_diseases),
            usage_instructions: await reference(
                referenceTables.usage_instructions,
            ),
            medication_routes: await reference(
                referenceTables.medication_routes,
            ),
            options: Object.fromEntries(
                optionGroups.map((group) => [
                    group,
                    options
                        .filter((option) => option.group === group)
                        .map(({ code, name, color }) => ({
                            code,
                            name,
                            color,
                        })),
                ]),
            ),
            allergies: {
                food: allergies.filter((row) => row.kind === 'makanan'),
                airborne: allergies.filter((row) => row.kind === 'udara'),
            },
            findings,
            required: required.flatMap(({ field }) =>
                isRequirableField(field)
                    ? [{ field, label: requirableFields[field] }]
                    : [],
            ),
            practitioners,
            discharge_statuses: await this.discharges.statuses(),
            permissions: {
                manage: this.workspace.permissions.has(
                    'healthcare.examination.manage',
                ),
                create_icd10: this.workspace.permissions.has(
                    'healthcare.icd10.create',
                ),
                create_procedure: this.workspace.permissions.has(
                    'healthcare.procedure.create',
                ),
                create_drug: this.workspace.permissions.has(
                    'healthcare.drug.create',
                ),
            },
        };
    }

    async show(destinationId: string) {
        this.workspace.guard('examination', 'read');
        const destination = await this.destination(destinationId, false);
        return this.present(destination);
    }

    // Tarif yang didapat tindakan bila ditambahkan ke Biaya Tindakan pemeriksaan ini, sama dengan yang disimpan Simpan,
    // seperti Harga_Baru baris lookup jasa sistem lama yang mengisi kolom Tarif.
    async procedureTariff(destinationId: string, procedureId: string) {
        this.workspace.guard('examination', 'read');
        const destination = await this.destination(destinationId, false);
        const tariff = lookupId(procedureId)
            ? await this.orders.procedureTariff(
                  destination.visit_id,
                  procedureId,
              )
            : null;
        if (tariff === null) abort(404, 'Not Found');
        return { data: { tariff } };
    }

    // Riwayat diagnosa: diagnosa kunjungan lain pasien ini, terbaru dulu. Hanya kunjungan yang terlihat bagi pengguna,
    // dengan batas legal entity dan unit kerja yang sama dengan antrean pemeriksaan.
    async diagnosisHistory(destinationId: string, parameters: URLSearchParams) {
        this.workspace.guard('examination', 'read');
        const destination = await this.destination(destinationId, false);
        const bindings: Bind[] = [
            this.workspace.tenantId,
            destination.patient_id,
            destination.id,
        ];
        const bind = (value: Bind) => {
            bindings.push(value);
            return `$${bindings.length}`;
        };
        const batch = await incrementalList(this.db, {
            query: `select * from (
                        select dg.id, r.tanggal::text as date, i.kode as icd10_code, i.nama as icd10_name,
                               j.nama as type_name, k.nama as case_name, dp.name as doctor_name,
                               np.name as nurse_name
                        from sim_tr_pemeriksaan_diagnosa dg
                        join sim_tr_pemeriksaan p on p.tenant_id = dg.tenant_id and p.id = dg.pemeriksaan_id
                        join sim_tr_registrasi r on r.tenant_id = p.tenant_id and r.id = p.registrasi_id
                        join sim_m_icd10 i on i.tenant_id = dg.tenant_id and i.id = dg.icd10_id
                        join sim_m_diagnosa_jenis j on j.tenant_id = dg.tenant_id and j.id = dg.jenis_id
                        join sim_m_diagnosa_kasus k on k.tenant_id = dg.tenant_id and k.id = dg.kasus_id
                        left join sim_m_nakes dn on dn.tenant_id = dg.tenant_id and dn.id = dg.dokter_id
                        left join parties dp on dp.tenant_id = dn.tenant_id and dp.id = dn.party_id
                        left join sim_m_nakes nn on nn.tenant_id = dg.tenant_id and nn.id = dg.perawat_id
                        left join parties np on np.tenant_id = nn.tenant_id and np.id = nn.party_id
                        where dg.tenant_id = $1 and p.pasien_id = $2 and p.tujuan_id <> $3
                          and dg.deleted_at is null and p.deleted_at is null and r.deleted_at is null
                          and ${visitVisibility(this.workspace, bind)}) history
                    where true`,
            bindings,
            parameters,
            columns: { date: 'date', icd10_code: 'icd10_code' },
            searchColumns: ['icd10_code', 'icd10_name'],
            numericColumns: [],
            defaultSort: 'date',
            defaultDirection: 'desc',
        });
        return {
            data: batch.data.map((row) => historyRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
        };
    }

    // Satu Simpan untuk seluruh tab, seperti satu form sistem lama. Isian wajib periksa fisik ditolak dengan pesan sistem
    // lama, karena sistem lama juga menahan Simpan (di peramban); di sini server yang memeriksanya.
    async save(destinationId: string, body: unknown) {
        this.workspace.guard('examination', 'manage');
        const parsed = medicalRecordInputSchema.safeParse(body);
        if (!parsed.success)
            validation(
                Object.fromEntries(
                    parsed.error.issues.map((issue) => [
                        issue.path.join('.') || 'input',
                        'Isian ini tidak sah.',
                    ]),
                ),
            );
        const input = parsed.data;
        await this.db.transaction(async () => {
            const destination = await this.destination(destinationId, true);
            const locked = recordLockedMessage(destination.status);
            if (locked) validation({ status: locked });
            const active = await sectionPanels(
                this.db,
                this.workspace.tenantId,
                destination.section_id,
            );
            const uses = (panel: ExaminationPanel) => active.includes(panel);
            const errors: Errors = inactivePanelErrors(active, input);
            const options = await this.optionSets();
            const header = await this.header(destination.id, true);
            const anamnesis = uses('anamnesis')
                ? readPanel(
                      anamnesisFields,
                      input.anamnesis,
                      'anamnesis',
                      errors,
                      options,
                  )
                : null;
            const doctorId = uses('anamnesis')
                ? await this.practitioner(
                      input.anamnesis?.doctor_id,
                      'isi_tenaga_medis',
                      header?.doctor_id ?? null,
                      'anamnesis.doctor_id',
                      errors,
                  )
                : null;
            // Pemeriksaan yang sudah selesai tetap punya dokter / tenaga medis yang memeriksa, juga sesudah Update.
            if (
                destination.status === 'selesai' &&
                uses('anamnesis') &&
                doctorId === null &&
                !errors['anamnesis.doctor_id']
            )
                add(errors, 'anamnesis.doctor_id', examinerRequiredMessage);
            const nurseId = uses('anamnesis')
                ? await this.practitioner(
                      input.anamnesis?.nurse_id,
                      'isi_perawat',
                      header?.nurse_id ?? null,
                      'anamnesis.nurse_id',
                      errors,
                  )
                : null;
            const usedPanels = panelNames.filter((name) => uses(name));
            const values = Object.fromEntries(
                usedPanels.map((name) => [
                    name,
                    readPanel(
                        panels[name].fields,
                        input[name],
                        name,
                        errors,
                        options,
                    ),
                ]),
            );
            const allergy = uses('history')
                ? await this.readAllergy(input.allergy, errors)
                : null;
            const findings = uses('findings')
                ? await this.readFindings(input.findings, errors)
                : null;
            const anatomy = uses('anatomy')
                ? this.readAnatomy(input.anatomy, errors)
                : null;
            const diagnoses = uses('diagnoses')
                ? await this.readDiagnoses(
                      input.diagnoses,
                      header?.id ?? null,
                      uses('dental'),
                      errors,
                  )
                : null;
            const prognosisId = uses('prognosis')
                ? await this.reference(
                      'prognoses',
                      input.prognosis_id,
                      header?.prognosis_id ?? null,
                      'prognosis_id',
                      errors,
                  )
                : null;
            const chronicDiseaseIds = uses('prognosis')
                ? await this.readChronicDiseases(
                      input.chronic_disease_ids,
                      header?.id ?? null,
                      errors,
                  )
                : null;
            const drugAllergies = uses('history')
                ? await this.orders.readDrugAllergies(
                      input.drug_allergies,
                      errors,
                  )
                : null;
            const procedures = uses('procedures')
                ? await this.orders.readProcedures(
                      input.procedures,
                      header?.id ?? null,
                      errors,
                  )
                : null;
            // Obat yang dicatat alergi pada Simpan yang sama ikut ditolak di resep.
            const prescriptions = uses('prescriptions')
                ? await this.orders.readPrescriptions(
                      input.prescriptions,
                      header?.id ?? null,
                      destination.legal_entity_id,
                      new Set(
                          drugAllergies ??
                              (
                                  await this.orders.drugAllergies(
                                      destination.patient_id,
                                  )
                              ).map((row) => row.drug_id),
                      ),
                      errors,
                  )
                : null;
            const discharge = uses('discharge')
                ? await this.discharges.read(
                      input.discharge,
                      await this.savedDischarge(destination.id),
                      options,
                      errors,
                  )
                : null;
            if (values.physical) {
                const required = await requiredErrors(
                    this.db,
                    this.workspace.tenantId,
                    values.physical,
                );
                for (const [field, messages] of Object.entries(required))
                    for (const message of messages) add(errors, field, message);
            }
            if (Object.keys(errors).length) validation(errors);

            // Isi panel yang tidak dipakai section tetap seperti tersimpan.
            const stamp = nowSql();
            const headerValues: Values = {
                ...(anamnesis
                    ? {
                          dokter_id: doctorId,
                          perawat_id: nurseId,
                          keluhan_utama: anamnesis.chief_complaint ?? null,
                          keluhan_tambahan:
                              anamnesis.additional_complaint ?? null,
                          lama_sakit_tahun: anamnesis.illness_years ?? null,
                          lama_sakit_bulan: anamnesis.illness_months ?? null,
                          lama_sakit_hari: anamnesis.illness_days ?? null,
                      }
                    : {}),
                ...(uses('prognosis') ? { prognosa_id: prognosisId } : {}),
            };
            let recordId: string;
            if (header) {
                if (input.version !== header.version)
                    coded(409, 'stale_version', staleMessage);
                recordId = header.id;
                await this.update('sim_tr_pemeriksaan', recordId, {
                    ...headerValues,
                    updated_at: stamp,
                });
            } else {
                if (input.version !== null && input.version !== undefined)
                    coded(409, 'stale_version', staleMessage);
                recordId = Bun.randomUUIDv7();
                await this.db.insert('sim_tr_pemeriksaan', {
                    id: recordId,
                    tenant_id: this.workspace.tenantId,
                    tujuan_id: destination.id,
                    registrasi_id: destination.visit_id,
                    pasien_id: destination.patient_id,
                    ...headerValues,
                    created_at: stamp,
                    updated_at: stamp,
                });
            }
            for (const name of usedPanels)
                await this.writePanel(
                    name,
                    recordId,
                    values[name] ?? {},
                    stamp,
                );
            if (allergy)
                await this.writeAllergy(
                    destination.patient_id,
                    recordId,
                    allergy,
                    stamp,
                );
            if (findings) await this.writeFindings(recordId, findings, stamp);
            if (anatomy) await this.writeAnatomy(recordId, anatomy, stamp);
            if (diagnoses)
                await this.writeDiagnoses(recordId, diagnoses, stamp);
            if (chronicDiseaseIds)
                await this.writeChronicDiseases(
                    recordId,
                    chronicDiseaseIds,
                    stamp,
                );
            if (drugAllergies)
                await this.orders.writeDrugAllergies(
                    destination.patient_id,
                    recordId,
                    drugAllergies,
                    stamp,
                );
            if (procedures) {
                await lockChargeForChange(this.db, {
                    tenantId: this.workspace.tenantId,
                    sourceModule: moduleId,
                    visitId: destination.visit_id,
                });
                await this.orders.writeProcedures(
                    recordId,
                    destination.visit_id,
                    procedures,
                    stamp,
                );
                await publishExaminationCharges(
                    this.db,
                    this.workspace.tenantId,
                    recordId,
                );
            }
            if (prescriptions)
                await this.orders.writePrescriptions(
                    recordId,
                    prescriptions,
                    stamp,
                );
            if (discharge)
                await this.discharges.write(destination.id, discharge, stamp);
        });
        return this.present(await this.destination(destinationId, false));
    }

    // Kirim ke farmasi menyimpan draf resep lalu mengirimnya dalam satu transaksi, seperti SubmitEresep sistem lama yang
    // hanya membawa resep dan barisnya: isian rekam medis lain tidak ikut disimpan dan tidak diperiksa, jadi tetap di
    // layar sampai Simpan. Dokter dan perawat resep diambil dari Anamnesa yang sedang diisi. Batas ubahnya sama dengan
    // Simpan, dengan versi pemeriksaan yang dipegang layar.
    async sendPrescription(destinationId: string, body: unknown) {
        this.workspace.guard('examination', 'manage');
        const parsed = prescriptionSendSchema.safeParse(body);
        if (!parsed.success)
            validation(
                Object.fromEntries(
                    parsed.error.issues.map((issue) => [
                        issue.path.join('.') || 'input',
                        'Isian ini tidak sah.',
                    ]),
                ),
            );
        const input = parsed.data;
        await this.db.transaction(async () => {
            const destination = await this.destination(destinationId, true);
            const locked = recordLockedMessage(destination.status);
            if (locked) validation({ status: locked });
            const active = await sectionPanels(
                this.db,
                this.workspace.tenantId,
                destination.section_id,
            );
            if (!active.includes('prescriptions'))
                validation({
                    prescriptions:
                        'Bagian E-Resep tidak dipakai di poli ini. Muat ulang halaman pemeriksaan.',
                });
            const header = await this.header(destination.id, true);
            if (
                header
                    ? input.version !== header.version
                    : input.version !== null && input.version !== undefined
            )
                coded(409, 'stale_version', staleMessage);
            const errors: Errors = {};
            const doctorId = await this.practitioner(
                input.doctor_id,
                'isi_tenaga_medis',
                header?.doctor_id ?? null,
                'anamnesis.doctor_id',
                errors,
            );
            const nurseId = await this.practitioner(
                input.nurse_id,
                'isi_perawat',
                header?.nurse_id ?? null,
                'anamnesis.nurse_id',
                errors,
            );
            const drafts = await this.orders.readPrescriptions(
                input.prescriptions,
                header?.id ?? null,
                destination.legal_entity_id,
                new Set(
                    (
                        await this.orders.drugAllergies(destination.patient_id)
                    ).map((row) => row.drug_id),
                ),
                errors,
            );
            if (Object.keys(errors).length) validation(errors);
            const stamp = nowSql();
            let recordId = header?.id;
            if (!recordId) {
                recordId = Bun.randomUUIDv7();
                await this.db.insert('sim_tr_pemeriksaan', {
                    id: recordId,
                    tenant_id: this.workspace.tenantId,
                    tujuan_id: destination.id,
                    registrasi_id: destination.visit_id,
                    pasien_id: destination.patient_id,
                    created_at: stamp,
                    updated_at: stamp,
                });
            }
            await this.orders.writePrescriptions(recordId, drafts, stamp);
            const visit = await this.db.one(
                z.object({ operating_unit_id: z.string(), date: z.string() }),
                `select operating_unit_id, tanggal::text as date from sim_tr_registrasi
                 where tenant_id = $1 and id = $2`,
                [this.workspace.tenantId, destination.visit_id],
            );
            if (!visit) abort(404, 'Not Found');
            await this.orders.send(recordId, visit, stamp, {
                doctorId,
                nurseId,
            });
        });
        return this.present(await this.destination(destinationId, false));
    }

    // Tujuan yang terlihat bagi pengguna beserta pasien dan kunjungannya. Yang lain dijawab 404.
    private async destination(id: string, lock: boolean): Promise<Destination> {
        const bindings: Bind[] = [this.workspace.tenantId, lookupId(id)];
        const bind = (value: Bind) => {
            bindings.push(value);
            return `$${bindings.length}`;
        };
        const found = bindings[1]
            ? await this.db.one(
                  destinationSchema,
                  `select d.id, d.status, d.section_id, r.id as visit_id, r.legal_entity_id, r.pasien_id as patient_id,
                          d.nakes_id as practitioner_id, d.catatan_rujukan as referral_note,
                          r.tinggi_badan::float8 as height, r.berat_badan::float8 as weight, p.gender,
                          rv.name as religion, oc.name as occupation, mv.name as marital_status,
                          coalesce(gp.name, t.nama) as guarantee
                   from sim_tr_registrasi_tujuan d
                   join sim_tr_registrasi r on r.tenant_id = d.tenant_id and r.id = d.registrasi_id
                   join sim_m_pasien k on k.tenant_id = r.tenant_id and k.id = r.pasien_id
                   join parties p on p.tenant_id = k.tenant_id and p.id = k.party_id
                   join sim_m_tipe_pasien t on t.tenant_id = r.tenant_id and t.id = r.tipe_pasien_id
                   left join sim_m_penjamin g on g.tenant_id = r.tenant_id and g.id = r.penjamin_id
                   left join parties gp on gp.tenant_id = g.tenant_id and gp.id = g.party_id
                   left join party_reference_values rv on rv.category = 'religion' and rv.code = p.religion
                   left join party_reference_values mv on mv.category = 'marital_status' and mv.code = p.marital_status
                   left join occupations oc on oc.tenant_id = p.tenant_id and oc.id = p.occupation_id
                   where d.tenant_id = $1 and d.id = $2 and d.deleted_at is null and r.deleted_at is null
                     and ${visitVisibility(this.workspace, bind)}
                   ${lock ? 'for update of d' : ''}`,
                  bindings,
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private async savedDischarge(destinationId: string) {
        const saved = await this.db.one(
            z.object({
                status_id: z.string().nullable(),
                consultant_id: z.string().nullable(),
            }),
            `select status_pulang_id as status_id, dokter_konsul_id as consultant_id from sim_tr_registrasi_tujuan
             where tenant_id = $1 and id = $2`,
            [this.workspace.tenantId, destinationId],
        );
        return saved ?? { status_id: null, consultant_id: null };
    }

    private async header(destinationId: string, lock: boolean) {
        return this.db.one(
            headerSchema,
            `select id, version, dokter_id as doctor_id, perawat_id as nurse_id,
                    keluhan_utama as chief_complaint, keluhan_tambahan as additional_complaint,
                    lama_sakit_tahun as illness_years, lama_sakit_bulan as illness_months,
                    lama_sakit_hari as illness_days, prognosa_id as prognosis_id
             from sim_tr_pemeriksaan
             where tenant_id = $1 and tujuan_id = $2 and deleted_at is null
             ${lock ? 'for update' : ''}`,
            [this.workspace.tenantId, destinationId],
        );
    }

    private async panelRow(name: PanelName, recordId: string) {
        const { table, fields } = panels[name];
        return this.db.one(
            z.record(
                z.string(),
                z.union([z.string(), z.number(), z.boolean(), z.null()]),
            ),
            `select id, ${selectList(fields)} from ${table}
             where tenant_id = $1 and pemeriksaan_id = $2 and deleted_at is null`,
            [this.workspace.tenantId, recordId],
        );
    }

    private async allergyRow(patientId: string) {
        return this.db.one(
            allergyRowSchema,
            `select id, tidak_ada as none, alergi_makanan_id as food_allergy_id,
                    alergi_udara_id as airborne_allergy_id, alergi_lainnya as other
             from sim_m_pasien_alergi
             where tenant_id = $1 and pasien_id = $2 and deleted_at is null`,
            [this.workspace.tenantId, patientId],
        );
    }

    // Isi rekam medis dengan panel yang dipakai section tujuan saja, dalam bentuk yang dikirim kembali saat Simpan.
    private async present(destination: Destination) {
        const tenantId = this.workspace.tenantId;
        const active = await sectionPanels(
            this.db,
            tenantId,
            destination.section_id,
        );
        const uses = (panel: ExaminationPanel) => active.includes(panel);
        const header = await this.header(destination.id, false);
        const panelValues: Partial<Record<PanelName, Values>> = {};
        for (const name of panelNames.filter((panel) => uses(panel))) {
            const row = header
                ? await this.panelRow(name, header.id)
                : undefined;
            panelValues[name] = row ?? emptyValues(panels[name].fields);
        }
        // Pemeriksaan baru dibuka dengan nilai awal form sistem lama: dokter kunjungan, tinggi dan berat badan dari
        // pendaftaran, pilihan pertama pada isian yang tidak punya pilihan kosong, dan Tidak pada pertanyaan Ya/Tidak
        // status fisik.
        if (!header) {
            const first = await this.db.rows(
                z.object({ group: z.string(), code: z.string() }),
                `select distinct on (kelompok) kelompok as group, kode as code from sim_m_pemeriksaan_pilihan
                 where tenant_id = $1 and deleted_at is null
                   and kelompok in ('ekspresi_emosi', 'cara_ukur_tinggi')
                 order by kelompok, urutan, kode`,
                [tenantId],
            );
            const firstOf = (group: string) =>
                first.find((row) => row.group === group)?.code ?? null;
            if (panelValues.physical)
                panelValues.physical = {
                    ...panelValues.physical,
                    height: destination.height,
                    weight: destination.weight,
                    height_method: firstOf('cara_ukur_tinggi'),
                };
            if (panelValues.status)
                panelValues.status = {
                    ...panelValues.status,
                    uses_mobility_aid: false,
                    communication_barrier: false,
                    caregiver_at_home: false,
                    needs_assistance: false,
                    emotional_expression: firstOf('ekspresi_emosi'),
                };
        }
        const data: MedicalRecord = {
            id: header?.id ?? null,
            version: header?.version ?? null,
        };
        if (uses('anamnesis'))
            data.anamnesis = anamnesisSchema.parse({
                doctor_id: header
                    ? header.doctor_id
                    : destination.practitioner_id,
                nurse_id: header?.nurse_id ?? null,
                chief_complaint: header
                    ? header.chief_complaint
                    : destination.referral_note,
                additional_complaint: header?.additional_complaint ?? null,
                illness_years: header?.illness_years ?? null,
                illness_months: header?.illness_months ?? null,
                illness_days: header?.illness_days ?? null,
            });
        if (uses('history')) {
            data.history = panelSchemas.history.parse(panelValues.history);
            data.allergy = await this.presentAllergy(destination.patient_id);
            data.drug_allergies = await this.orders.drugAllergies(
                destination.patient_id,
            );
        }
        if (uses('status'))
            data.status = panelSchemas.status.parse(panelValues.status);
        if (uses('physical'))
            data.physical = panelSchemas.physical.parse(panelValues.physical);
        if (uses('pain')) data.pain = panelSchemas.pain.parse(panelValues.pain);
        if (uses('fall_risk'))
            data.fall_risk = panelSchemas.fall_risk.parse(
                panelValues.fall_risk,
            );
        if (uses('dental'))
            data.dental = panelSchemas.dental.parse(panelValues.dental);
        if (uses('findings'))
            data.findings = header
                ? await this.db.rows(
                      z.object({
                          aspect_id: z.string(),
                          result: z.string().nullable(),
                      }),
                      `select k.aspek_id as aspect_id, k.hasil as result
                       from sim_tr_pemeriksaan_keadaan_fisik k
                       join sim_m_keadaan_fisik_aspek a on a.tenant_id = k.tenant_id and a.id = k.aspek_id
                       join sim_m_keadaan_fisik_bagian b on b.tenant_id = a.tenant_id and b.id = a.bagian_id
                       where k.tenant_id = $1 and k.pemeriksaan_id = $2 and k.deleted_at is null
                       order by b.urutan, b.kode, a.urutan, a.kode`,
                      [tenantId, header.id],
                  )
                : [];
        if (uses('anatomy'))
            data.anatomy = header
                ? await this.db.rows(
                      z.object({
                          id: z.string(),
                          body_part: z.string(),
                          description: z.string(),
                      }),
                      `select id, bagian_tubuh as body_part, keterangan as description from sim_tr_pemeriksaan_anatomi
                       where tenant_id = $1 and pemeriksaan_id = $2 and deleted_at is null order by urutan, id`,
                      [tenantId, header.id],
                  )
                : [];
        if (uses('other'))
            data.other = panelSchemas.other.parse(panelValues.other);
        if (uses('diagnoses'))
            data.diagnoses = (
                header ? await this.diagnosisRows(header.id) : []
            ).map((row) => ({
                icd10_id: row.icd10_id,
                icd10_code: row.icd10_code,
                icd10_name: row.icd10_name,
                type_id: row.type_id,
                case_id: row.case_id,
                doctor_id: row.doctor_id,
                nurse_id: row.nurse_id,
                ...(uses('dental')
                    ? { tooth_position: row.tooth_position }
                    : {}),
            }));
        if (uses('prognosis')) {
            data.prognosis_id = header?.prognosis_id ?? null;
            data.chronic_disease_ids = header
                ? await this.chronicDiseaseIds(header.id)
                : [];
        }
        if (uses('procedures'))
            data.procedures = await this.orders.procedures(header?.id ?? null);
        if (uses('prescriptions'))
            data.prescriptions = await this.orders.prescriptions(
                header?.id ?? null,
                destination.legal_entity_id,
            );
        if (uses('discharge'))
            data.discharge = await this.discharges.present(destination.id);
        const measurement =
            uses('physical') && header
                ? await this.db.one(
                      z.object({
                          measured_at: z.string(),
                          measured_by_name: z.string().nullable(),
                      }),
                      `select to_char(f.diukur_pada, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as measured_at,
                              u.name as measured_by_name
                       from sim_tr_pemeriksaan_fisik f
                       left join users u on u.id = f.diukur_oleh
                       where f.tenant_id = $1 and f.pemeriksaan_id = $2 and f.deleted_at is null`,
                      [tenantId, header.id],
                  )
                : undefined;
        return {
            data,
            context: {
                // Waktu ukur dan pengukur Periksa fisik yang tersimpan.
                physical_measured_at: measurement?.measured_at ?? null,
                physical_measured_by_name:
                    measurement?.measured_by_name ?? null,
                status: destination.status,
                panels: active,
                editable:
                    recordLockedMessage(destination.status) === null &&
                    this.workspace.permissions.has(
                        'healthcare.examination.manage',
                    ),
                gender: destination.gender,
                religion: destination.religion,
                occupation: destination.occupation,
                marital_status: destination.marital_status,
                guarantee: destination.guarantee,
            },
        };
    }

    // Alergi pasien, atau nilai awal form sistem lama bila pasien belum punya catatan alergi: pilihan pertama alergi
    // makanan dan udara.
    private async presentAllergy(
        patientId: string,
    ): Promise<z.infer<typeof allergySchema>> {
        const allergy = await this.allergyRow(patientId);
        if (allergy) return allergySchema.parse(allergy);
        const first = await this.db.rows(
            z.object({ kind: z.string(), id: z.string() }),
            `select distinct on (jenis) jenis as kind, id from sim_m_alergi
             where tenant_id = $1 and deleted_at is null and jenis in ('makanan', 'udara')
             order by jenis, urutan, kode`,
            [this.workspace.tenantId],
        );
        return {
            none: false,
            food_allergy_id:
                first.find((row) => row.kind === 'makanan')?.id ?? null,
            airborne_allergy_id:
                first.find((row) => row.kind === 'udara')?.id ?? null,
            other: null,
        };
    }

    private async optionSets() {
        const rows = await this.db.rows(
            z.object({ group: z.string(), code: z.string() }),
            `select kelompok as group, kode as code from sim_m_pemeriksaan_pilihan
             where tenant_id = $1 and deleted_at is null`,
            [this.workspace.tenantId],
        );
        const sets = new Map<OptionGroup, Set<string>>();
        for (const group of optionGroups)
            sets.set(
                group,
                new Set(
                    rows
                        .filter((row) => row.group === group)
                        .map((row) => row.code),
                ),
            );
        return sets;
    }

    private async practitioner(
        raw: unknown,
        role: 'isi_tenaga_medis' | 'isi_perawat',
        saved: string | null,
        field: string,
        errors: Errors,
    ): Promise<string | null> {
        return practitionerId(
            this.db,
            this.workspace.tenantId,
            raw,
            role,
            saved,
            field,
            errors,
        );
    }

    private async allergyId(
        raw: unknown,
        kind: 'makanan' | 'udara',
        field: string,
        errors: Errors,
    ): Promise<string | null> {
        if (raw === null || raw === undefined || raw === '') return null;
        const id = typeof raw === 'string' ? lookupId(raw) : null;
        const found = id
            ? await this.db.one(
                  z.object({ id: z.string() }),
                  'select id from sim_m_alergi where tenant_id = $1 and id = $2 and jenis = $3 and deleted_at is null',
                  [this.workspace.tenantId, id, kind],
              )
            : undefined;
        if (!found) add(errors, field, 'Pilih dari daftar.');
        return found?.id ?? null;
    }

    private async readAllergy(
        raw: Record<string, unknown> | undefined,
        errors: Errors,
    ) {
        const rest = readPanel(
            {
                none: { kind: 'check', column: 'tidak_ada' },
                other: { kind: 'text', column: 'alergi_lainnya', max: 500 },
            },
            raw,
            'allergy',
            errors,
            new Map(),
        );
        return {
            tidak_ada: rest.none ?? false,
            alergi_makanan_id: await this.allergyId(
                raw?.food_allergy_id,
                'makanan',
                'allergy.food_allergy_id',
                errors,
            ),
            alergi_udara_id: await this.allergyId(
                raw?.airborne_allergy_id,
                'udara',
                'allergy.airborne_allergy_id',
                errors,
            ),
            alergi_lainnya: rest.other ?? null,
        };
    }

    // Aspek keadaan fisik yang diperiksa. Aspek yang tidak dikenal ditolak; aspek ganda dihitung sekali.
    private async readFindings(raw: unknown[] | undefined, errors: Errors) {
        const known = new Set(
            (
                await this.db.rows(
                    z.object({ id: z.string() }),
                    'select id from sim_m_keadaan_fisik_aspek where tenant_id = $1 and deleted_at is null',
                    [this.workspace.tenantId],
                )
            ).map((row) => row.id),
        );
        const findings = new Map<string, string | null>();
        for (const [index, item] of (raw ?? []).entries()) {
            const aspectId =
                isRecord(item) && typeof item.aspect_id === 'string'
                    ? item.aspect_id
                    : null;
            if (!aspectId || !known.has(aspectId)) {
                add(errors, `findings.${index}`, 'Isian ini tidak sah.');
                continue;
            }
            const result = readField(
                { kind: 'text', column: 'hasil', max: 10000 },
                isRecord(item) ? item.result : null,
                `findings.${index}.result`,
                errors,
                new Map(),
            );
            findings.set(aspectId, typeof result === 'string' ? result : null);
        }
        return findings;
    }

    // Baris anatomi tubuh. Bagian tubuh dan keterangan wajib, seperti popup sistem lama.
    private readAnatomy(raw: unknown[] | undefined, errors: Errors) {
        return (raw ?? []).map((item, index) => {
            const values = readPanel(
                {
                    id: { kind: 'text', column: 'id', max: 36 },
                    body_part: {
                        kind: 'text',
                        column: 'bagian_tubuh',
                        max: 200,
                    },
                    description: {
                        kind: 'text',
                        column: 'keterangan',
                        max: 10000,
                    },
                },
                isRecord(item) ? item : undefined,
                `anatomy.${index}`,
                errors,
                new Map(),
            );
            if (values.body_part === null)
                add(errors, `anatomy.${index}.body_part`, 'Isi bagian tubuh.');
            if (values.description === null)
                add(errors, `anatomy.${index}.description`, 'Isi keterangan.');
            return {
                id: typeof values.id === 'string' ? lookupId(values.id) : null,
                body_part: String(values.body_part ?? ''),
                description: String(values.description ?? ''),
            };
        });
    }

    private async diagnosisRows(recordId: string) {
        return this.db.rows(
            diagnosisRowSchema,
            `select dg.id, dg.urutan, dg.icd10_id, i.kode as icd10_code, i.nama as icd10_name, dg.jenis_id as type_id,
                    dg.kasus_id as case_id, dg.dokter_id as doctor_id, dg.perawat_id as nurse_id,
                    dg.posisi_gigi as tooth_position
             from sim_tr_pemeriksaan_diagnosa dg
             join sim_m_icd10 i on i.tenant_id = dg.tenant_id and i.id = dg.icd10_id
             where dg.tenant_id = $1 and dg.pemeriksaan_id = $2 and dg.deleted_at is null
             order by dg.urutan, dg.id`,
            [this.workspace.tenantId, recordId],
        );
    }

    private async chronicDiseaseIds(recordId: string): Promise<string[]> {
        return (
            await this.db.rows(
                z.object({ id: z.string() }),
                `select k.penyakit_kronis_id as id from sim_tr_pemeriksaan_penyakit_kronis k
                 join sim_m_penyakit_kronis m on m.tenant_id = k.tenant_id and m.id = k.penyakit_kronis_id
                 where k.tenant_id = $1 and k.pemeriksaan_id = $2 and k.deleted_at is null
                 order by m.urutan, m.kode`,
                [this.workspace.tenantId, recordId],
            )
        ).map((row) => row.id);
    }

    // Baris aktif daftar pendek panel Diagnosa, atau baris yang sudah tersimpan di pemeriksaan ini walau sejak itu
    // nonaktif.
    private async reference(
        list: ReferenceList,
        raw: unknown,
        saved: string | null,
        field: string,
        errors: Errors,
    ): Promise<string | null> {
        if (raw === null || raw === undefined || raw === '') return null;
        const id = typeof raw === 'string' ? lookupId(raw) : null;
        const found = id
            ? await this.db.one(
                  z.object({ id: z.string() }),
                  `select id from ${referenceTables[list]}
                   where tenant_id = $1 and id = $2 and deleted_at is null and (aktif or id = $3)`,
                  [this.workspace.tenantId, id, saved],
              )
            : undefined;
        if (!found) add(errors, field, 'Pilih dari daftar.');
        return found?.id ?? null;
    }

    // Baris diagnosa. Jenis dan kasus wajib dengan pesan sistem lama; sistem lama tidak mewajibkan ada diagnosa.
    // ICD-10, jenis, kasus, dan nakes yang sudah tersimpan di baris ini tetap diterima walau sejak itu nonaktif.
    private async readDiagnoses(
        raw: unknown[] | undefined,
        recordId: string | null,
        usesDental: boolean,
        errors: Errors,
    ): Promise<Diagnosis[]> {
        const saved = recordId ? await this.diagnosisRows(recordId) : [];
        const missing = (value: unknown) =>
            value === null || value === undefined || value === '';
        const rows: Diagnosis[] = [];
        const seen = new Set<string>();
        for (const [index, item] of (raw ?? []).entries()) {
            const row = isRecord(item) ? item : {};
            const field = (name: string) => `diagnoses.${index}.${name}`;
            const icd10Id =
                typeof row.icd10_id === 'string'
                    ? lookupId(row.icd10_id)
                    : null;
            const before = saved.find((line) => line.icd10_id === icd10Id);
            let icd10: string | null = null;
            if (missing(row.icd10_id))
                add(errors, field('icd10_id'), 'Pilih kode ICD-10.');
            else {
                const found = icd10Id
                    ? await this.db.one(
                          z.object({ id: z.string() }),
                          `select id from sim_m_icd10
                           where tenant_id = $1 and id = $2 and deleted_at is null and (aktif or $3)`,
                          [this.workspace.tenantId, icd10Id, Boolean(before)],
                      )
                    : undefined;
                if (!found)
                    add(
                        errors,
                        field('icd10_id'),
                        'Pilih kode ICD-10 dari daftar.',
                    );
                else if (seen.has(found.id))
                    add(
                        errors,
                        field('icd10_id'),
                        'Kode ICD-10 ini sudah ada di diagnosa.',
                    );
                else {
                    seen.add(found.id);
                    icd10 = found.id;
                }
            }
            if (missing(row.type_id))
                add(errors, field('type_id'), diagnosisIncompleteMessage);
            if (missing(row.case_id))
                add(errors, field('case_id'), diagnosisIncompleteMessage);
            const typeId = await this.reference(
                'diagnosis_types',
                row.type_id,
                before?.type_id ?? null,
                field('type_id'),
                errors,
            );
            const caseId = await this.reference(
                'diagnosis_cases',
                row.case_id,
                before?.case_id ?? null,
                field('case_id'),
                errors,
            );
            const doctorId = await this.practitioner(
                row.doctor_id,
                'isi_tenaga_medis',
                before?.doctor_id ?? null,
                field('doctor_id'),
                errors,
            );
            const nurseId = await this.practitioner(
                row.nurse_id,
                'isi_perawat',
                before?.nurse_id ?? null,
                field('nurse_id'),
                errors,
            );
            const toothPosition = readField(
                { kind: 'text', column: 'posisi_gigi', max: 50 },
                row.tooth_position,
                field('tooth_position'),
                errors,
                new Map(),
            );
            if (!usesDental && toothPosition !== null)
                add(
                    errors,
                    field('tooth_position'),
                    'Posisi gigi hanya diisi di poli yang memakai Pemeriksaan dasar gigi.',
                );
            if (icd10 && typeId && caseId)
                rows.push({
                    icd10_id: icd10,
                    type_id: typeId,
                    case_id: caseId,
                    doctor_id: doctorId,
                    nurse_id: nurseId,
                    tooth_position: usesDental
                        ? typeof toothPosition === 'string'
                            ? toothPosition
                            : null
                        : undefined,
                });
        }
        return rows;
    }

    // Penyakit kronis yang dicentang. Yang ganda dihitung sekali.
    private async readChronicDiseases(
        raw: unknown[] | undefined,
        recordId: string | null,
        errors: Errors,
    ): Promise<string[]> {
        const saved = recordId ? await this.chronicDiseaseIds(recordId) : [];
        const ids = new Set<string>();
        for (const [index, item] of (raw ?? []).entries()) {
            const id = await this.reference(
                'chronic_diseases',
                item,
                typeof item === 'string' && saved.includes(item) ? item : null,
                `chronic_disease_ids.${index}`,
                errors,
            );
            if (id) ids.add(id);
        }
        return [...ids];
    }

    private async update(
        table: string,
        id: string,
        values: Values,
    ): Promise<void> {
        const columns = Object.keys(values);
        if (columns.some((column) => !/^[a-z_][a-z0-9_]*$/.test(column)))
            throw new Error('Invalid internal SQL identifier.');
        await this.db.execute(
            `update ${table} set ${columns.map((column, index) => `${column} = $${index + 3}`).join(', ')}
             where tenant_id = $1 and id = $2`,
            [this.workspace.tenantId, id, ...Object.values(values)],
        );
    }

    private async retire(table: string, id: string, stamp: string) {
        await this.update(table, id, { deleted_at: stamp, updated_at: stamp });
    }

    // Panel satu baris: ditulis hanya bila berisi. Panel yang dikosongkan diberi deleted_at, bukan dihapus.
    private async writePanel(
        name: PanelName,
        recordId: string,
        values: Values,
        stamp: string,
    ): Promise<void> {
        const { table, fields } = panels[name];
        const existing = await this.panelRow(name, recordId);
        const existingId =
            typeof existing?.id === 'string' ? existing.id : null;
        if (isEmpty(fields, values)) {
            if (existingId) await this.retire(table, existingId, stamp);
            return;
        }
        const columns: Values = Object.fromEntries(
            Object.entries(fields).map(([key, spec]) => [
                spec.column,
                values[key] ?? null,
            ]),
        );
        const measured = name === 'physical';
        if (existingId && measured)
            await this.updateMeasurement(existingId, columns, stamp);
        else if (existingId)
            await this.update(table, existingId, {
                ...columns,
                updated_at: stamp,
            });
        else
            await this.db.insert(table, {
                id: Bun.randomUUIDv7(),
                tenant_id: this.workspace.tenantId,
                pemeriksaan_id: recordId,
                ...columns,
                ...(measured
                    ? { diukur_pada: stamp, diukur_oleh: this.workspace.userId }
                    : {}),
                created_at: stamp,
                updated_at: stamp,
            });
    }

    // Periksa fisik: waktu ukur dan pengukurnya hanya bergeser bila salah satu nilainya berubah, jadi Simpan bagian lain
    // tidak mengubah waktu ukur tanda vital.
    private async updateMeasurement(
        id: string,
        columns: Values,
        stamp: string,
    ): Promise<void> {
        const names = Object.keys(columns);
        if (names.some((column) => !/^[a-z_][a-z0-9_]*$/.test(column)))
            throw new Error('Invalid internal SQL identifier.');
        const params = names.map((_, index) => `$${index + 5}`);
        // Pembanding memakai parameter sendiri: varchar = $n dan varchar is distinct from $n membuat PostgreSQL menebak
        // dua tipe berbeda untuk parameter yang sama.
        const changed = names
            .map(
                (column, index) =>
                    `${column} is distinct from $${index + 5 + names.length}`,
            )
            .join(' or ');
        await this.db.execute(
            `update sim_tr_pemeriksaan_fisik
             set ${names.map((column, index) => `${column} = ${params[index] ?? ''}`).join(', ')}, updated_at = $3,
                 diukur_pada = case when ${changed} then $3 else diukur_pada end,
                 diukur_oleh = case when ${changed} then $4 else diukur_oleh end
             where tenant_id = $1 and id = $2`,
            [
                this.workspace.tenantId,
                id,
                stamp,
                this.workspace.userId,
                ...Object.values(columns),
                ...Object.values(columns),
            ],
        );
    }

    // Alergi pasien: satu baris per pasien, diubah di tempat.
    private async writeAllergy(
        patientId: string,
        recordId: string,
        values: {
            tidak_ada: Bind;
            alergi_makanan_id: string | null;
            alergi_udara_id: string | null;
            alergi_lainnya: Bind;
        },
        stamp: string,
    ): Promise<void> {
        const existing = await this.allergyRow(patientId);
        const empty =
            values.tidak_ada !== true &&
            values.alergi_makanan_id === null &&
            values.alergi_udara_id === null &&
            values.alergi_lainnya === null;
        if (empty) {
            if (existing)
                await this.retire('sim_m_pasien_alergi', existing.id, stamp);
            return;
        }
        if (existing)
            await this.update('sim_m_pasien_alergi', existing.id, {
                ...values,
                pemeriksaan_id: recordId,
                updated_at: stamp,
            });
        else
            await this.db.insert('sim_m_pasien_alergi', {
                id: Bun.randomUUIDv7(),
                tenant_id: this.workspace.tenantId,
                pasien_id: patientId,
                ...values,
                pemeriksaan_id: recordId,
                created_at: stamp,
                updated_at: stamp,
            });
    }

    private async writeFindings(
        recordId: string,
        findings: Map<string, string | null>,
        stamp: string,
    ): Promise<void> {
        const existing = await this.db.rows(
            z.object({
                id: z.string(),
                aspect_id: z.string(),
                result: z.string().nullable(),
            }),
            `select id, aspek_id as aspect_id, hasil as result from sim_tr_pemeriksaan_keadaan_fisik
             where tenant_id = $1 and pemeriksaan_id = $2 and deleted_at is null`,
            [this.workspace.tenantId, recordId],
        );
        for (const row of existing) {
            if (!findings.has(row.aspect_id))
                await this.retire(
                    'sim_tr_pemeriksaan_keadaan_fisik',
                    row.id,
                    stamp,
                );
            else if (findings.get(row.aspect_id) !== row.result)
                await this.update('sim_tr_pemeriksaan_keadaan_fisik', row.id, {
                    hasil: findings.get(row.aspect_id) ?? null,
                    updated_at: stamp,
                });
        }
        for (const [aspectId, result] of findings)
            if (!existing.some((row) => row.aspect_id === aspectId))
                await this.db.insert('sim_tr_pemeriksaan_keadaan_fisik', {
                    id: Bun.randomUUIDv7(),
                    tenant_id: this.workspace.tenantId,
                    pemeriksaan_id: recordId,
                    aspek_id: aspectId,
                    hasil: result,
                    created_at: stamp,
                    updated_at: stamp,
                });
    }

    // Baris diagnosa dikenali dari kode ICD-10-nya: kode yang masih ada diubah di tempat, kode baru disisipkan, dan
    // kode yang tidak dikirim lagi diberi deleted_at. Sistem lama menghapus fisik lalu menyisipkan ulang semuanya.
    private async writeDiagnoses(
        recordId: string,
        rows: Diagnosis[],
        stamp: string,
    ): Promise<void> {
        const existing = await this.diagnosisRows(recordId);
        for (const item of existing)
            if (!rows.some((row) => row.icd10_id === item.icd10_id))
                await this.retire(
                    'sim_tr_pemeriksaan_diagnosa',
                    item.id,
                    stamp,
                );
        for (const [index, row] of rows.entries()) {
            const values = {
                urutan: index + 1,
                jenis_id: row.type_id,
                kasus_id: row.case_id,
                dokter_id: row.doctor_id,
                perawat_id: row.nurse_id,
                ...(row.tooth_position === undefined
                    ? {}
                    : { posisi_gigi: row.tooth_position }),
            };
            const match = existing.find(
                (item) => item.icd10_id === row.icd10_id,
            );
            if (!match)
                await this.db.insert('sim_tr_pemeriksaan_diagnosa', {
                    id: Bun.randomUUIDv7(),
                    tenant_id: this.workspace.tenantId,
                    pemeriksaan_id: recordId,
                    icd10_id: row.icd10_id,
                    ...values,
                    created_at: stamp,
                    updated_at: stamp,
                });
            else if (
                match.urutan !== values.urutan ||
                match.type_id !== values.jenis_id ||
                match.case_id !== values.kasus_id ||
                match.doctor_id !== values.dokter_id ||
                match.nurse_id !== values.perawat_id ||
                (row.tooth_position !== undefined &&
                    match.tooth_position !== row.tooth_position)
            )
                await this.update('sim_tr_pemeriksaan_diagnosa', match.id, {
                    ...values,
                    updated_at: stamp,
                });
        }
    }

    private async writeChronicDiseases(
        recordId: string,
        ids: string[],
        stamp: string,
    ): Promise<void> {
        const existing = await this.db.rows(
            z.object({ id: z.string(), disease_id: z.string() }),
            `select id, penyakit_kronis_id as disease_id from sim_tr_pemeriksaan_penyakit_kronis
             where tenant_id = $1 and pemeriksaan_id = $2 and deleted_at is null`,
            [this.workspace.tenantId, recordId],
        );
        for (const row of existing)
            if (!ids.includes(row.disease_id))
                await this.retire(
                    'sim_tr_pemeriksaan_penyakit_kronis',
                    row.id,
                    stamp,
                );
        for (const id of ids)
            if (!existing.some((row) => row.disease_id === id))
                await this.db.insert('sim_tr_pemeriksaan_penyakit_kronis', {
                    id: Bun.randomUUIDv7(),
                    tenant_id: this.workspace.tenantId,
                    pemeriksaan_id: recordId,
                    penyakit_kronis_id: id,
                    created_at: stamp,
                    updated_at: stamp,
                });
    }

    // Baris anatomi yang membawa id baris tersimpan diubah di tempat; yang tidak dikirim lagi diberi deleted_at.
    private async writeAnatomy(
        recordId: string,
        rows: { id: string | null; body_part: string; description: string }[],
        stamp: string,
    ): Promise<void> {
        const existing = await this.db.rows(
            z.object({
                id: z.string(),
                urutan: z.number(),
                body_part: z.string(),
                description: z.string(),
            }),
            `select id, urutan, bagian_tubuh as body_part, keterangan as description from sim_tr_pemeriksaan_anatomi
             where tenant_id = $1 and pemeriksaan_id = $2 and deleted_at is null`,
            [this.workspace.tenantId, recordId],
        );
        const kept = new Set<string>();
        for (const [index, row] of rows.entries()) {
            const match = existing.find(
                (item) => item.id === row.id && !kept.has(item.id),
            );
            if (match) {
                kept.add(match.id);
                if (
                    match.urutan !== index + 1 ||
                    match.body_part !== row.body_part ||
                    match.description !== row.description
                )
                    await this.update('sim_tr_pemeriksaan_anatomi', match.id, {
                        urutan: index + 1,
                        bagian_tubuh: row.body_part,
                        keterangan: row.description,
                        updated_at: stamp,
                    });
                continue;
            }
            await this.db.insert('sim_tr_pemeriksaan_anatomi', {
                id: Bun.randomUUIDv7(),
                tenant_id: this.workspace.tenantId,
                pemeriksaan_id: recordId,
                urutan: index + 1,
                bagian_tubuh: row.body_part,
                keterangan: row.description,
                created_at: stamp,
                updated_at: stamp,
            });
        }
        for (const item of existing)
            if (!kept.has(item.id))
                await this.retire('sim_tr_pemeriksaan_anatomi', item.id, stamp);
    }
}
