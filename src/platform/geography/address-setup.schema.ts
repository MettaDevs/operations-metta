import { z } from 'zod';
import {
    fieldErrors,
    failOn,
    listParametersSchema,
    lookupId,
    nullableText,
} from '../http/index.ts';

// Baris master wilayah dengan kolom dan urutan yang sama dengan model Eloquent CoreERP (Province, Regency, District,
// Village) saat diubah ke JSON.
const audit = {
    created_at: nullableText,
    updated_at: nullableText,
    created_by_user_id: nullableText,
    updated_by_user_id: nullableText,
    version: z.number(),
};
export const provinceRowSchema = z.object({
    id: z.string(),
    tenant_id: nullableText,
    country_code: z.string(),
    code: z.string(),
    name: z.string(),
    active: z.boolean(),
    timezone: z.string(),
    intrastat: nullableText,
    it_state_code: nullableText,
    state_code: nullableText,
    default_state: z.boolean(),
    union_territory: z.boolean(),
    display_code: nullableText,
    description: nullableText,
    ...audit,
});
export const regencyRowSchema = z.object({
    id: z.string(),
    tenant_id: nullableText,
    province_id: z.string(),
    code: z.string(),
    name: z.string(),
    type: z.string(),
    active: z.boolean(),
    it_county_code: nullableText,
    es_county_code: nullableText,
    display_code: nullableText,
    description: nullableText,
    ...audit,
});
export const districtRowSchema = z.object({
    id: z.string(),
    tenant_id: nullableText,
    regency_id: z.string(),
    code: z.string(),
    name: z.string(),
    active: z.boolean(),
    display_code: nullableText,
    ...audit,
});
export const villageRowSchema = z.object({
    id: z.string(),
    tenant_id: nullableText,
    district_id: z.string(),
    code: z.string(),
    name: z.string(),
    type: z.string(),
    postal_code: nullableText,
    active: z.boolean(),
    display_code: nullableText,
    ...audit,
});
export const postalOptionSchema = z.object({
    id: z.string(),
    postal_code: z.string(),
    area_name: nullableText,
});
export const hierarchyLevelSchema = z.object({
    level: z.number(),
    level_code: z.string(),
    level_name: z.string(),
    description: nullableText,
});

// Bagian Address setup yang bisa dicari, beserta tabelnya (AddressSetupRecords::TABLES CoreERP). Jalan, gedung, dan
// bidang tanah belum pindah; dusun/banjar milik tenant dicari lewat daftarnya sendiri.
const sections = [
    'countries',
    'provinces',
    'regencies',
    'cities',
    'districts',
    'villages',
    'postalCodes',
] as const;
export type DivisionSection = (typeof sections)[number];
const sectionSchema = z.enum(sections);
export const divisionTables = {
    countries: 'country_regions',
    provinces: 'ref_provinces',
    regencies: 'ref_regencies',
    cities: 'ref_regencies',
    districts: 'ref_districts',
    villages: 'ref_villages',
    postalCodes: 'ref_postal_codes',
} as const satisfies Record<DivisionSection, string>;

// Query string tiga bacaan wilayah. Handler membaca URL-nya sendiri; skema ini memberi tipe bagi pemanggil di layar.
export const regionLookupQuerySchema = z.object({
    parent_type: z
        .enum(['country', 'province', 'regency', 'district', 'village'])
        .optional(),
    parent_id: z.string().optional(),
    country_code: z.string().optional(),
    country_id: z.string().optional(),
    province_id: z.string().optional(),
    regency_id: z.string().optional(),
    district_id: z.string().optional(),
});
export const divisionQuerySchema = listParametersSchema.extend({
    section: sectionSchema,
    country: z.string().optional(),
    province_id: z.string().optional(),
    regency_id: z.string().optional(),
    district_id: z.string().optional(),
    village_id: z.string().optional(),
    include_cities: z.enum(['0', '1']).optional(),
});
export const hierarchyLevelQuerySchema = z.object({ country_code: z.string() });

export type DivisionFilters = {
    section: DivisionSection;
    country: string | null;
    province_id: string | null;
    regency_id: string | null;
    district_id: string | null;
    village_id: string | null;
    include_cities: boolean;
};

const uuidRule = (field: string, value: string | null) =>
    value === null || lookupId(value)
        ? []
        : [`The ${field.replaceAll('_', ' ')} field must be a valid UUID.`];

// Aturan validate() AddressSetupRecords::batch. Teks kosong dibaca sebagai tidak diisi, sama dengan
// ConvertEmptyStringsToNull Laravel.
export function divisionFilters(parameters: URLSearchParams): DivisionFilters {
    const read = (name: string) => {
        const value = parameters.get(name)?.trim();
        return value ? value : null;
    };
    const section = read('section');
    const country = read('country');
    const ids = {
        province_id: read('province_id'),
        regency_id: read('regency_id'),
        district_id: read('district_id'),
        village_id: read('village_id'),
    };
    const includeCities = parameters.get('include_cities');
    failOn({
        section: fieldErrors('section', section, [
            { kind: 'required' },
            { kind: 'in', values: sections },
        ]),
        country: fieldErrors('country', country, [{ kind: 'max', length: 3 }]),
        ...Object.fromEntries(
            Object.entries(ids).map(([field, value]) => [
                field,
                uuidRule(field, value),
            ]),
        ),
        include_cities:
            includeCities === null || ['0', '1'].includes(includeCities)
                ? []
                : ['The include cities field must be true or false.'],
    });
    return {
        section: sectionSchema.parse(section),
        country,
        ...ids,
        include_cities: includeCities === '1',
    };
}
