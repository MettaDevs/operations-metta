import { z } from 'zod';
import type { Workspace } from '@core/platform/access/index.ts';
import {
    decimalInput,
    defaultUnit,
    itemUnits,
    quantityHint,
    quantityScale,
    toNumeric,
    unitConversion,
} from '@core/foundation/inventory/index.ts';
import { NumberIssuer } from '@core/foundation/number-sequence/index.ts';
import {
    isoSql,
    type Bind,
    type Database,
} from '@core/platform/database/index.ts';
import { isRecord, lookupId, validation } from '@core/platform/http/index.ts';
import { Decimal } from '@core/platform/money/index.ts';
import {
    ProcedurePrices,
    type ProcedurePriceLookup,
} from '../../clinical/procedure/procedure-price.service.ts';
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
import {
    baseQuantityText,
    numberText,
    quantityOf,
    type LineUnit,
} from './prescription.units.ts';

// Panel Biaya Tindakan dan E-Resep tab Rekam Medis poli sistem lama. Ditulis di dalam Simpan rekam medis yang sama;
// Kirim ke farmasi menutup draf resep.

type Errors = Record<string, string[]>;
type Procedure = NonNullable<MedicalRecord['procedures']>[number];
type Prescription = NonNullable<MedicalRecord['prescriptions']>[number];

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

export function text(
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

// Jumlah obat dan dosis mengikuti aturan jumlah persediaan Core (decimalInput), termasuk banyak angka di belakang koma.
const decimalRule = `lebih dari 0, ${quantityHint}.`;
const quantityMessage = `Isi jumlah ${decimalRule}`;

// Jumlah lebih dari 0 sebagai teks numeric yang disimpan; null bila kosong atau tidak sah.
function decimal(
    raw: unknown,
    field: string,
    errors: Errors,
    message: string,
): string | null {
    if (missing(raw)) return null;
    const value = decimalInput(raw);
    if (value === null || value <= 0n) {
        add(errors, field, message);
        return null;
    }
    return toNumeric(value, quantityScale);
}

// Bilangan bulat 1 atau lebih yang muat di smallint, wajib diisi.
function count(
    raw: unknown,
    field: string,
    errors: Errors,
    messages: { missing: string; invalid: string },
): number | null {
    const value = numeric(raw);
    if (value === null) add(errors, field, messages.missing);
    else if (
        value === undefined ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > 32767
    )
        add(errors, field, messages.invalid);
    else return value;
    return null;
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

// Nakes pelaku dicatat saat kejadian, karena tautan akun ke nakes bisa berubah sesudahnya (healthcare 0046).
export async function practitionerOfUser(
    db: Database,
    tenantId: string,
    userId: string,
): Promise<string | null> {
    const found = await db.one(
        z.object({ id: z.string().nullable() }),
        'select sim_nakes_milik_pengguna($1, $2) as id',
        [tenantId, userId],
    );
    return found?.id ?? null;
}

type ProcedureLine = {
    procedure_id: string;
    quantity: number;
    doctor_id: string | null;
};

type ChosenUnit = { id: string; conversion: string };
// Dosis obat tunggal dan kepala racikan; semuanya kosong pada komponen racikan. dose dalam dose_unit_id, sebagai teks
// numeric yang disimpan.
type Dosage = {
    frequency_per_day: number | null;
    dose: string | null;
    dose_unit_id: string | null;
    route_id: string | null;
    duration_days: number | null;
};
const dosageFields = [
    'frequency_per_day',
    'dose',
    'dose_unit_id',
    'route_id',
    'duration_days',
] as const satisfies readonly (keyof Dosage)[];
const noDosage: Dosage = {
    frequency_per_day: null,
    dose: null,
    dose_unit_id: null,
    route_id: null,
    duration_days: null,
};
// Jenis racikan (dtd: true d.t.d., false dibagi rata) dan bentuk sediaan hasilnya; keduanya hanya pada kepala racikan.
type CompoundPreparation = {
    dtd: boolean | null;
    dosage_form_id: string | null;
};
const compoundPreparationFields = [
    'dtd',
    'dosage_form_id',
] as const satisfies readonly (keyof CompoundPreparation)[];
const noPreparation: CompoundPreparation = { dtd: null, dosage_form_id: null };
type PrescriptionLine = {
    drug_id: string | null;
    unit: ChosenUnit | null;
    compound: number | null;
    quantity: string | null;
    requested_quantity: string | null;
    signa: string | null;
    usage_instruction_id: string | null;
    dosage: Dosage;
    preparation: CompoundPreparation;
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
    tariff: z.string(),
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
    unit_id: z.string().nullable(),
    unit_code: z.string().nullable(),
    unit_name: z.string().nullable(),
    conversion: z.string().nullable(),
    base_unit_code: z.string().nullable(),
    compound: z.number().nullable(),
    quantity: z.string().nullable(),
    requested_quantity: z.string().nullable(),
    signa: z.string().nullable(),
    usage_instruction_id: z.string().nullable(),
    frequency_per_day: z.number().nullable(),
    dose: z.string().nullable(),
    dose_unit_id: z.string().nullable(),
    dose_unit_code: z.string().nullable(),
    dose_unit_name: z.string().nullable(),
    route_id: z.string().nullable(),
    duration_days: z.number().nullable(),
    dtd: z.boolean().nullable(),
    dosage_form_id: z.string().nullable(),
    notes: z.string().nullable(),
    dispensed: z.string().nullable(),
    returned: z.string().nullable(),
});
type SavedLine = z.infer<typeof savedLineSchema>;

// Yang dibawa satu baris tindakan ke kasir dan bisa diubah layar: tindakannya, Qty, dan dokternya. Tarif baris yang
// sudah tersimpan dibekukan, dan urutan baris tidak sampai ke kasir.
const chargeOf = (line: ProcedureLine) =>
    `${line.procedure_id}|${line.quantity}|${line.doctor_id ?? ''}`;

// Tanpa tarif berarti 0: Tarif kosong dari layar sistem lama tersimpan 0 di SIMtrRJTransaksi.Tarif yang NOT NULL.
const tariffOf = (charge: ProcedurePriceLookup) =>
    Decimal.of(charge.price?.price ?? '0').normalized();

const decimalNumber = (value: string | null) =>
    value === null ? null : Number(value);

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

    // Biaya Tindakan ---------------------------------------------------------------------------------------------

    private async savedProcedures(recordId: string) {
        return this.db.rows(
            savedProcedureSchema,
            `select t.id, t.urutan, t.tindakan_id as procedure_id, m.kode as procedure_code,
                    m.nama as procedure_name, t.jumlah as quantity, t.dokter_id as doctor_id,
                    trim_scale(t.tarif)::text as tariff, u.name as added_by, ${isoSql('t.created_at')} as added_at
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

    // Pencarian tarif Biaya Tindakan poli sistem lama (lookup/services.php): tipe pasien kunjungan, lokasi RJ, cyto 0, dan
    // kategori operasi ALL. Dokter, kelas, dan KTP tidak pernah sampai ke controller, karena #form_poly, #KdKelas, dan
    // #PasienKTP tidak ada di halaman poli; controller lalu memakai dokter 'xx', kelas 'XX', dan tanpa saringan KTP.
    // null bila tindakan tidak ada.
    private async procedureCharge(
        visitId: string,
        procedureId: string,
    ): Promise<ProcedurePriceLookup | null> {
        const visit = await this.db.one(
            z.object({ patient_type_id: z.string() }),
            `select tipe_pasien_id as patient_type_id from sim_tr_registrasi where tenant_id = $1 and id = $2`,
            [this.tenantId, visitId],
        );
        if (!visit) return null;
        return new ProcedurePrices(this.db, this.tenantId).lookup({
            procedureId,
            patientTypeId: visit.patient_type_id,
            practitionerId: null,
            careClassId: null,
            ktpPatient: false,
            location: 'RJ',
        });
    }

    // Tarif yang akan disimpan baris baru, untuk kolom Tarif begitu tindakan dipilih.
    async procedureTariff(
        visitId: string,
        procedureId: string,
    ): Promise<string | null> {
        const charge = await this.procedureCharge(visitId, procedureId);
        return charge ? tariffOf(charge) : null;
    }

    // Tarif dihitung sekali, saat baris pertama kali disimpan, lalu dibekukan bersama komponennya seperti sistem lama
    // yang menyimpan Tarif hasil lookup dan tidak menghitungnya ulang.
    private async insertProcedure(
        recordId: string,
        visitId: string,
        row: ProcedureLine,
        values: Record<string, Bind>,
        stamp: string,
    ): Promise<void> {
        const charge = await this.procedureCharge(visitId, row.procedure_id);
        if (!charge)
            throw new Error(
                `Tarif tindakan ${row.procedure_id} tidak dapat dicari.`,
            );
        const id = Bun.randomUUIDv7();
        await this.db.insert('sim_tr_pemeriksaan_tindakan', {
            id,
            tenant_id: this.tenantId,
            pemeriksaan_id: recordId,
            tindakan_id: row.procedure_id,
            ...values,
            tarif: tariffOf(charge),
            jenis_tarif: charge.tariff,
            kelompok_harga_id: charge.priceGroupId,
            tindakan_harga_id: charge.price?.priceRowId ?? null,
            created_at: stamp,
            updated_at: stamp,
        });
        for (const component of charge.price?.components ?? [])
            await this.db.insert('sim_tr_pemeriksaan_tindakan_komponen', {
                id: Bun.randomUUIDv7(),
                tenant_id: this.tenantId,
                pemeriksaan_tindakan_id: id,
                komponen_biaya_id: component.chargeComponentId,
                qty: component.quantity,
                harga_awal: component.initialPrice,
                persen_pajak_titipan: component.taxDepositPercent,
                persen_insentif: component.incentivePercent,
                include_insentif: component.includesIncentive,
                harga: component.price,
                created_at: stamp,
                updated_at: stamp,
            });
    }

    // Benar bila Simpan ini mengubah biaya kasir: baris tindakan bertambah atau berkurang, atau Qty atau dokternya
    // berubah. Satu tindakan sekali per pemeriksaan, jadi dua daftar yang sama panjang dan sama isinya berarti sama.
    async proceduresChargeChanged(
        recordId: string,
        rows: readonly ProcedureLine[],
    ): Promise<boolean> {
        const saved = new Set(
            (await this.savedProcedures(recordId)).map(chargeOf),
        );
        return (
            saved.size !== rows.length ||
            rows.some((row) => !saved.has(chargeOf(row)))
        );
    }

    // Baris dikenali dari tindakannya: yang masih dikirim diubah di tempat tanpa menyentuh tarifnya, yang baru disisipkan
    // dengan tarifnya, dan yang tidak dikirim lagi diberi deleted_at bersama komponen tarifnya. Sistem lama menghapus
    // fisik lalu menyisipkan ulang semuanya dengan Tarif dari layar.
    async writeProcedures(
        recordId: string,
        visitId: string,
        rows: ProcedureLine[],
        stamp: string,
    ): Promise<void> {
        const existing = await this.savedProcedures(recordId);
        for (const item of existing)
            if (!rows.some((row) => row.procedure_id === item.procedure_id)) {
                await this.db.execute(
                    `update sim_tr_pemeriksaan_tindakan_komponen set deleted_at = $1, updated_at = $1
                     where tenant_id = $2 and pemeriksaan_tindakan_id = $3 and deleted_at is null`,
                    [stamp, this.tenantId, item.id],
                );
                await this.retire(
                    'sim_tr_pemeriksaan_tindakan',
                    item.id,
                    stamp,
                );
            }
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
                await this.insertProcedure(
                    recordId,
                    visitId,
                    row,
                    values,
                    stamp,
                );
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
                    d.satuan_id as unit_id, s.kode as unit_code, s.nama as unit_name, d.konversi::text as conversion,
                    bs.kode as base_unit_code, d.racikan_ke as compound, d.jumlah::text as quantity,
                    d.jumlah_permintaan::text as requested_quantity, d.signa,
                    d.aturan_pakai_id as usage_instruction_id, d.frekuensi as frequency_per_day, d.dosis::text as dose,
                    d.dosis_satuan_id as dose_unit_id, ds.kode as dose_unit_code, ds.nama as dose_unit_name,
                    d.rute_id as route_id, d.lama_hari as duration_days, d.dtd,
                    d.bentuk_sediaan_id as dosage_form_id, d.keterangan as notes,
                    d.jumlah_diserahkan::text as dispensed, d.jumlah_diretur::text as returned
             from sim_tr_resep_detail d
             left join gd_m_barang b on b.tenant_id = d.tenant_id and b.id = d.obat_id
             left join gd_m_satuan s on s.tenant_id = d.tenant_id and s.id = d.satuan_id
             left join gd_m_satuan bs on bs.tenant_id = b.tenant_id and bs.id = b.satuan_dasar_id
             left join gd_m_satuan ds on ds.tenant_id = d.tenant_id and ds.id = d.dosis_satuan_id
             where d.tenant_id = $1 and d.resep_id = $2 and d.deleted_at is null
             order by d.urutan, d.id`,
            [this.tenantId, prescriptionId],
        );
    }

    async prescriptions(
        recordId: string | null,
        legalEntityId: string,
    ): Promise<Prescription[]> {
        if (!recordId) return [];
        const result: Prescription[] = [];
        for (const prescription of await this.savedPrescriptions(recordId)) {
            const lines = await this.savedLines(prescription.id);
            const units = await itemUnits(
                this.db,
                { tenantId: this.tenantId, legalEntityId },
                lines.flatMap((line) => (line.drug_id ? [line.drug_id] : [])),
            );
            result.push({
                ...prescription,
                lines: lines.map((line) => {
                    const unit: LineUnit | null =
                        line.unit_code && line.conversion
                            ? {
                                  code: line.unit_code,
                                  quantityPerUnit: quantityOf(line.conversion),
                              }
                            : null;
                    const shown = (base: bigint) =>
                        unit
                            ? baseQuantityText(
                                  base,
                                  unit,
                                  line.base_unit_code ?? '',
                              )
                            : null;
                    const returned =
                        line.returned === null
                            ? null
                            : quantityOf(line.returned);
                    return {
                        is_compound_header:
                            line.drug_id === null && line.compound !== null,
                        drug_id: line.drug_id,
                        drug_code: line.drug_code,
                        drug_name: line.drug_name,
                        unit_id: line.unit_id,
                        unit_code: line.unit_code,
                        unit_name: line.unit_name,
                        quantity_per_unit: unit
                            ? numberText(unit.quantityPerUnit)
                            : null,
                        units: line.drug_id
                            ? (units.get(line.drug_id) ?? [])
                            : [],
                        compound: line.compound,
                        quantity: decimalNumber(line.quantity),
                        requested_quantity: decimalNumber(
                            line.requested_quantity,
                        ),
                        signa: line.signa,
                        usage_instruction_id: line.usage_instruction_id,
                        frequency_per_day: line.frequency_per_day,
                        dose: decimalNumber(line.dose),
                        dose_unit_id: line.dose_unit_id,
                        dose_unit_code: line.dose_unit_code,
                        dose_unit_name: line.dose_unit_name,
                        route_id: line.route_id,
                        duration_days: line.duration_days,
                        dtd: line.dtd,
                        dosage_form_id: line.dosage_form_id,
                        notes: line.notes,
                        dispensed_quantity:
                            line.dispensed === null
                                ? null
                                : shown(
                                      quantityOf(line.dispensed) -
                                          (returned ?? 0n),
                                  ),
                        returned_quantity:
                            returned === null ? null : shown(returned),
                    };
                }),
            });
        }
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
            if (row.is_compound_header === true) {
                // Kepala racikan "Racikan N".
                if (compound === null || compounds.has(compound)) {
                    add(errors, field('compound'), invalidCompoundMessage);
                    continue;
                }
                compounds.add(compound);
                if (!missing(row.drug_id))
                    add(errors, field('drug_id'), 'Isian ini tidak sah.');
                if (!missing(row.quantity))
                    add(errors, field('quantity'), 'Isian ini tidak sah.');
                const before = saved.find(
                    (line) =>
                        lineKey(line) === lineKey({ drug_id: null, compound }),
                );
                lines.push({
                    drug_id: null,
                    unit: null,
                    compound,
                    quantity: null,
                    requested_quantity: decimal(
                        row.requested_quantity,
                        field('requested_quantity'),
                        errors,
                        quantityMessage,
                    ),
                    signa,
                    usage_instruction_id: usageInstructionId,
                    dosage: await this.dosage(
                        row,
                        before,
                        legalEntityId,
                        field,
                        errors,
                    ),
                    preparation: await this.compoundPreparation(
                        row,
                        before,
                        field,
                        errors,
                    ),
                    notes,
                });
                continue;
            }
            if (missing(row.drug_id)) {
                add(errors, field('drug_id'), missingDrugMessage);
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
            for (const name of compoundPreparationFields)
                if (!missing(row[name]))
                    add(
                        errors,
                        field(name),
                        'Jenis racikan dan bentuk sediaan hanya diisi pada baris racikan.',
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
                for (const name of dosageFields)
                    if (!missing(row[name]))
                        add(
                            errors,
                            field(name),
                            'Dosis komponen racikan diisi pada baris racikannya.',
                        );
            }
            const quantity = decimal(
                row.quantity,
                field('quantity'),
                errors,
                quantityMessage,
            );
            if (quantity === null && missing(row.quantity))
                add(errors, field('quantity'), quantityMessage);
            const unit = await this.lineUnit(
                row.unit_id,
                drug.id,
                saved,
                legalEntityId,
                field('unit_id'),
                errors,
            );
            lines.push({
                drug_id: drug.id,
                unit,
                compound,
                quantity,
                requested_quantity: null,
                signa,
                usage_instruction_id: usageInstructionId,
                dosage:
                    compound === null
                        ? await this.dosage(
                              row,
                              saved.find((line) => line.drug_id === drug.id),
                              legalEntityId,
                              field,
                              errors,
                          )
                        : noDosage,
                preparation: noPreparation,
                notes,
            });
        }
        for (const component of components)
            if (!compounds.has(component.compound))
                add(errors, component.field, invalidCompoundMessage);
        return lines;
    }

    // Bawaannya satuan jual obat, seperti baris penjualan BC yang mengisi Unit of Measure Code dari
    // Sales Unit of Measure barang. Satuan lain harus satuan obat itu sendiri. Baris tersimpan yang satuannya tidak
    // berubah memakai isi yang sudah disalin, walau isi kemasan sejak itu diubah.
    private async lineUnit(
        raw: unknown,
        drugId: string,
        saved: SavedLine[],
        legalEntityId: string,
        field: string,
        errors: Errors,
    ): Promise<ChosenUnit | null> {
        const scope = { tenantId: this.tenantId, legalEntityId };
        if (missing(raw)) {
            const unit = await defaultUnit(this.db, scope, drugId, 'sales');
            if (unit)
                return {
                    id: unit.unitId,
                    conversion: toNumeric(unit.conversion, quantityScale),
                };
        } else {
            const id = typeof raw === 'string' ? lookupId(raw) : null;
            const kept = saved.find(
                (line) => line.drug_id === drugId && line.unit_id === id,
            );
            if (id && kept?.conversion)
                return { id, conversion: kept.conversion };
            const conversion = id
                ? await unitConversion(this.db, scope, drugId, id)
                : null;
            if (id && conversion !== null)
                return {
                    id,
                    conversion: toNumeric(conversion, quantityScale),
                };
        }
        add(errors, field, 'Pilih satuan obat ini dari daftar.');
        return null;
    }

    // Baris aktif daftar pendek tenant, atau baris yang sudah tersimpan (kept) walau sejak itu nonaktif.
    private async listed(
        table:
            'sim_m_aturan_pakai' | 'sim_m_rute_obat' | 'sim_m_bentuk_sediaan',
        raw: unknown,
        kept: (id: string) => boolean,
    ): Promise<string | null> {
        const id = typeof raw === 'string' ? lookupId(raw) : null;
        const found = id
            ? await this.db.one(
                  z.object({ id: z.string() }),
                  `select id from ${table}
                   where tenant_id = $1 and id = $2 and deleted_at is null and (aktif or $3)`,
                  [this.tenantId, id, kept(id)],
              )
            : undefined;
        return found?.id ?? null;
    }

    private async usageInstruction(
        raw: unknown,
        saved: SavedLine[],
        field: string,
        errors: Errors,
    ): Promise<string | null> {
        if (missing(raw)) return null;
        const id = await this.listed('sim_m_aturan_pakai', raw, (value) =>
            saved.some((line) => line.usage_instruction_id === value),
        );
        if (!id) add(errors, field, 'Pilih dari daftar.');
        return id;
    }

    // Dosis obat tunggal dan kepala racikan; kelimanya wajib. Satuan dosis adalah satuan persediaan legal entity
    // kunjungan, sumber yang sama dengan satuan obat, dan rute dari daftar rute tenant. Nilai yang sudah tersimpan di baris
    // ini tetap diterima walau satuannya sejak itu dihapus atau rutenya dinonaktifkan.
    private async dosage(
        row: Record<string, unknown>,
        before: SavedLine | undefined,
        legalEntityId: string,
        field: (name: keyof Dosage) => string,
        errors: Errors,
    ): Promise<Dosage> {
        const frequency = count(
            row.frequency_per_day,
            field('frequency_per_day'),
            errors,
            {
                missing: 'Isi berapa kali sehari.',
                invalid:
                    'Isi berapa kali sehari dengan bilangan bulat 1 atau lebih.',
            },
        );
        const dose = decimal(
            row.dose,
            field('dose'),
            errors,
            `Isi dosis ${decimalRule}`,
        );
        if (missing(row.dose))
            add(errors, field('dose'), 'Isi dosis sekali pakai.');
        let doseUnitId: string | null = null;
        if (missing(row.dose_unit_id))
            add(errors, field('dose_unit_id'), 'Pilih satuan dosis.');
        else {
            const id =
                typeof row.dose_unit_id === 'string'
                    ? lookupId(row.dose_unit_id)
                    : null;
            const found = id
                ? await this.db.one(
                      z.object({ id: z.string() }),
                      `select id from gd_m_satuan
                       where tenant_id = $1 and legal_entity_id = $2 and id = $3 and (deleted_at is null or $4)`,
                      [
                          this.tenantId,
                          legalEntityId,
                          id,
                          before?.dose_unit_id === id,
                      ],
                  )
                : undefined;
            if (!found)
                add(
                    errors,
                    field('dose_unit_id'),
                    'Pilih satuan dosis dari daftar.',
                );
            doseUnitId = found?.id ?? null;
        }
        let routeId: string | null = null;
        if (missing(row.route_id))
            add(errors, field('route_id'), 'Pilih rute pemberian.');
        else {
            routeId = await this.listed(
                'sim_m_rute_obat',
                row.route_id,
                (id) => before?.route_id === id,
            );
            if (!routeId)
                add(
                    errors,
                    field('route_id'),
                    'Pilih rute pemberian dari daftar.',
                );
        }
        const duration = count(
            row.duration_days,
            field('duration_days'),
            errors,
            {
                missing: 'Isi lama pemberian (hari).',
                invalid:
                    'Isi lama pemberian dengan bilangan bulat 1 hari atau lebih.',
            },
        );
        return {
            frequency_per_day: frequency,
            dose,
            dose_unit_id: doseUnitId,
            route_id: routeId,
            duration_days: duration,
        };
    }

    // Keduanya wajib karena Medication SATUSEHAT untuk racikan menuntut MedicationType (SD atau EP) dan form.
    private async compoundPreparation(
        row: Record<string, unknown>,
        before: SavedLine | undefined,
        field: (name: keyof CompoundPreparation) => string,
        errors: Errors,
    ): Promise<CompoundPreparation> {
        let dtd: boolean | null = null;
        if (typeof row.dtd === 'boolean') dtd = row.dtd;
        else
            add(
                errors,
                field('dtd'),
                missing(row.dtd)
                    ? 'Pilih jenis racikan: d.t.d. atau dibagi rata.'
                    : 'Isian ini tidak sah.',
            );
        let dosageFormId: string | null = null;
        if (missing(row.dosage_form_id))
            add(
                errors,
                field('dosage_form_id'),
                'Pilih bentuk sediaan hasil racikan.',
            );
        else {
            dosageFormId = await this.listed(
                'sim_m_bentuk_sediaan',
                row.dosage_form_id,
                (id) => before?.dosage_form_id === id,
            );
            if (!dosageFormId)
                add(
                    errors,
                    field('dosage_form_id'),
                    'Pilih bentuk sediaan dari daftar.',
                );
        }
        return { dtd, dosage_form_id: dosageFormId };
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
                satuan_id: line.unit?.id ?? null,
                konversi: line.unit?.conversion ?? null,
                jumlah: line.quantity,
                jumlah_permintaan: line.requested_quantity,
                signa: line.signa,
                aturan_pakai_id: line.usage_instruction_id,
                frekuensi: line.dosage.frequency_per_day,
                dosis: line.dosage.dose,
                dosis_satuan_id: line.dosage.dose_unit_id,
                rute_id: line.dosage.route_id,
                lama_hari: line.dosage.duration_days,
                dtd: line.preparation.dtd,
                bentuk_sediaan_id: line.preparation.dosage_form_id,
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
                match.unit_id !== values.satuan_id ||
                match.conversion !== values.konversi ||
                match.quantity !== values.jumlah ||
                match.requested_quantity !== values.jumlah_permintaan ||
                match.signa !== values.signa ||
                match.usage_instruction_id !== values.aturan_pakai_id ||
                match.frequency_per_day !== values.frekuensi ||
                match.dose !== values.dosis ||
                match.dose_unit_id !== values.dosis_satuan_id ||
                match.route_id !== values.rute_id ||
                match.duration_days !== values.lama_hari ||
                match.dtd !== values.dtd ||
                match.dosage_form_id !== values.bentuk_sediaan_id ||
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
