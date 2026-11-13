import { z } from 'zod';
import type { Workspace } from '@core/platform/access/index.ts';
import { NumberIssuer } from '@core/foundation/number-sequence/index.ts';
import {
    isoSql,
    type Bind,
    type Database,
} from '@core/platform/database/index.ts';
import { isRecord, lookupId, validation } from '@core/platform/http/index.ts';
import { moduleId } from '../../module.ts';
import {
    drugAllergyMessage,
    drugDuplicateMessage,
    invalidCompoundMessage,
    missingDrugMessage,
    procedureDuplicateMessage,
} from './medical-record.messages.ts';
import type { MedicalRecord } from './medical-record.schema.ts';
import { publishPrescriptionIssued } from './prescription.events.ts';

// Panel Biaya Tindakan dan E-Resep tab Rekam Medis poli sistem lama, beserta alergi obat pasien yang diperiksa resep.
// Ditulis di dalam Simpan rekam medis yang sama; Kirim ke farmasi menutup draf resep.

type Errors = Record<string, string[]>;
type Procedure = NonNullable<MedicalRecord['procedures']>[number];
type Prescription = NonNullable<MedicalRecord['prescriptions']>[number];
type DrugAllergy = NonNullable<MedicalRecord['drug_allergies']>[number];

export const prescriptionNumberReference = `${moduleId}.prescription-number`;

function add(errors: Errors, field: string, message: string): void {
    (errors[field] ??= []).push(message);
}

const missing = (value: unknown) =>
    value === null || value === undefined || value === '';

// Angka dari isian layar: null bila kosong, undefined bila bukan angka.
function numeric(raw: unknown): number | null | undefined {
    if (missing(raw)) return null;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
    if (typeof raw !== 'string') return undefined;
    const value = Number(raw.trim().replace(',', '.'));
    return Number.isFinite(value) ? value : undefined;
}

function text(
    raw: unknown,
    max: number,
    field: string,
    errors: Errors,
): string | null {
    if (missing(raw)) return null;
    if (typeof raw !== 'string') {
        add(errors, field, 'Isian ini tidak sah.');
        return null;
    }
    const value = raw.trim();
    if (value === '') return null;
    // eslint-disable-next-line @typescript-eslint/no-misused-spread -- dihitung per code point
    if ([...value].length > max) {
        add(errors, field, `Paling banyak ${max} karakter.`);
        return null;
    }
    return value;
}

// Jumlah desimal lebih dari 0, muat di numeric(10,2).
function amount(raw: unknown, field: string, errors: Errors): number | null {
    const value = numeric(raw);
    if (value === null) return null;
    if (value === undefined || value <= 0 || value >= 1e8) {
        add(errors, field, 'Isi jumlah lebih dari 0.');
        return null;
    }
    return Math.round(value * 100) / 100;
}

// Nakes aktif yang profesinya boleh mengisi peran itu (centang di Setup → Profesi). Nakes yang sudah tersimpan tetap
// diterima walau sejak itu nonaktif atau profesinya berubah.
export async function practitionerId(
    db: Database,
    tenantId: string,
    raw: unknown,
    role: 'isi_tenaga_medis' | 'isi_perawat',
    saved: string | null,
    field: string,
    errors: Errors,
): Promise<string | null> {
    if (missing(raw)) return null;
    const id = typeof raw === 'string' ? lookupId(raw) : null;
    const found = id
        ? await db.one(
              z.object({ id: z.string() }),
              `select n.id from sim_m_nakes n
               join sim_m_profesi pr on pr.tenant_id = n.tenant_id and pr.id = n.profesi_id
               where n.tenant_id = $1 and n.id = $2 and n.deleted_at is null
                 and (n.id = $3 or (n.aktif and pr.${role}))`,
              [tenantId, id, saved],
          )
        : undefined;
    if (!found) add(errors, field, 'Pilih tenaga kesehatan dari daftar.');
    return found?.id ?? null;
}

type ProcedureLine = {
    procedure_id: string;
    quantity: number;
    doctor_id: string | null;
};

type PrescriptionLine = {
    drug_id: string | null;
    compound: number | null;
    quantity: number | null;
    requested_quantity: number | null;
    signa: string | null;
    usage_instruction_id: string | null;
    notes: string | null;
};
type PrescriptionDraft = {
    id: string | null;
    notes: string | null;
    lines: PrescriptionLine[];
};

const savedProcedureSchema = z.object({
    id: z.string(),
    urutan: z.number(),
    procedure_id: z.string(),
    procedure_code: z.string(),
    procedure_name: z.string(),
    quantity: z.number(),
    doctor_id: z.string().nullable(),
    added_by: z.string().nullable(),
    added_at: z.string().nullable(),
});

const savedPrescriptionSchema = z.object({
    id: z.string(),
    number: z.string().nullable(),
    status: z.enum(['draf', 'dikirim', 'dibatalkan']),
    sent_at: z.string().nullable(),
    dispensed_at: z.string().nullable(),
    dispensing_number: z.string().nullable(),
    doctor_name: z.string().nullable(),
    nurse_name: z.string().nullable(),
    notes: z.string().nullable(),
});

const savedLineSchema = z.object({
    id: z.string(),
    urutan: z.number(),
    drug_id: z.string().nullable(),
    drug_code: z.string().nullable(),
    drug_name: z.string().nullable(),
    unit_name: z.string().nullable(),
    compound: z.number().nullable(),
    quantity: z.number().nullable(),
    requested_quantity: z.number().nullable(),
    signa: z.string().nullable(),
    usage_instruction_id: z.string().nullable(),
    notes: z.string().nullable(),
    dispensed_quantity: z.number().nullable(),
});
type SavedLine = z.infer<typeof savedLineSchema>;

// Kunci baris resep: obatnya, atau nomor racikan untuk kepala racikan.
const lineKey = (line: { drug_id: string | null; compound: number | null }) =>
    line.drug_id ?? `racikan:${String(line.compound)}`;

export class ExaminationOrders {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private get tenantId() {
        return this.workspace.tenantId;
    }

    private async update(
        table: string,
        id: string,
        values: Record<string, Bind>,
    ) {
        const columns = Object.keys(values);
        await this.db.execute(
            `update ${table} set ${columns.map((column, index) => `${column} = $${index + 3}`).join(', ')}
             where tenant_id = $1 and id = $2`,
            [this.tenantId, id, ...Object.values(values)],
        );
    }

    private async retire(table: string, id: string, stamp: string) {
        await this.update(table, id, { deleted_at: stamp, updated_at: stamp });
    }

    // Alergi obat ------------------------------------------------------------------------------------------------

    async drugAllergies(patientId: string): Promise<DrugAllergy[]> {
        return this.db.rows(
            z.object({
                drug_id: z.string(),
                drug_code: z.string().nullable(),
                drug_name: z.string(),
            }),
            `select a.obat_id as drug_id, b.kode as drug_code, b.nama as drug_name
             from sim_m_pasien_alergi_obat a
             join gd_m_barang b on b.tenant_id = a.tenant_id and b.id = a.obat_id
             where a.tenant_id = $1 and a.pasien_id = $2 and a.deleted_at is null
             order by b.nama, b.id`,
            [this.tenantId, patientId],
        );
    }

    // Obat yang dikirim di daftar alergi obat. Alergi milik pasien, dan pasien bisa dibagi antar legal entity, jadi obat
    // legal entity mana pun di tenant ini diterima, termasuk yang tidak boleh diresepkan; yang ganda dihitung sekali.
    async readDrugAllergies(
        raw: unknown[] | undefined,
        errors: Errors,
    ): Promise<string[]> {
        const ids = new Set<string>();
        for (const [index, item] of (raw ?? []).entries()) {
            const value = isRecord(item) ? item.drug_id : undefined;
            const id = typeof value === 'string' ? lookupId(value) : null;
            const found = id
                ? await this.db.one(
                      z.object({ id: z.string() }),
                      `select o.id from sim_m_obat o
                       join gd_m_barang b on b.tenant_id = o.tenant_id and b.id = o.id and b.deleted_at is null
                       where o.tenant_id = $1 and o.id = $2 and o.deleted_at is null`,
                      [this.tenantId, id],
                  )
                : undefined;
            if (!found)
                add(
                    errors,
                    `drug_allergies.${index}.drug_id`,
                    'Pilih obat dari daftar.',
                );
            else ids.add(found.id);
        }
        return [...ids];
    }

    async writeDrugAllergies(
        patientId: string,
        recordId: string,
        ids: string[],
        stamp: string,
    ): Promise<void> {
        const existing = await this.db.rows(
            z.object({ id: z.string(), drug_id: z.string() }),
            `select id, obat_id as drug_id from sim_m_pasien_alergi_obat
             where tenant_id = $1 and pasien_id = $2 and deleted_at is null`,
            [this.tenantId, patientId],
        );
        for (const row of existing)
            if (!ids.includes(row.drug_id))
                await this.retire('sim_m_pasien_alergi_obat', row.id, stamp);
        for (const id of ids)
            if (!existing.some((row) => row.drug_id === id))
                await this.db.insert('sim_m_pasien_alergi_obat', {
                    id: Bun.randomUUIDv7(),
                    tenant_id: this.tenantId,
                    pasien_id: patientId,
                    obat_id: id,
                    pemeriksaan_id: recordId,
                    created_at: stamp,
                    updated_at: stamp,
                });
    }

    // Biaya Tindakan ---------------------------------------------------------------------------------------------

    private async savedProcedures(recordId: string) {
        return this.db.rows(
            savedProcedureSchema,
            `select t.id, t.urutan, t.tindakan_id as procedure_id, m.kode as procedure_code,
                    m.nama as procedure_name, t.jumlah as quantity, t.dokter_id as doctor_id,
                    u.name as added_by, ${isoSql('t.created_at')} as added_at
             from sim_tr_pemeriksaan_tindakan t
             join sim_m_tindakan m on m.tenant_id = t.tenant_id and m.id = t.tindakan_id
             left join users u on u.id = t.created_by_user_id
             where t.tenant_id = $1 and t.pemeriksaan_id = $2 and t.deleted_at is null
             order by t.urutan, t.id`,
            [this.tenantId, recordId],
        );
    }

    async procedures(recordId: string | null): Promise<Procedure[]> {
        return (recordId ? await this.savedProcedures(recordId) : []).map(
            ({ id: _id, urutan: _urutan, ...row }) => row,
        );
    }

    // Baris tindakan. Tindakan wajib dan sekali per pemeriksaan, dengan pesan sistem lama; jumlah bilangan bulat 1 atau
    // lebih (sistem lama mengubah diam-diam jumlah di bawah 1 menjadi 1). Tindakan dan dokter yang sudah tersimpan di
    // baris ini tetap diterima walau sejak itu nonaktif.
    async readProcedures(
        raw: unknown[] | undefined,
        recordId: string | null,
        errors: Errors,
    ): Promise<ProcedureLine[]> {
        const saved = recordId ? await this.savedProcedures(recordId) : [];
        const rows: ProcedureLine[] = [];
        const seen = new Set<string>();
        for (const [index, item] of (raw ?? []).entries()) {
            const row = isRecord(item) ? item : {};
            const field = (name: string) => `procedures.${index}.${name}`;
            const id =
                typeof row.procedure_id === 'string'
                    ? lookupId(row.procedure_id)
                    : null;
            const before = saved.find((line) => line.procedure_id === id);
            let procedureId: string | null = null;
            if (missing(row.procedure_id))
                add(errors, field('procedure_id'), 'Pilih tindakan.');
            else {
                const found = id
                    ? await this.db.one(
                          z.object({ id: z.string(), name: z.string() }),
                          `select id, nama as name from sim_m_tindakan
                           where tenant_id = $1 and id = $2 and deleted_at is null and (aktif or $3)`,
                          [this.tenantId, id, Boolean(before)],
                      )
                    : undefined;
                if (!found)
                    add(
                        errors,
                        field('procedure_id'),
                        'Pilih tindakan dari daftar.',
                    );
                else if (seen.has(found.id))
                    add(
                        errors,
                        field('procedure_id'),
                        procedureDuplicateMessage(found.name),
                    );
                else {
                    seen.add(found.id);
                    procedureId = found.id;
                }
            }
            const quantity = numeric(row.quantity);
            if (
                quantity === null ||
                quantity === undefined ||
                !Number.isInteger(quantity) ||
                quantity < 1 ||
                quantity > 32767
            )
                add(errors, field('quantity'), 'Isi jumlah 1 atau lebih.');
            const doctorId = await practitionerId(
                this.db,
                this.tenantId,
                row.doctor_id,
                'isi_tenaga_medis',
                before?.doctor_id ?? null,
                field('doctor_id'),
                errors,
            );
            if (procedureId && typeof quantity === 'number')
                rows.push({
                    procedure_id: procedureId,
                    quantity,
                    doctor_id: doctorId,
                });
        }
        return rows;
    }

    // Baris dikenali dari tindakannya: yang masih dikirim diubah di tempat, yang baru disisipkan, dan yang tidak dikirim
    // lagi diberi deleted_at. Sistem lama menghapus fisik lalu menyisipkan ulang semuanya.
    async writeProcedures(
        recordId: string,
        rows: ProcedureLine[],
        stamp: string,
    ): Promise<void> {
        const existing = await this.savedProcedures(recordId);
        for (const item of existing)
            if (!rows.some((row) => row.procedure_id === item.procedure_id))
                await this.retire(
                    'sim_tr_pemeriksaan_tindakan',
                    item.id,
                    stamp,
                );
        for (const [index, row] of rows.entries()) {
            const values = {
                urutan: index + 1,
                jumlah: row.quantity,
                dokter_id: row.doctor_id,
            };
            const match = existing.find(
                (item) => item.procedure_id === row.procedure_id,
            );
            if (!match)
                await this.db.insert('sim_tr_pemeriksaan_tindakan', {
                    id: Bun.randomUUIDv7(),
                    tenant_id: this.tenantId,
                    pemeriksaan_id: recordId,
                    tindakan_id: row.procedure_id,
                    ...values,
                    created_at: stamp,
                    updated_at: stamp,
                });
            else if (
                match.urutan !== values.urutan ||
                match.quantity !== values.jumlah ||
                match.doctor_id !== values.dokter_id
            )
                await this.update('sim_tr_pemeriksaan_tindakan', match.id, {
                    ...values,
                    updated_at: stamp,
                });
        }
    }

    // E-Resep ----------------------------------------------------------------------------------------------------

    private async savedPrescriptions(recordId: string) {
        return this.db.rows(
            savedPrescriptionSchema,
            `select r.id, r.nomor as number, r.status,
                    ${isoSql('r.dikirim_pada')} as sent_at, ${isoSql('r.diserahkan_pada')} as dispensed_at,
                    r.nomor_penyerahan as dispensing_number,
                    dp.name as doctor_name, np.name as nurse_name, r.catatan as notes
             from sim_tr_resep r
             left join sim_m_nakes dn on dn.tenant_id = r.tenant_id and dn.id = r.dokter_id
             left join parties dp on dp.tenant_id = dn.tenant_id and dp.id = dn.party_id
             left join sim_m_nakes nn on nn.tenant_id = r.tenant_id and nn.id = r.perawat_id
             left join parties np on np.tenant_id = nn.tenant_id and np.id = nn.party_id
             where r.tenant_id = $1 and r.pemeriksaan_id = $2 and r.deleted_at is null
             order by r.created_at, r.id`,
            [this.tenantId, recordId],
        );
    }

    private async savedLines(prescriptionId: string): Promise<SavedLine[]> {
        return this.db.rows(
            savedLineSchema,
            `select d.id, d.urutan, d.obat_id as drug_id, b.kode as drug_code, b.nama as drug_name,
                    s.nama as unit_name, d.racikan_ke as compound, d.jumlah::float8 as quantity,
                    d.jumlah_permintaan::float8 as requested_quantity, d.signa,
                    d.aturan_pakai_id as usage_instruction_id, d.keterangan as notes,
                    d.jumlah_diserahkan::float8 as dispensed_quantity
             from sim_tr_resep_detail d
             left join gd_m_barang b on b.tenant_id = d.tenant_id and b.id = d.obat_id
             left join gd_m_satuan s on s.tenant_id = b.tenant_id and s.id = b.satuan_dasar_id
             where d.tenant_id = $1 and d.resep_id = $2 and d.deleted_at is null
             order by d.urutan, d.id`,
            [this.tenantId, prescriptionId],
        );
    }

    async prescriptions(recordId: string | null): Promise<Prescription[]> {
        if (!recordId) return [];
        const result: Prescription[] = [];
        for (const prescription of await this.savedPrescriptions(recordId))
            result.push({
                ...prescription,
                lines: (await this.savedLines(prescription.id)).map(
                    ({ id: _id, urutan: _urutan, ...line }) => line,
                ),
            });
        return result;
    }

    // Draf resep yang dikirim layar. Resep yang sudah dikirim ke farmasi hanya dibaca: kirimannya dilewati, dan versi
    // pemeriksaan (Kirim ke farmasi menaikkannya) menolak layar yang belum memuat status terbarunya. Paling banyak satu
    // draf per pemeriksaan. Obatnya barang legal entity kunjungan, karena farmasi mengeluarkan stok dari sana.
    async readPrescriptions(
        raw: unknown[] | undefined,
        recordId: string | null,
        legalEntityId: string,
        allergies: ReadonlySet<string>,
        errors: Errors,
    ): Promise<PrescriptionDraft[]> {
        const saved = recordId ? await this.savedPrescriptions(recordId) : [];
        const drafts: PrescriptionDraft[] = [];
        let draftCount = 0;
        for (const [index, item] of (raw ?? []).entries()) {
            const row = isRecord(item) ? item : {};
            const field = (name: string) => `prescriptions.${index}.${name}`;
            const id = typeof row.id === 'string' ? lookupId(row.id) : null;
            const before = id
                ? saved.find((prescription) => prescription.id === id)
                : undefined;
            if (!missing(row.id) && !before) {
                add(errors, field('id'), 'Isian ini tidak sah.');
                continue;
            }
            if (before && before.status !== 'draf') continue;
            draftCount += 1;
            if (draftCount > 1) {
                add(
                    errors,
                    field('id'),
                    'Kirim resep yang masih draf lebih dulu sebelum membuat resep baru.',
                );
                continue;
            }
            const notes = text(row.notes, 500, field('notes'), errors);
            const lines = await this.readLines(
                Array.isArray(row.lines) ? row.lines : [],
                before ? await this.savedLines(before.id) : [],
                legalEntityId,
                allergies,
                field('lines'),
                errors,
            );
            drafts.push({ id: before?.id ?? null, notes, lines });
        }
        return drafts;
    }

    private async readLines(
        raw: unknown[],
        saved: SavedLine[],
        legalEntityId: string,
        allergies: ReadonlySet<string>,
        prefix: string,
        errors: Errors,
    ): Promise<PrescriptionLine[]> {
        const lines: PrescriptionLine[] = [];
        const drugs = new Set<string>();
        const compounds = new Set<number>();
        const components: { compound: number; field: string }[] = [];
        for (const [index, item] of raw.entries()) {
            const row = isRecord(item) ? item : {};
            const field = (name: string) => `${prefix}.${index}.${name}`;
            const compoundValue = numeric(row.compound);
            const compound =
                compoundValue === null
                    ? null
                    : compoundValue !== undefined &&
                        Number.isInteger(compoundValue) &&
                        compoundValue >= 1 &&
                        compoundValue <= 32767
                      ? compoundValue
                      : undefined;
            if (compound === undefined) {
                add(errors, field('compound'), invalidCompoundMessage);
                continue;
            }
            const signa = text(row.signa, 100, field('signa'), errors);
            const notes = text(row.notes, 500, field('notes'), errors);
            const usageInstructionId = await this.usageInstruction(
                row.usage_instruction_id,
                saved,
                field('usage_instruction_id'),
                errors,
            );
            if (missing(row.drug_id)) {
                if (compound === null) {
                    add(errors, field('drug_id'), missingDrugMessage);
                    continue;
                }
                // Kepala racikan "Racikan N".
                if (compounds.has(compound)) {
                    add(errors, field('compound'), invalidCompoundMessage);
                    continue;
                }
                compounds.add(compound);
                if (!missing(row.quantity))
                    add(errors, field('quantity'), 'Isian ini tidak sah.');
                lines.push({
                    drug_id: null,
                    compound,
                    quantity: null,
                    requested_quantity: amount(
                        row.requested_quantity,
                        field('requested_quantity'),
                        errors,
                    ),
                    signa,
                    usage_instruction_id: usageInstructionId,
                    notes,
                });
                continue;
            }
            const id =
                typeof row.drug_id === 'string' ? lookupId(row.drug_id) : null;
            const wasSaved = saved.some((line) => line.drug_id === id);
            // Obat yang sudah tersimpan di baris ini tetap diterima walau sejak itu tidak boleh diresepkan atau diblokir.
            const drug = id
                ? await this.db.one(
                      z.object({ id: z.string(), name: z.string() }),
                      `select o.id, b.nama as name from sim_m_obat o
                       join gd_m_barang b on b.tenant_id = o.tenant_id and b.legal_entity_id = o.legal_entity_id
                            and b.id = o.id and b.deleted_at is null
                       where o.tenant_id = $1 and o.id = $2 and o.legal_entity_id = $3 and o.deleted_at is null
                         and ((o.boleh_diresepkan and not b.diblokir) or $4)`,
                      [this.tenantId, id, legalEntityId, wasSaved],
                  )
                : undefined;
            if (!drug) {
                add(errors, field('drug_id'), 'Pilih obat dari daftar.');
                continue;
            }
            if (allergies.has(drug.id))
                add(errors, field('drug_id'), drugAllergyMessage(drug.name));
            else if (drugs.has(drug.id))
                add(errors, field('drug_id'), drugDuplicateMessage(drug.name));
            drugs.add(drug.id);
            if (!missing(row.requested_quantity))
                add(
                    errors,
                    field('requested_quantity'),
                    'Jumlah permintaan hanya diisi pada baris racikan.',
                );
            if (compound !== null) {
                components.push({ compound, field: field('compound') });
                if (signa !== null || usageInstructionId !== null)
                    add(
                        errors,
                        field(
                            signa !== null ? 'signa' : 'usage_instruction_id',
                        ),
                        'Signa dan aturan pakai komponen racikan diisi pada baris racikannya.',
                    );
            }
            const quantity = amount(row.quantity, field('quantity'), errors);
            if (quantity === null && missing(row.quantity))
                add(errors, field('quantity'), 'Isi jumlah lebih dari 0.');
            lines.push({
                drug_id: drug.id,
                compound,
                quantity,
                requested_quantity: null,
                signa,
                usage_instruction_id: usageInstructionId,
                notes,
            });
        }
        for (const component of components)
            if (!compounds.has(component.compound))
                add(errors, component.field, invalidCompoundMessage);
        return lines;
    }

    private async usageInstruction(
        raw: unknown,
        saved: SavedLine[],
        field: string,
        errors: Errors,
    ): Promise<string | null> {
        if (missing(raw)) return null;
        const id = typeof raw === 'string' ? lookupId(raw) : null;
        const found = id
            ? await this.db.one(
                  z.object({ id: z.string() }),
                  `select id from sim_m_aturan_pakai
                   where tenant_id = $1 and id = $2 and deleted_at is null and (aktif or $3)`,
                  [
                      this.tenantId,
                      id,
                      saved.some((line) => line.usage_instruction_id === id),
                  ],
              )
            : undefined;
        if (!found) add(errors, field, 'Pilih dari daftar.');
        return found?.id ?? null;
    }

    // Draf yang kosong tidak disimpan, seperti sistem lama yang hanya membuat resep bila ada baris. Draf tersimpan yang
    // tidak dikirim lagi, atau dikosongkan, diberi deleted_at beserta barisnya.
    async writePrescriptions(
        recordId: string,
        drafts: PrescriptionDraft[],
        stamp: string,
    ): Promise<void> {
        const header = await this.db.one(
            z.object({
                doctor_id: z.string().nullable(),
                nurse_id: z.string().nullable(),
            }),
            'select dokter_id as doctor_id, perawat_id as nurse_id from sim_tr_pemeriksaan where tenant_id = $1 and id = $2',
            [this.tenantId, recordId],
        );
        const kept = drafts.filter(
            (draft) => draft.lines.length > 0 || draft.notes !== null,
        );
        for (const prescription of await this.savedPrescriptions(recordId))
            if (
                prescription.status === 'draf' &&
                !kept.some((draft) => draft.id === prescription.id)
            ) {
                for (const line of await this.savedLines(prescription.id))
                    await this.retire('sim_tr_resep_detail', line.id, stamp);
                await this.retire('sim_tr_resep', prescription.id, stamp);
            }
        for (const draft of kept) {
            const values = {
                catatan: draft.notes,
                dokter_id: header?.doctor_id ?? null,
                perawat_id: header?.nurse_id ?? null,
            };
            let id = draft.id;
            if (id)
                await this.update('sim_tr_resep', id, {
                    ...values,
                    updated_at: stamp,
                });
            else {
                id = Bun.randomUUIDv7();
                await this.db.insert('sim_tr_resep', {
                    id,
                    tenant_id: this.tenantId,
                    pemeriksaan_id: recordId,
                    status: 'draf',
                    ...values,
                    created_at: stamp,
                    updated_at: stamp,
                });
            }
            await this.writeLines(id, draft.lines, stamp);
        }
    }

    // Baris dikenali dari obatnya, atau dari nomor racikan untuk kepala racikan.
    private async writeLines(
        prescriptionId: string,
        lines: PrescriptionLine[],
        stamp: string,
    ): Promise<void> {
        const existing = await this.savedLines(prescriptionId);
        const keys = new Set(lines.map(lineKey));
        for (const item of existing)
            if (!keys.has(lineKey(item)))
                await this.retire('sim_tr_resep_detail', item.id, stamp);
        for (const [index, line] of lines.entries()) {
            const values = {
                urutan: index + 1,
                racikan_ke: line.compound,
                jumlah: line.quantity,
                jumlah_permintaan: line.requested_quantity,
                signa: line.signa,
                aturan_pakai_id: line.usage_instruction_id,
                keterangan: line.notes,
            };
            const match = existing.find(
                (item) => lineKey(item) === lineKey(line),
            );
            if (!match)
                await this.db.insert('sim_tr_resep_detail', {
                    id: Bun.randomUUIDv7(),
                    tenant_id: this.tenantId,
                    resep_id: prescriptionId,
                    obat_id: line.drug_id,
                    ...values,
                    created_at: stamp,
                    updated_at: stamp,
                });
            else if (
                match.urutan !== values.urutan ||
                match.compound !== values.racikan_ke ||
                match.quantity !== values.jumlah ||
                match.requested_quantity !== values.jumlah_permintaan ||
                match.signa !== values.signa ||
                match.usage_instruction_id !== values.aturan_pakai_id ||
                match.notes !== values.keterangan
            )
                await this.update('sim_tr_resep_detail', match.id, {
                    ...values,
                    updated_at: stamp,
                });
        }
    }

    // Kirim ke farmasi: draf yang baru disimpan menjadi dikirim, diberi nomor resep dari number sequence unit kunjungan,
    // dan tidak dapat diubah lagi. Pemanggil sudah mengunci tujuan, memeriksa versi pemeriksaan, dan memastikan
    // pemeriksaan sedang berjalan; Kirim menaikkan versi itu, jadi klik yang diulang dengan versi lama ditolak tanpa
    // menerbitkan event kedua. healthcare.prescription.issued.v1 terbit di transaksi yang sama: gagal sesudahnya
    // membatalkan keduanya.
    async send(
        recordId: string,
        visit: { operating_unit_id: string; date: string },
        stamp: string,
        people: { doctorId: string | null; nurseId: string | null },
    ): Promise<void> {
        const prescription = (await this.savedPrescriptions(recordId)).find(
            (row) => row.status === 'draf',
        );
        if (
            !prescription ||
            !(await this.savedLines(prescription.id)).some(
                (line) => line.drug_id,
            )
        )
            validation({ prescription: 'Resep belum berisi obat.' });
        const id = prescription.id;
        const number = await new NumberIssuer(this.db, {
            tenantId: this.tenantId,
            moduleId,
        }).issue({
            reference: prescriptionNumberReference,
            key: `prescription:${id}`,
            documentDate: visit.date,
            operatingUnitId: visit.operating_unit_id,
        });
        await this.update('sim_tr_resep', id, {
            status: 'dikirim',
            nomor: number,
            dikirim_pada: stamp,
            dokter_id: people.doctorId,
            perawat_id: people.nurseId,
            updated_at: stamp,
        });
        await this.update('sim_tr_pemeriksaan', recordId, {
            updated_at: stamp,
        });
        await publishPrescriptionIssued(this.db, this.tenantId, id, stamp);
    }
}
