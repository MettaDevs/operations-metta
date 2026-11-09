import { z } from 'zod';
import { dateSchema, failOn, laravelBody, lookupId } from '../http/index.ts';

// Kesalahan validasi yang dikumpulkan per field lalu dilempar sekaligus sebagai 422.
export class Problems {
    readonly errors: Record<string, string[]> = {};

    add(field: string, message: string): void {
        (this.errors[field] ??= []).push(message);
    }

    // Kesalahan satu baris rincian party, misalnya `party_details.locations.1.province_id`.
    merge(prefix: string, errors: Record<string, string[]>): void {
        for (const [field, messages] of Object.entries(errors))
            for (const message of messages)
                this.add(`${prefix}.${field}`, message);
    }

    get failed(): boolean {
        return Object.keys(this.errors).length > 0;
    }

    fail(): void {
        failOn(this.errors);
    }
}

export type Fields = Record<string, unknown>;
export const contactTypes = ['email', 'phone', 'whatsapp', 'fax', 'url'];

const text = (value: unknown) => (typeof value === 'string' ? value : null);
const length = (value: string) => [...value].length;

// Aturan `boolean` Laravel.
export function flag(value: unknown): boolean | undefined {
    if (value === true || value === 1 || value === '1') return true;
    if (value === false || value === 0 || value === '0') return false;
    return undefined;
}

export function checkText(
    problems: Problems,
    data: Fields,
    field: string,
    max: number,
    required = false,
): void {
    const value = data[field];
    if (value === null || value === undefined) {
        if (required) problems.add(field, 'Wajib diisi.');
        return;
    }
    if (typeof value !== 'string') problems.add(field, 'Isi dengan teks.');
    else if (length(value) > max)
        problems.add(field, `Paling panjang ${max} karakter.`);
}

export function checkId(problems: Problems, data: Fields, field: string) {
    const value = data[field];
    if (value === null || value === undefined) return;
    if (typeof value !== 'string' || !lookupId(value))
        problems.add(field, 'Pilih dari daftar.');
}

export function checkFlag(problems: Problems, data: Fields, field: string) {
    if (data[field] !== undefined && flag(data[field]) === undefined)
        problems.add(field, 'Pilih ya atau tidak.');
}

export function checkDate(problems: Problems, data: Fields, field: string) {
    const value = data[field];
    if (value === null || value === undefined) return;
    if (typeof value !== 'string' || !dateSchema.safeParse(value).success)
        problems.add(field, 'Isi tanggal dengan bentuk YYYY-MM-DD.');
}

// Kode acuan yang dikenal database, misalnya kegunaan alamat dan negara. Pemanggil membacanya sekali per permintaan.
export type References = {
    purposes: Set<string>;
    countries: Set<string>;
};

// PartyDetailData::location CoreERP, ditambah dusun/banjar, penanda privat, dan masa berlaku tautan. `location_id`
// menautkan tempat yang sudah ada, jadi nama dan negara tidak wajib.
export function checkLocation(input: Fields, references: References) {
    const data: Fields = { ...input };
    if (typeof data.country_region_code === 'string')
        data.country_region_code = data.country_region_code.toUpperCase();
    if (!('purposes' in data) && data.purpose != null)
        data.purposes = [data.purpose];
    const problems = new Problems();
    checkId(problems, data, 'location_id');
    const linking = data.location_id != null;
    checkText(problems, data, 'name', 120, !linking);
    const purposes = data.purposes;
    if (!Array.isArray(purposes) || purposes.length === 0)
        problems.add('purposes', 'Pilih minimal satu kegunaan alamat.');
    else
        purposes.forEach((purpose, index) => {
            if (
                typeof purpose !== 'string' ||
                !references.purposes.has(purpose) ||
                purposes.indexOf(purpose) !== index
            )
                problems.add(
                    `purposes.${index}`,
                    'Pilih kegunaan dari daftar.',
                );
        });
    checkFlag(problems, data, 'is_primary');
    checkFlag(problems, data, 'is_private');
    const country = text(data.country_region_code);
    if (data.country_region_code == null) {
        if (!linking) problems.add('country_region_code', 'Pilih negara.');
    } else if (country === null || !references.countries.has(country))
        problems.add('country_region_code', 'Pilih negara dari daftar.');
    for (const field of ['province', 'city', 'district', 'village'])
        checkText(problems, data, field, 100);
    checkText(problems, data, 'group_of_houses', 200);
    for (const field of ['rt', 'rw']) {
        const value = data[field];
        if (
            value != null &&
            !(typeof value === 'string' && /^[0-9]{1,3}$/.test(value))
        )
            problems.add(field, 'Isi dengan 1 sampai 3 angka.');
    }
    checkText(problems, data, 'street', 250);
    checkText(problems, data, 'building', 120);
    checkText(problems, data, 'postbox', 60);
    checkText(problems, data, 'postal_code', 20);
    for (const field of [
        'province_id',
        'regency_id',
        'district_id',
        'village_id',
        'postal_code_id',
        'group_of_houses_id',
    ])
        checkId(problems, data, field);
    checkDate(problems, data, 'valid_from');
    checkDate(problems, data, 'valid_to');
    if (
        typeof data.valid_from === 'string' &&
        typeof data.valid_to === 'string' &&
        data.valid_to < data.valid_from
    )
        problems.add(
            'valid_to',
            'Tanggal akhir tidak boleh sebelum tanggal mulai.',
        );
    return { data, problems };
}

// PartyDetailData::contact CoreERP.
export function checkContact(data: Fields) {
    const problems = new Problems();
    if (data.type == null) problems.add('type', 'Pilih jenis kontak.');
    else if (typeof data.type !== 'string' || !contactTypes.includes(data.type))
        problems.add('type', 'Pilih jenis kontak dari daftar.');
    checkText(problems, data, 'value', 250, true);
    if (
        data.type === 'email' &&
        typeof data.value === 'string' &&
        !z.email().safeParse(data.value).success
    )
        problems.add('value', 'Isi alamat email yang benar.');
    checkText(problems, data, 'purpose', 30);
    checkFlag(problems, data, 'is_primary');
    checkId(problems, data, 'address_id');
    return { data, problems };
}

export type PartyDetails = {
    locations: (Fields & { key?: string })[];
    contacts: (Fields & { address_key?: string })[];
};

// PartyDetailData::details CoreERP: alamat dan kontak yang ikut disimpan bersama party atau organisasi baru. Kontak
// boleh menunjuk alamat baru di kiriman yang sama lewat `address_key`.
export function checkDetails(
    input: unknown,
    references: References,
): PartyDetails {
    const problems = new Problems();
    const empty = { locations: [], contacts: [] };
    if (input === null || input === undefined) return empty;
    const record = z.record(z.string(), z.unknown()).safeParse(input);
    if (
        !record.success ||
        Array.isArray(input) ||
        Object.keys(record.data).some(
            (key) => key !== 'locations' && key !== 'contacts',
        )
    ) {
        problems.add(
            'party_details',
            'Rincian alamat dan kontak tidak dikenal.',
        );
        problems.fail();
        return empty;
    }
    const list = (field: 'locations' | 'contacts') => {
        const value = record.data[field];
        if (value === undefined || value === null) return [];
        if (!Array.isArray(value) || value.length > 100) {
            problems.add(
                `party_details.${field}`,
                'Isi paling banyak 100 baris.',
            );
            return [];
        }
        return value;
    };
    const keys = new Set<string>();
    const locations = list('locations').map((item, index) => {
        const prefix = `party_details.locations.${index}`;
        const fields = laravelBody.parse(item);
        const { data, problems: rowProblems } = checkLocation(
            fields,
            references,
        );
        const key = text(fields.key);
        if (key !== null) {
            if (length(key) > 80 || keys.has(key))
                rowProblems.add(
                    'key',
                    'Setiap alamat baru harus memiliki penanda yang berbeda.',
                );
            keys.add(key);
        }
        problems.merge(prefix, rowProblems.errors);
        const { key: _, ...rest } = data;
        return key === null ? rest : { ...rest, key };
    });
    const contacts = list('contacts').map((item, index) => {
        const prefix = `party_details.contacts.${index}`;
        const fields = laravelBody.parse(item);
        const { data, problems: rowProblems } = checkContact(fields);
        const key = text(fields.address_key);
        if (key !== null) {
            if (data.address_id != null)
                rowProblems.add(
                    'address_key',
                    'Pilih satu alamat untuk kontak ini.',
                );
            else if (!keys.has(key))
                rowProblems.add(
                    'address_key',
                    'Pilih alamat yang ditambahkan pada form ini.',
                );
        }
        problems.merge(prefix, rowProblems.errors);
        const { address_key: _, ...rest } = data;
        return key === null ? rest : { ...rest, address_key: key };
    });
    problems.fail();
    return { locations, contacts };
}
