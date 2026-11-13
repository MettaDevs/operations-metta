import { displayNumber } from '@operations-metta/ui/display-number';
import type { ReactNode } from 'react';
import type { ApiBody } from '@core/platform/shell/index.ts';
import { birthText, dateTimeText, Fact } from './prescription-display.tsx';

export type Prescription = ApiBody<'pharmacyPrescriptionShow'>['data'];
export type PrescriptionLine = Prescription['lines'][number];

// Kepala racikan hanya pengelompok: tanpa barang, bernomor racikan, dengan jumlah racikan yang diminta.
export const isCompoundHeader = (line: PrescriptionLine) =>
    line.item === null && line.compound !== null;

// Dosis yang ditulis dokter, misalnya "3 x sehari 1 Tablet, Oral, 5 hari"; kosong pada resep yang ditulis sebelum dosis
// dicatat dan pada komponen racikan.
export function dosageText(line: PrescriptionLine): string {
    const amount =
        line.frequency_per_day !== null && line.dose !== null
            ? `${line.frequency_per_day} x sehari ${displayNumber(line.dose)} ${line.dose_unit?.name ?? ''}`.trim()
            : null;
    return [
        amount,
        line.route?.name ?? null,
        line.duration_days === null ? null : `${line.duration_days} hari`,
    ]
        .filter(Boolean)
        .join(', ');
}

// Signa, dosis, dan aturan pakai baris, dalam urutan dokter menulisnya.
export const instructionText = (line: PrescriptionLine) =>
    [line.signa, dosageText(line), line.usage_instruction]
        .filter(Boolean)
        .join(' · ');

// Identitas resep apa adanya seperti dikirim dokter.
export function PrescriptionFacts({
    prescription,
}: {
    prescription: Prescription;
}): ReactNode {
    return (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <Fact label="No resep">{prescription.prescription_number}</Fact>
            <Fact label="No registrasi">
                {prescription.registration_number}
            </Fact>
            <Fact label="Diterbitkan">
                {dateTimeText(prescription.issued_at)}
            </Fact>
            <Fact label="Dokter">{prescription.doctor_name}</Fact>
            <Fact label="Pasien">{prescription.patient_name}</Fact>
            <Fact label="NRM">{prescription.medical_record_number}</Fact>
            <Fact label="Tanggal lahir">
                {birthText(prescription.birth_date)}
            </Fact>
            <Fact label="Section asal">
                {`${prescription.section_name} · ${prescription.operating_unit_name}`}
            </Fact>
            {prescription.notes && (
                <Fact label="Catatan dokter">{prescription.notes}</Fact>
            )}
        </dl>
    );
}
