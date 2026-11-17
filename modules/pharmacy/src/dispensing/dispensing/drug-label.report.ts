import type { Workspace } from '@core/platform/access/index.ts';
import type { Database } from '@core/platform/database/index.ts';
import {
    defineReport,
    field,
    type Values,
} from '@core/platform/reporting/index.ts';
import { z } from 'zod';
import { moduleWorkspace } from '../../module.ts';
import { drugLabelLayouts } from './drug-label.layout.ts';
import { Dispensings } from './dispensing.service.ts';

// Etiket obat satu resep (Pharmacy::billing sistem lama): satu etiket per obat, dan satu etiket per racikan dengan
// komposisinya. Datanya dari resep yang dipegang farmasi sendiri: identitas pasien dari salinan resep, jumlah dan batch
// dari penyerahan. Jenis kelamin dan alamat pasien belum ikut event resep, jadi belum ada di etiket.
export const drugLabelFields = {
    prescription_number: field.text('Nomor resep'),
    registration_number: field.text('Nomor registrasi'),
    dispensing_number: field.text('Nomor penyerahan'),
    patient_name: field.text('Nama pasien'),
    medical_record_number: field.text('Nomor rekam medis'),
    birth_date: field.date('Tanggal lahir'),
    patient_age_years: field.quantity('Umur (tahun)'),
    doctor_name: field.text('Dokter'),
    section_name: field.text('Poli'),
    issued_at: field.datetime('Waktu resep'),
    prepared_at: field.datetime('Waktu disiapkan'),
    labels: field.lines('Etiket, satu per obat atau racikan', {
        name: field.text('Nama obat atau racikan'),
        quantity: field.quantity('Jumlah'),
        unit: field.text('Satuan'),
        signa: field.text('Signa'),
        usage: field.text('Aturan pakai'),
        dose: field.text('Dosis'),
        route: field.text('Rute'),
        notes: field.text('Keterangan'),
        batch_number: field.text('Nomor batch'),
        expiry_date: field.date('Kedaluwarsa'),
        is_compound: field.flag('Racikan'),
        components: field.lines('Komposisi racikan', {
            name: field.text('Bahan'),
            quantity: field.quantity('Jumlah'),
            unit: field.text('Satuan'),
        }),
    }),
};

type Label = Values<typeof drugLabelFields>['labels'][number];

const headerSchema = z.object({
    operating_unit_id: z.string().nullable(),
    age_years: z.string().nullable(),
});

async function drugLabels(
    db: Database,
    workspace: Workspace,
    prescriptionId: string,
) {
    const { data } = await new Dispensings(db, workspace).show(prescriptionId);
    const { prescription, dispensing, lines } = data;
    const header = await db.one(
        headerSchema,
        `select operating_unit_id,
                extract(year from age(diterbitkan_pada::date, tanggal_lahir))::int::text as age_years
         from far_tr_resep where tenant_id = $1 and id = $2`,
        [workspace.tenantId, prescription.id],
    );
    const dispensed = new Map(
        lines.map((line) => [line.prescription_line_id, line]),
    );
    const labels: Label[] = [];
    const compounds = new Map<number, Label>();
    for (const line of prescription.lines) {
        const given = dispensed.get(line.id);
        const taken = given?.taken[0];
        const label: Label = {
            name:
                given?.item.name ??
                line.item?.name ??
                line.dosage_form?.name ??
                null,
            quantity:
                given?.quantity ?? line.quantity ?? line.requested_quantity,
            unit: given?.unit.name ?? line.unit?.name ?? null,
            signa: line.signa,
            usage: line.usage_instruction,
            dose:
                line.dose === null
                    ? null
                    : `${line.dose} ${line.dose_unit?.name ?? ''}`.trim(),
            route: line.route?.name ?? null,
            notes: line.notes,
            batch_number:
                given?.batch?.batch_number ?? taken?.batch_number ?? null,
            expiry_date:
                given?.batch?.expiry_date ?? taken?.expiry_date ?? null,
            is_compound: false,
            components: [],
        };
        if (line.compound === null) {
            labels.push(label);
            continue;
        }
        if (!line.item) {
            const compound = {
                ...label,
                name: label.name ?? `Racikan ${String(line.compound)}`,
                is_compound: true,
            };
            compounds.set(line.compound, compound);
            labels.push(compound);
            continue;
        }
        compounds.get(line.compound)?.components.push({
            name: label.name,
            quantity: label.quantity,
            unit: label.unit,
        });
    }
    return {
        legalEntityId: workspace.legalEntityId ?? '',
        operatingUnitId: header?.operating_unit_id ?? null,
        fileName: `Etiket ${prescription.prescription_number}`,
        values: {
            prescription_number: prescription.prescription_number,
            registration_number: prescription.registration_number,
            dispensing_number: dispensing?.number ?? null,
            patient_name: prescription.patient_name,
            medical_record_number: prescription.medical_record_number,
            birth_date: prescription.birth_date,
            patient_age_years: header?.age_years ?? null,
            doctor_name: prescription.doctor_name,
            section_name: prescription.section_name,
            issued_at: prescription.issued_at,
            prepared_at: dispensing?.prepared_at ?? null,
            labels,
        },
    };
}

export const drugLabelReport = defineReport({
    code: 'pharmacy.drug-label',
    name: 'Etiket obat',
    moduleId: 'pharmacy',
    permission: 'pharmacy.prescription.read',
    workspace: (context) => moduleWorkspace(context),
    fields: drugLabelFields,
    sample: {
        legalEntityId: '00000000-0000-0000-0000-000000000000',
        operatingUnitId: null,
        fileName: 'Etiket R-0001',
        values: {
            prescription_number: 'R-2611-0001',
            registration_number: 'RJ-2611-0007',
            dispensing_number: 'FAR-2611-0003',
            patient_name: 'Pasien Contoh',
            medical_record_number: '00-00-12',
            birth_date: '1990-05-17',
            patient_age_years: '36',
            doctor_name: 'Dokter Contoh',
            section_name: 'Poli Umum',
            issued_at: '2026-11-17T01:00:00.000000Z',
            prepared_at: '2026-11-17T01:20:00.000000Z',
            labels: [
                {
                    name: 'Parasetamol 500 mg',
                    quantity: '10',
                    unit: 'Tablet',
                    signa: '3 x 1',
                    usage: 'Sesudah makan',
                    dose: null,
                    route: 'Oral',
                    notes: 'Bila demam',
                    batch_number: 'B-0001',
                    expiry_date: '2027-12-31',
                    is_compound: false,
                    components: [],
                },
                {
                    name: 'Puyer',
                    quantity: '10',
                    unit: 'Bungkus',
                    signa: '2 x 1',
                    usage: 'Sesudah makan',
                    dose: null,
                    route: 'Oral',
                    notes: null,
                    batch_number: null,
                    expiry_date: null,
                    is_compound: true,
                    components: [
                        {
                            name: 'Amoksisilin 500 mg',
                            quantity: '5',
                            unit: 'Tablet',
                        },
                        {
                            name: 'Parasetamol 500 mg',
                            quantity: '5',
                            unit: 'Tablet',
                        },
                    ],
                },
            ],
        },
    },
    layouts: drugLabelLayouts,
    load: drugLabels,
});
