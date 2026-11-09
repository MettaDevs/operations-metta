import { z } from 'zod';
import {
    listParametersSchema,
    nullableText,
    validation,
} from '../http/index.ts';

// Tipe operating unit dari config `coreerp.operating_unit_types` CoreERP: kode beserta labelnya di layar.
export const operatingUnitTypes = {
    business_unit: 'Business unit',
    department: 'Department',
    cost_center: 'Cost center',
    value_stream: 'Value stream',
    retail_channel: 'Retail channel',
} as const;
const unitTypeCodes = Object.keys(operatingUnitTypes);
// Tipe yang wajib punya kode unit, karena kode itulah yang dikirim ke finance sebagai nilai dimensi.
const numberedUnitTypes = ['business_unit', 'department'];
const unitNumberLength = 30;
const unitNumberFormat = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;
const companyCodeFormat = /^[A-Za-z0-9][A-Za-z0-9-]{1,15}$/;
export const timezones = [
    ...new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']),
];

export const legalEntitySchema = z.object({
    organization_id: z.string(),
    company_code: z.string(),
    country_code: z.string(),
    created_at: nullableText,
    updated_at: nullableText,
    tenant_id: nullableText,
    fiscal_calendar_id: nullableText,
    created_by_user_id: nullableText,
    updated_by_user_id: nullableText,
    timezone: z.string(),
    version: z.number(),
});
export const operatingUnitSchema = z.object({
    organization_id: z.string(),
    type: z.string(),
    created_at: nullableText,
    updated_at: nullableText,
    tenant_id: nullableText,
    number: nullableText,
    created_by_user_id: nullableText,
    updated_by_user_id: nullableText,
    version: z.number(),
});
export const organizationRowSchema = z.object({
    id: z.string(),
    tenant_id: z.string(),
    name: z.string(),
    classification: z.enum(['legal_entity', 'operating_unit']),
    status: z.string(),
    created_at: nullableText,
    updated_at: nullableText,
    created_by_user_id: nullableText,
    updated_by_user_id: nullableText,
    version: z.number(),
    legal_entity: legalEntitySchema.nullable(),
    operating_unit: operatingUnitSchema.nullable(),
});
export type OrganizationRow = z.infer<typeof organizationRowSchema>;

// Middleware TrimStrings dan ConvertEmptyStringsToNull Laravel berjalan sebelum setiap validasi CoreERP: teks
// dirapikan spasinya di ujung, lalu teks kosong menjadi null.
function laravelInput(value: unknown): unknown {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed === '' ? null : trimmed;
    }
    if (Array.isArray(value)) return value.map(laravelInput);
    if (value && typeof value === 'object')
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
                key,
                laravelInput(item),
            ]),
        );
    return value;
}

type Rule =
    | { kind: 'required'; when?: boolean; message?: string }
    | { kind: 'prohibited'; when: boolean; message: string }
    | { kind: 'string' }
    | { kind: 'max'; length: number }
    | { kind: 'size'; length: number }
    | { kind: 'regex'; pattern: RegExp; message?: string }
    | { kind: 'in'; values: readonly string[]; message?: string };

// Pesan galat satu field dengan urutan dan bunyi validator Laravel. Aturan wajib dan larangan yang gagal
// menghentikan pemeriksaan field itu; aturan lain dilewati selama nilainya kosong.
export function fieldErrors(
    field: string,
    value: unknown,
    rules: Rule[],
): string[] {
    const attribute = field.replaceAll('_', ' ');
    const errors: string[] = [];
    const empty = value === null || value === undefined;
    for (const rule of rules) {
        switch (rule.kind) {
            case 'required':
                if ((rule.when ?? true) && empty)
                    return [
                        rule.message ?? `The ${attribute} field is required.`,
                    ];
                break;
            case 'prohibited':
                if (rule.when && !empty) return [rule.message];
                break;
            case 'string':
                if (!empty && typeof value !== 'string')
                    return [`The ${attribute} field must be a string.`];
                break;
            case 'max':
                if (
                    typeof value === 'string' &&
                    [...value].length > rule.length
                )
                    errors.push(
                        `The ${attribute} field must not be greater than ${rule.length} characters.`,
                    );
                break;
            case 'size':
                if (
                    typeof value === 'string' &&
                    [...value].length !== rule.length
                )
                    errors.push(
                        `The ${attribute} field must be ${rule.length} characters.`,
                    );
                break;
            case 'regex':
                if (typeof value === 'string' && !rule.pattern.test(value))
                    errors.push(
                        rule.message ??
                            `The ${attribute} field format is invalid.`,
                    );
                break;
            case 'in':
                if (
                    !empty &&
                    !(typeof value === 'string' && rule.values.includes(value))
                )
                    errors.push(
                        rule.message ?? `The selected ${attribute} is invalid.`,
                    );
                break;
            default: {
                const unknown: never = rule;
                throw new Error(`Unknown rule ${JSON.stringify(unknown)}`);
            }
        }
    }
    return errors;
}

export function failOn(errors: Record<string, string[]>): void {
    const failed = Object.fromEntries(
        Object.entries(errors).filter(([, messages]) => messages.length),
    );
    if (Object.keys(failed).length) validation(failed);
}

const record = z.record(z.string(), z.unknown());

// Kiriman yang bukan objek dibaca sebagai kiriman kosong, sama dengan request Laravel tanpa body.
export const laravelBody = z.unknown().transform((raw) => {
    const input = laravelInput(raw);
    const parsed = record.safeParse(input);
    return parsed.success && !Array.isArray(input) ? parsed.data : {};
});
const unitNumberRules = (prohibited: boolean, required: boolean): Rule[] => [
    {
        kind: 'prohibited',
        when: prohibited,
        message: 'Kode unit hanya untuk operating unit.',
    },
    {
        kind: 'required',
        when: required,
        message: 'Isi kode unit untuk Business unit atau Department.',
    },
    { kind: 'string' },
    { kind: 'max', length: unitNumberLength },
    {
        kind: 'regex',
        pattern: unitNumberFormat,
        message:
            'Kode unit hanya boleh huruf besar, angka, dan tanda hubung, tanpa spasi.',
    },
];
const timezoneRules = (prohibited: boolean): Rule[] => [
    {
        kind: 'prohibited',
        when: prohibited,
        message: 'Zona waktu hanya untuk entitas legal.',
    },
    { kind: 'string' },
    {
        kind: 'in',
        values: timezones,
        message: 'Pilih zona waktu dari daftar.',
    },
];
const companyCodeRules = (required: boolean): Rule[] => [
    { kind: 'required', when: required },
    { kind: 'string' },
    { kind: 'regex', pattern: companyCodeFormat },
];
const countryCodeRules = (required: boolean): Rule[] => [
    { kind: 'required', when: required },
    { kind: 'string' },
    { kind: 'size', length: 2 },
];
const nameRules: Rule[] = [
    { kind: 'required' },
    { kind: 'string' },
    { kind: 'max', length: 150 },
];

// Nomor unit dirapikan sebelum divalidasi: huruf kecil dan spasi di ujung adalah salah ketik yang wajar, bukan
// niat. Spasi di tengah tetap ditolak, karena maksudnya tidak bisa ditebak.
function withUnitNumber(input: Record<string, unknown>) {
    const number = input.operating_unit_number;
    return typeof number === 'string'
        ? { ...input, operating_unit_number: number.toUpperCase() }
        : input;
}

const text = (value: unknown) => (typeof value === 'string' ? value : null);

// OrganizationRequest CoreERP.
export const createOrganizationSchema = laravelBody
    .transform(withUnitNumber)
    .transform((input) => {
        // Alamat dan kontak tersimpan sebagai party di buku alamat, yang belum pindah ke repo ini. Kirimannya
        // ditolak supaya tidak hilang diam-diam.
        if (input.party_details != null)
            validation({
                party_details:
                    'Alamat dan kontak belum dapat disimpan bersama organisasi.',
            });
        const legalEntity = input.classification === 'legal_entity';
        const operatingUnit = input.classification === 'operating_unit';
        failOn({
            classification: fieldErrors(
                'classification',
                input.classification,
                [
                    { kind: 'required' },
                    { kind: 'in', values: ['legal_entity', 'operating_unit'] },
                ],
            ),
            name: fieldErrors('name', input.name, nameRules),
            company_code: fieldErrors(
                'company_code',
                input.company_code,
                companyCodeRules(legalEntity),
            ),
            country_code: fieldErrors(
                'country_code',
                input.country_code,
                countryCodeRules(legalEntity),
            ),
            timezone: fieldErrors(
                'timezone',
                input.timezone,
                timezoneRules(operatingUnit),
            ),
            operating_unit_type: fieldErrors(
                'operating_unit_type',
                input.operating_unit_type,
                [
                    { kind: 'required', when: operatingUnit },
                    { kind: 'in', values: unitTypeCodes },
                ],
            ),
            operating_unit_number: fieldErrors(
                'operating_unit_number',
                input.operating_unit_number,
                unitNumberRules(
                    legalEntity,
                    operatingUnit &&
                        numberedUnitTypes.includes(
                            String(input.operating_unit_type),
                        ),
                ),
            ),
        });
        return {
            classification: legalEntity
                ? ('legal_entity' as const)
                : ('operating_unit' as const),
            name: String(input.name),
            company_code: legalEntity
                ? (text(input.company_code)?.toUpperCase() ?? null)
                : null,
            country_code: legalEntity ? text(input.country_code) : null,
            timezone: legalEntity ? text(input.timezone) : null,
            operating_unit_type: legalEntity
                ? null
                : text(input.operating_unit_type),
            operating_unit_number: legalEntity
                ? null
                : text(input.operating_unit_number),
        };
    });

// UpdateOrganizationRequest CoreERP. Aturannya bergantung pada klasifikasi yang tersimpan, karena klasifikasi
// organisasi tidak bisa diubah.
export function updateOrganizationSchema(organization: OrganizationRow) {
    const legalEntity = organization.classification === 'legal_entity';
    const operatingUnit = organization.classification === 'operating_unit';
    return laravelBody.transform(withUnitNumber).transform((input) => {
        // Identitas cetak (kop, footer, logo) belum pindah ke repo ini.
        if (input.print_identity != null)
            validation({
                print_identity: 'Identitas cetak belum dapat diubah dari sini.',
            });
        const hasNumber = 'operating_unit_number' in input;
        failOn({
            name: fieldErrors('name', input.name, nameRules),
            company_code: fieldErrors(
                'company_code',
                input.company_code,
                companyCodeRules(legalEntity),
            ),
            country_code: fieldErrors(
                'country_code',
                input.country_code,
                countryCodeRules(legalEntity),
            ),
            timezone: fieldErrors(
                'timezone',
                input.timezone,
                timezoneRules(!legalEntity),
            ),
            operating_unit_type: fieldErrors(
                'operating_unit_type',
                input.operating_unit_type,
                [
                    { kind: 'required', when: operatingUnit },
                    { kind: 'in', values: unitTypeCodes },
                ],
            ),
            operating_unit_number: fieldErrors(
                'operating_unit_number',
                input.operating_unit_number,
                unitNumberRules(
                    legalEntity,
                    operatingUnit &&
                        numberedUnitTypes.includes(
                            String(input.operating_unit_type),
                        ) &&
                        (hasNumber || !organization.operating_unit?.number),
                ),
            ),
        });
        return {
            name: String(input.name),
            // Mentah untuk aturan unik, yang di CoreERP membandingkan kiriman sebelum dijadikan huruf besar.
            submitted_company_code: text(input.company_code),
            company_code: text(input.company_code)?.toUpperCase() ?? null,
            country_code: text(input.country_code)?.toUpperCase() ?? null,
            timezone: text(input.timezone),
            operating_unit_type: text(input.operating_unit_type),
            // Pemanggil yang tidak mengirim nomor unit, misalnya form yang hanya mengubah nama, tidak boleh
            // menghapus nomor yang sudah ada: nomor itu sudah tersimpan di tabel penerjemah finance.
            ...(hasNumber
                ? {
                      operating_unit_number: text(input.operating_unit_number),
                  }
                : {}),
        };
    });
}

// Query layar organisasi (`GET /api/v1/settings/...`): tanpa `incremental`, jawabannya props halaman; dengan
// `incremental=1`, satu batch daftar. Pemeriksaannya di route, dengan pesan Laravel CoreERP.
export const organizationPageQuerySchema = listParametersSchema.extend({
    incremental: z.literal('1').optional(),
    resource: z.enum(['organizations', 'hierarchies']).optional(),
    exclude_version_id: z.string().optional(),
});
