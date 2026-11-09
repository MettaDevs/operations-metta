import { z } from 'zod';
import type { Database } from '../database/index.ts';
import { lookupId, validation } from '../http/index.ts';

const regionIdFields = [
    'province_id',
    'regency_id',
    'district_id',
    'village_id',
    'postal_code_id',
    'group_of_houses_id',
] as const;
type RegionIdField = (typeof regionIdFields)[number];
export type PostalRegionIds = Record<RegionIdField, string | null>;

const named = z.object({ id: z.string(), name: z.string() });

// Rujukan wilayah satu alamat pos (PostalAddressReferences CoreERP). Setiap tingkat harus anak dari pilihan di atasnya,
// dimulai dari negara, dan namanya diambil dari master, bukan dari teks kiriman. Id yang tidak dikirim memakai id
// alamat yang sedang diubah. Dusun/banjar milik tenant, jadi dicari di tenant itu dan di bawah desa yang dipilih.
export async function resolvePostalRegions(
    db: Database,
    tenantId: string,
    data: Record<string, unknown>,
    existing: PostalRegionIds | null,
): Promise<Record<string, unknown>> {
    const resolved = { ...data };
    const pick = (field: RegionIdField) => {
        const value = field in data ? data[field] : existing?.[field];
        return typeof value === 'string' && value !== '' ? value : null;
    };
    let parentId: string | null =
        typeof data.country_region_code === 'string'
            ? data.country_region_code
            : null;
    for (const [field, text, table, parentColumn] of [
        ['province_id', 'province', 'ref_provinces', 'country_code'],
        ['regency_id', 'city', 'ref_regencies', 'province_id'],
        ['district_id', 'district', 'ref_districts', 'regency_id'],
        ['village_id', 'village', 'ref_villages', 'district_id'],
    ] as const) {
        const id = pick(field);
        if (id !== null) {
            const record =
                parentId !== null && lookupId(id)
                    ? await db.one(
                          named,
                          `select id, name from ${table} where tenant_id is null and id = $1 and ${parentColumn} = $2`,
                          [id, parentId],
                      )
                    : undefined;
            if (!record)
                validation({
                    [field]:
                        'Pilih wilayah yang sesuai dengan pilihan sebelumnya.',
                });
            resolved[field] = record.id;
            resolved[text] = record.name;
        } else resolved[field] = null;
        parentId = resolved[field] as string | null;
    }
    const villageId = parentId;

    const postalId = pick('postal_code_id');
    if (postalId !== null) {
        const postal =
            villageId !== null && lookupId(postalId)
                ? await db.one(
                      z.object({ id: z.string(), postal_code: z.string() }),
                      'select id, postal_code from ref_postal_codes where id = $1 and tenant_id is null and country_code = $2 and village_id = $3',
                      [postalId, String(data.country_region_code), villageId],
                  )
                : undefined;
        if (!postal)
            validation({
                postal_code_id:
                    'Pilih kode pos untuk kelurahan atau desa yang dipilih.',
            });
        resolved.postal_code_id = postal.id;
        resolved.postal_code = postal.postal_code;
    } else resolved.postal_code_id = null;

    const hamletId = pick('group_of_houses_id');
    if (hamletId !== null) {
        // Dusun yang sudah dihapus tetap sah bagi alamat yang sejak awal menunjuknya.
        const kept = hamletId === existing?.group_of_houses_id;
        const hamlet =
            villageId !== null && lookupId(hamletId)
                ? await db.one(
                      named,
                      `select id, name from ref_group_of_houses where id = $1 and tenant_id = $2 and village_id = $3 ${kept ? '' : 'and deleted_at is null'}`,
                      [hamletId, tenantId, villageId],
                  )
                : undefined;
        if (!hamlet)
            validation({
                group_of_houses_id:
                    'Pilih dari daftar di bawah kelurahan atau desa yang dipilih.',
            });
        resolved.group_of_houses_id = hamlet.id;
        resolved.group_of_houses = hamlet.name;
    } else resolved.group_of_houses_id = null;
    return resolved;
}
