import { z } from 'zod';
import {
    failOn,
    laravelBody,
    listParametersSchema,
    lookupId,
    nullableText,
    validation,
} from '../http/index.ts';

// Satu dusun/banjar milik tenant, dengan nama wilayah di atasnya supaya layar tidak meminta ulang.
export const groupOfHousesRowSchema = z.object({
    id: z.string(),
    tenant_id: z.string(),
    village_id: z.string(),
    code: nullableText,
    name: z.string(),
    active: z.boolean(),
    postal_code: nullableText,
    override_postal_code: z.boolean(),
    village_name: z.string(),
    district_name: z.string(),
    regency_name: z.string(),
    province_name: z.string(),
    created_at: nullableText,
    updated_at: nullableText,
    version: z.number(),
});
export type GroupOfHousesRow = z.infer<typeof groupOfHousesRowSchema>;

export const groupOfHousesQuerySchema = listParametersSchema.extend({
    village_id: z.string().optional(),
});

const flag = (field: string, value: unknown, fallback: boolean): boolean => {
    if (value === null || value === undefined) return fallback;
    if (value === true || value === 1 || value === '1') return true;
    if (value === false || value === 0 || value === '0') return false;
    return validation({ [field]: 'Pilih ya atau tidak.' });
};

const text = (value: unknown) => (typeof value === 'string' ? value : null);
const longer = (value: string | null, length: number) =>
    value !== null && [...value].length > length;

// Kiriman simpan dusun/banjar. Desa wajib dipilih dari master wilayah, nama wajib, dan kode boleh kosong: master
// sekecil ini tidak memakai number sequence (aturan "Kode dan nomor dokumen"). Kode pos mengikuti desanya, kecuali
// pengguna sengaja mengisi kode pos sendiri (storeGroupOfHouses CoreERP).
export const saveGroupOfHousesSchema = laravelBody.transform((input) => {
    const villageId = text(input.village_id);
    const name = text(input.name);
    const code = text(input.code);
    const postalCode = text(input.postal_code);
    failOn({
        village_id:
            input.village_id == null
                ? ['Pilih desa/kelurahan.']
                : villageId === null || !lookupId(villageId)
                  ? ['Pilih desa/kelurahan dari daftar.']
                  : [],
        name:
            name === null
                ? ['Isi nama.']
                : longer(name, 200)
                  ? ['Nama paling panjang 200 karakter.']
                  : [],
        code:
            input.code != null && code === null
                ? ['Kode berupa teks.']
                : longer(code, 30)
                  ? ['Kode paling panjang 30 karakter.']
                  : [],
        postal_code:
            input.postal_code != null &&
            (postalCode === null || !/^[0-9]{5}$/.test(postalCode))
                ? ['Kode pos berisi 5 angka.']
                : [],
    });
    const override = flag(
        'override_postal_code',
        input.override_postal_code,
        false,
    );
    return {
        village_id: villageId!,
        name: name!,
        code,
        active: flag('active', input.active, true),
        // Kode pos sendiri hanya berlaku bila memang diisi.
        override_postal_code: override && postalCode !== null,
        postal_code: override ? postalCode : null,
    };
});
export type SaveGroupOfHouses = z.output<typeof saveGroupOfHousesSchema>;
