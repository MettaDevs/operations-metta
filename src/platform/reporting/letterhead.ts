import { z } from 'zod';
import type { Database } from '../database/index.ts';
import { paragraph, when, type Block } from './docx.ts';
import { field, type Values } from './report.ts';

// Kop surat dokumen: identitas cetak unit kerja yang menerbitkan dokumen, kalau tidak ada milik legal entity-nya,
// kalau tidak ada juga cukup nama legal entity. Alamat dan kontak dibaca dari buku alamat organisasi yang identitasnya
// dipakai, bukan disalin ke identitas cetak.
export const letterheadFields = {
    name: field.text('Nama'),
    parent_lines: field.text('Baris induk, misalnya dinas di atas puskesmas'),
    address: field.text('Alamat'),
    phone: field.text('Telepon'),
    email: field.text('Email'),
    tax_id: field.text('NPWP'),
    registration_id: field.text('Nomor izin'),
    footer: field.text('Catatan kaki'),
};

const identitySchema = z.object({
    organization_id: z.string(),
    organization_name: z.string(),
    display_name: z.string().nullable(),
    parent_lines: z.array(z.string()).nullable(),
    tax_id: z.string().nullable(),
    registration_id: z.string().nullable(),
    footer_text: z.string().nullable(),
    address: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
});

export async function letterhead(
    db: Database,
    tenantId: string,
    legalEntityId: string,
    operatingUnitId: string | null,
): Promise<Values<typeof letterheadFields>> {
    const candidates = await db.rows(
        identitySchema.extend({ has_identity: z.boolean() }),
        `with chosen as (
             select o.id, o.name, ord
             from unnest($2::uuid[]) with ordinality as wanted(id, ord)
             join organizations o on o.tenant_id = $1 and o.id = wanted.id
         ),
         contact as (
             select op.organization_id, pl.location_id, pl.is_primary
             from organization_parties op
             join party_locations pl on pl.tenant_id = op.tenant_id and pl.party_id = op.party_id
                                    and pl.deleted_at is null
             where op.tenant_id = $1 and op.organization_id in (select id from chosen)
         )
         select c.id as organization_id, c.name as organization_name, p.id is not null as has_identity,
                p.display_name, p.parent_lines::jsonb as parent_lines, p.tax_id, p.registration_id, p.footer_text,
                (select a.formatted from contact x join postal_addresses a on a.location_id = x.location_id
                 where x.organization_id = c.id order by x.is_primary desc limit 1) as address,
                (select e.value from contact x join electronic_addresses e on e.location_id = x.location_id
                 where x.organization_id = c.id and e.type = 'phone' and e.deleted_at is null
                 order by e.is_primary desc, x.is_primary desc limit 1) as phone,
                (select e.value from contact x join electronic_addresses e on e.location_id = x.location_id
                 where x.organization_id = c.id and e.type = 'email' and e.deleted_at is null
                 order by e.is_primary desc, x.is_primary desc limit 1) as email
         from chosen c
         left join print_identities p on p.tenant_id = $1 and p.organization_id = c.id
         order by c.ord`,
        [
            tenantId,
            `{${[operatingUnitId, legalEntityId].filter((id) => id !== null).join(',')}}`,
        ],
    );
    const chosen =
        candidates.find((candidate) => candidate.has_identity) ??
        candidates.find(
            (candidate) => candidate.organization_id === legalEntityId,
        );
    if (!chosen) throw new Error('Legal entity dokumen tidak ditemukan.');
    return {
        name: chosen.display_name ?? chosen.organization_name,
        parent_lines: (chosen.parent_lines ?? []).join('\n'),
        address: chosen.address ?? '',
        phone: chosen.phone ?? '',
        email: chosen.email ?? '',
        tax_id: chosen.tax_id ?? '',
        registration_id: chosen.registration_id ?? '',
        footer: chosen.footer_text ?? '',
    };
}

// Kop surat siap pakai untuk layout bawaan. Paragraf yang isinya kosong hilang dari kertas, karena setiap baris
// dibungkus syarat `{#…}` atas field-nya sendiri.
export function letterheadBlocks(size: {
    name: number;
    detail: number;
}): Block[] {
    const line = (
        key: keyof typeof letterheadFields,
        text: string,
        bold = false,
    ) =>
        when(`letterhead.${key}`, [
            paragraph(text, {
                align: 'center',
                size: bold ? size.name : size.detail,
                bold,
            }),
        ]);
    return [
        ...line('parent_lines', '{letterhead.parent_lines}'),
        ...line('name', '{letterhead.name}', true),
        ...line('address', '{letterhead.address}'),
        ...line('phone', 'Telp. {letterhead.phone}'),
        ...line('email', '{letterhead.email}'),
        ...line('registration_id', '{letterhead.registration_id}'),
    ];
}
