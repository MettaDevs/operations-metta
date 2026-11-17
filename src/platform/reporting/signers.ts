import { z } from 'zod';
import type { Database } from '../database/index.ts';
import { cell, paragraph, when, type Block, type Table } from './docx.ts';
import { field, type Values } from './report.ts';

// Penanda tangan dokumen (pejabat yang "mengetahui" atau "menyetujui"), Sys Admin › Kop surat. Padanan Officials di
// Dynamics 365 Finance: jabatan, nama, dan nomor induk per organisasi, boleh dibatasi ke satu laporan. Mesin mengisinya
// untuk setiap laporan sebagai tag {#signers}; layout yang tidak memakainya tidak terpengaruh.
export const signerFields = {
    signers: field.lines('Penanda tangan (Sys Admin › Kop surat)', {
        title: field.text('Jabatan'),
        name: field.text('Nama'),
        id_number: field.text('Nomor induk atau izin, apa adanya'),
    }),
};

const signerSchema = z.object({
    organization_id: z.string(),
    title: z.string(),
    name: z.string(),
    id_number: z.string().nullable(),
});

// Penanda tangan unit kerja yang menerbitkan dokumen, kalau unit itu tidak punya untuk laporan ini, milik legal
// entity-nya; urutan yang sama dengan kop surat. Penanda tangan tanpa laporan berlaku untuk semua laporan.
export async function signers(
    db: Database,
    tenantId: string,
    reportCode: string,
    legalEntityId: string,
    operatingUnitId: string | null,
): Promise<Values<typeof signerFields>> {
    const rows = await db.rows(
        signerSchema,
        `select organization_id, jabatan as title, nama as name, nomor_induk as id_number
         from penanda_tangan_cetak
         where tenant_id = $1 and organization_id = any($2::uuid[]) and deleted_at is null
           and (kode_laporan is null or kode_laporan = $3)
         order by urutan, jabatan`,
        [
            tenantId,
            `{${[operatingUnitId, legalEntityId].filter((id) => id !== null).join(',')}}`,
            reportCode,
        ],
    );
    const owner = rows.some((row) => row.organization_id === operatingUnitId)
        ? operatingUnitId
        : legalEntityId;
    return {
        signers: rows
            .filter((row) => row.organization_id === owner)
            .map(({ title, name, id_number }) => ({ title, name, id_number })),
    };
}

export type SignatureParty = { caption: string; name: string };

// Kotak tanda tangan layout bawaan: satu kolom per pihak yang mengerjakan dokumen (nama dari dataset), lalu penanda
// tangan dari Kop surat di bawahnya, satu blok per orang. Blok penanda tangan hilang bila organisasinya belum
// mengisinya, jadi dokumen tetap rapi tanpa pengaturan apa pun.
export function signatureBlocks(
    parties: SignatureParty[],
    caption: { dated: string; signers: string },
): Block[] {
    const space = 36;
    const table: Table = {
        kind: 'table',
        widths: parties.map(() => 1),
        borders: 'none',
        rows: [
            {
                cells: parties.map((party) =>
                    cell(party.caption, { align: 'center' }),
                ),
            },
            {
                cells: parties.map(() => cell('', { spaceAfter: space })),
            },
            {
                cells: parties.map((party) =>
                    cell(`( ${party.name} )`, { align: 'center' }),
                ),
            },
        ],
    };
    return [
        paragraph(caption.dated, { align: 'right', spaceAfter: 6 }),
        table,
        ...when('signers', [
            paragraph('', { spaceAfter: 6 }),
            paragraph(caption.signers, { align: 'center' }),
            paragraph('{title}', { align: 'center', spaceAfter: space }),
            paragraph('{name}', { align: 'center', bold: true }),
            ...when('id_number', [
                paragraph('{id_number}', { align: 'center' }),
            ]),
        ]),
    ];
}
