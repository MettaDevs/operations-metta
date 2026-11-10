import { z } from 'zod';
import type { Workspace } from '../access/index.ts';
import { Database, isoSql, type Bind } from '../database/index.ts';
import {
    fieldErrors,
    failOn,
    incrementalList,
    lookupId,
} from '../http/index.ts';
import {
    districtRowSchema,
    divisionFilters,
    divisionTables,
    hierarchyLevelSchema,
    postalOptionSchema,
    provinceRowSchema,
    regencyRowSchema,
    villageRowSchema,
    type DivisionFilters,
} from './address-setup.schema.ts';

const audit = `${isoSql('created_at')} as created_at, ${isoSql('updated_at')} as updated_at,
               created_by_user_id, updated_by_user_id, version`;
const provinceSql = `select id, tenant_id, country_code, code, name, active, timezone, intrastat, it_state_code,
                            state_code, default_state, union_territory, display_code, description, ${audit}
                     from ref_provinces`;
const regencySql = `select id, tenant_id, province_id, code, name, type, active, it_county_code, es_county_code,
                           display_code, description, ${audit}
                    from ref_regencies`;
const districtSql = `select id, tenant_id, regency_id, code, name, active, display_code, ${audit}
                     from ref_districts`;
const villageSql = `select id, tenant_id, district_id, code, name, type, postal_code, active, display_code, ${audit}
                    from ref_villages`;

// Isi query string yang dianggap terisi oleh PHP: bukan null, bukan teks kosong, dan bukan "0".
function filled(value: string | null): value is string {
    return value !== null && value !== '' && value !== '0';
}

// Jenis kabupaten/kota yang dihitung kota di layar Address setup CoreERP, untuk master negara mana pun.
const cityTypes = [
    'kota',
    'city',
    'capital_city',
    'thanh_pho',
    'planning_area',
    'huc',
    'municipality',
    'town',
    'khet',
    'krong',
    'quan',
    'special_ward',
];

// Master wilayah bersama: provinsi, kabupaten/kota, kecamatan, kelurahan/desa, dan kode pos. Tidak ada baris milik
// tenant di sini, jadi pembacaannya tidak menyaring tenant; tenant aktif hanya menentukan izin.
export class AddressSetup {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    // AddressSetupController::lookupTopDown CoreERP: pilihan bertingkat untuk form alamat. parent_type memilih
    // tingkat di bawah induk yang disebut; province_id, regency_id, dan district_id sekaligus memberi semua tingkat
    // yang induknya diisi.
    async topDown(parameters: URLSearchParams) {
        const get = (name: string) => parameters.get(name);
        const countryCode = filled(get('country_code'))
            ? get('country_code')
            : get('country_id');
        const parentType = get('parent_type');
        const parentId = get('parent_id');
        const provinceId = get('province_id');
        const regencyId = get('regency_id');
        const districtId = get('district_id');

        if (parentType === 'village') {
            const village = parentId?.trim() || null;
            failOn({
                parent_id: fieldErrors('parent_id', village, [
                    { kind: 'required' },
                ]).concat(
                    village !== null && !lookupId(village)
                        ? ['The parent id field must be a valid UUID.']
                        : [],
                ),
            });
            return this.db.rows(
                postalOptionSchema,
                'select id, postal_code, area_name from ref_postal_codes where tenant_id is null and village_id = $1 and active = true order by postal_code, id',
                [village],
            );
        }

        if (filled(provinceId) || filled(regencyId) || filled(districtId))
            return {
                provinces: await this.provinces(
                    filled(countryCode) ? countryCode : null,
                ),
                regencies: filled(provinceId)
                    ? await this.children(regencySql, 'province_id', provinceId)
                    : [],
                districts: filled(regencyId)
                    ? await this.children(districtSql, 'regency_id', regencyId)
                    : [],
                villages: filled(districtId)
                    ? await this.children(villageSql, 'district_id', districtId)
                    : [],
            };

        switch (parentType) {
            case 'country':
                return this.provinces(filled(parentId) ? parentId : null);
            case 'province':
                return this.children(regencySql, 'province_id', parentId);
            case 'regency':
                return this.children(districtSql, 'regency_id', parentId);
            case 'district':
                return this.children(villageSql, 'district_id', parentId);
            default:
                return {
                    provinces: await this.provinces(
                        filled(countryCode) ? countryCode : null,
                    ),
                };
        }
    }

    private provinces(countryCode: string | null) {
        return countryCode === null
            ? this.db.rows(
                  provinceRowSchema,
                  `${provinceSql} order by name, id`,
              )
            : this.db.rows(
                  provinceRowSchema,
                  `${provinceSql} where country_code = $1 order by name, id`,
                  [countryCode],
              );
    }

    // Induk yang bukan uuid tidak menemukan baris, sama dengan perbandingan teks sembarang terhadap char(26).
    private children(
        query: string,
        parentColumn: 'province_id' | 'regency_id' | 'district_id',
        parentId: string | null,
    ) {
        const schema =
            parentColumn === 'province_id'
                ? regencyRowSchema
                : parentColumn === 'regency_id'
                  ? districtRowSchema
                  : villageRowSchema;
        return this.db.rows(
            schema,
            `${query} where ${parentColumn} = $1 order by name, id`,
            [parentId === null ? null : lookupId(parentId)],
        );
    }

    // AddressSetupRecords::batch CoreERP: daftar bertahap satu bagian Address setup beserta nama wilayah induknya,
    // dengan pencarian, urutan, dan cursor yang sama dengan daftar lain.
    async divisions(parameters: URLSearchParams) {
        this.workspace.guard('reference-data', 'read');
        const filters = divisionFilters(parameters);
        const { query, bindings } = divisionQuery(filters);
        return incrementalList(this.db, {
            query,
            bindings,
            parameters,
            columns: { code: 'list_code', name: 'list_name' },
            searchColumns: [
                'list_code',
                'list_name',
                'country_name',
                'province_name',
                'regency_name',
                'district_name',
                'village_name',
            ],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
            // Negara berkunci kode ISO, bukan uuid.
            idType: filters.section === 'countries' ? 'text' : 'uuid',
        });
    }

    // Props layar Setup alamat: layar menampilkan aksi ubah hanya bagi pemegang duty Kelola data referensi, sama
    // dengan izin yang diperiksa route tulisnya.
    page() {
        this.workspace.guard('reference-data', 'read');
        return {
            canManage: this.workspace.permissions.has(
                'core.reference-data.update',
            ),
        };
    }

    // Nama tiap tingkat wilayah satu negara, misalnya Provinsi sampai Dusun/Banjar untuk Indonesia. Layar membaca
    // label field alamat dari sini.
    async hierarchyLevels(parameters: URLSearchParams) {
        const countryCode = parameters.get('country_code')?.trim() || null;
        failOn({
            country_code: fieldErrors('country_code', countryCode, [
                { kind: 'required' },
                { kind: 'size', length: 2 },
            ]),
        });
        return {
            data: await this.db.rows(
                hierarchyLevelSchema,
                'select level, level_code, level_name, description from ref_country_hierarchy_levels where country_code = $1 order by level',
                [countryCode!.toUpperCase()],
            ),
        };
    }
}

// Satu query berjoin untuk satu bagian: baris bagian itu, kode dan nama tampilnya, nama setiap wilayah induk, dan
// zona waktu provinsi atau negaranya.
function divisionQuery(filters: DivisionFilters) {
    const section = filters.section;
    const joins: string[] = [];
    let country = 'records';
    let province: string | null = null;
    let regency: string | null = null;
    let district: string | null = null;
    let village: string | null = null;
    const where: string[] = [];
    const bindings: Bind[] = [];
    const bind = (value: Bind) => {
        bindings.push(value);
        return `$${bindings.length}`;
    };

    if (section === 'countries') {
        where.push('records.active = true');
    } else {
        if (section === 'postalCodes') {
            joins.push(
                'left join ref_villages village on village.id = records.village_id',
                'left join ref_districts district on district.id = coalesce(records.district_id, village.district_id)',
                'left join ref_regencies regency on regency.id = coalesce(records.regency_id, district.regency_id)',
                'left join ref_provinces province on province.id = coalesce(records.province_id, regency.province_id)',
                'left join country_regions country on country.code = records.country_code',
            );
            village = 'village';
            district = 'district';
            regency = 'regency';
            province = 'province';
        } else {
            if (section === 'villages') village = 'records';
            if (village !== null) {
                joins.push(
                    `left join ref_districts district on district.id = ${village}.district_id`,
                );
                district = 'district';
            } else if (section === 'districts') district = 'records';
            if (district !== null) {
                joins.push(
                    `left join ref_regencies regency on regency.id = ${district}.regency_id`,
                );
                regency = 'regency';
            } else if (section === 'regencies' || section === 'cities')
                regency = 'records';
            if (regency !== null) {
                joins.push(
                    `left join ref_provinces province on province.id = ${regency}.province_id`,
                );
                province = 'province';
            } else province = 'records';
            joins.push(
                `left join country_regions country on country.code = ${province}.country_code`,
            );
        }
        country = 'country';
    }

    const filterColumns: [keyof DivisionFilters, string | null, string][] = [
        ['country', country, 'code'],
        ['province_id', province, 'id'],
        ['regency_id', regency, 'id'],
        ['district_id', district, 'id'],
        ['village_id', village, 'id'],
    ];
    for (const [filter, alias, column] of filterColumns) {
        const value = filters[filter];
        if (typeof value === 'string' && alias !== null)
            where.push(`${alias}.${column} = ${bind(value)}`);
    }
    if (section === 'postalCodes') where.push('records.tenant_id is null');
    if (
        (section === 'regencies' || section === 'cities') &&
        !filters.include_cities
    ) {
        const city = `(lower(coalesce(records.type, '')) in (${cityTypes.map((type) => bind(type)).join(',')}) or lower(records.name) like 'kota %')`;
        where.push(section === 'cities' ? city : `not ${city}`);
    }

    const code =
        section === 'postalCodes' ? 'records.postal_code' : 'records.code';
    const name =
        section === 'postalCodes' ? 'records.area_name' : 'records.name';
    const names = (
        [
            ['country', country],
            ['province', province],
            ['regency', regency],
            ['district', district],
            ['village', village],
        ] as const
    )
        .map(
            ([label, alias]) =>
                `${alias === null ? 'null' : `${alias}.name`} as ${label}_name`,
        )
        .join(', ');
    const timezone = `coalesce(${province === null ? '' : `${province}.timezone, `}${country}.timezone) as resolved_timezone`;
    return {
        query: `select records.*${section === 'countries' ? ', records.code as id' : ''},
                       ${code} as list_code, ${name} as list_name, ${names}, ${timezone}
                from ${divisionTables[section]} records
                ${joins.join('\n')}
                ${where.length ? `where ${where.join(' and ')}` : ''}`,
        bindings,
    };
}
