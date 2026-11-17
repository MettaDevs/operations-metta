import {
    cell,
    paragraph,
    when,
    wordDocument,
    type BuiltinLayout,
    type Row,
} from '@core/platform/reporting/index.ts';

// Baris catatan dan batch hanya tampil bila isinya ada: tag syaratnya dibuka di sel pertama dan ditutup di sel kedua,
// jadi seluruh baris tabel ikut hilang.
// Etiket bawaan di kertas 96 × 200 mm (lebar isi 80 mm), seperti print_etiket sistem lama: etiket ditumpuk satu per
// obat atau racikan, dan berlanjut ke halaman berikutnya bila tidak muat. Apotek yang memakai kertas lain mengunduh
// layout ini dari Sys Admin › Layout cetak, mengubah ukuran kertasnya di Word, lalu mengunggahnya.

const row = (...cells: ReturnType<typeof cell>[]): Row => ({ cells });

function label96x200(): Uint8Array {
    return wordDocument({
        paper: { widthMm: 96, heightMm: 200 },
        marginMm: 8,
        font: 'Arial',
        fontSize: 9,
        body: when('labels', [
            {
                kind: 'table',
                widths: [55, 45],
                borders: 'grid',
                rows: [
                    row(
                        cell('{letterhead.name}', {
                            span: 2,
                            align: 'center',
                            bold: true,
                        }),
                    ),
                    row(
                        cell('No. {prescription_number}'),
                        cell('{issued_at_date}', { align: 'right' }),
                    ),
                    row(
                        cell([
                            { text: '{patient_name}', bold: true },
                            ' ({patient_age_years} th)',
                        ]),
                        cell('RM {medical_record_number}', { align: 'right' }),
                    ),
                    row(
                        cell('{signa}', {
                            span: 2,
                            align: 'center',
                            bold: true,
                            size: 14,
                        }),
                    ),
                    row(
                        cell('{usage} {dose} {route}', {
                            span: 2,
                            align: 'center',
                        }),
                    ),
                    row(
                        cell([{ text: '{name}', bold: true }]),
                        cell('{quantity} {unit}', { align: 'right' }),
                    ),
                    row(
                        cell('{#components}  - {name}'),
                        cell('{quantity} {unit}{/components}', {
                            align: 'right',
                        }),
                    ),
                    row(cell('{#notes}{notes}', { size: 8 }), cell('{/notes}')),
                    row(
                        cell('{#batch_number}Batch {batch_number}', {
                            size: 8,
                        }),
                        cell('ED {expiry_date}{/batch_number}', {
                            align: 'right',
                            size: 8,
                        }),
                    ),
                ],
            },
            paragraph('', { spaceAfter: 8 }),
        ]),
    });
}

export const drugLabelLayouts: [BuiltinLayout, ...BuiltinLayout[]] = [
    {
        key: 'label-96x200',
        name: 'Etiket 96 × 200 mm',
        language: 'id',
        document: label96x200,
    },
];
