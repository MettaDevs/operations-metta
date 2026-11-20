import { z } from 'zod';

type PreferenceDefinition = {
    label: string;
    help?: string;
    options: { value: string; label: string }[];
};

const definitions = z.registry<PreferenceDefinition>();

// Nilai yang tersimpan tetapi tidak ada di pilihan, misalnya pilihan yang sudah dihapus, dibaca sebagai bawaannya.
function choice<const Value extends string>(definition: {
    label: string;
    help?: string;
    options: readonly { value: Value; label: string }[];
    default: NoInfer<Value>;
}) {
    const schema = z
        .enum(definition.options.map((option) => option.value))
        .catch(definition.default);
    definitions.add(schema, {
        label: definition.label,
        help: definition.help,
        options: [...definition.options],
    });
    return schema;
}

// Setelan pribadi per pengguna, padanan My Settings BC. Ini satu-satunya daftar setelan: validasi, nilai bawaan, data
// Shell, dan layar Setelan dibaca dari sini. Setiap setelan sampai ke peramban sebagai atribut `data-<kunci>` pada
// <html> (garis bawah menjadi tanda hubung), jadi setelan tampilan cukup ditambah di sini dan di CSS pemakainya.
const preferenceFields = z.object({
    dialog_layout: choice({
        label: 'Tampilan modal',
        help: 'Compact memberi jarak di atas dan bawah kartu data, dengan tombol data sebelumnya dan berikutnya di luar kartu. Full membuat kartu setinggi area kerja, dengan tombol itu di tepi kartu.',
        options: [
            { value: 'compact', label: 'Compact' },
            { value: 'full', label: 'Full' },
        ],
        default: 'compact',
    }),
});

export type Preferences = z.infer<typeof preferenceFields>;
export const preferenceKeySchema = preferenceFields.keyof();
export type PreferenceKey = z.infer<typeof preferenceKeySchema>;

// Isi kolom users.preferences, apa pun bentuknya, menjadi setiap setelan dengan nilainya.
export const preferencesSchema = z
    .record(z.string(), z.unknown())
    .catch({})
    .pipe(preferenceFields);

export function preferenceValueSchema(key: PreferenceKey) {
    return preferenceFields.shape[key].unwrap();
}

export function preferenceDefinitions() {
    return preferenceKeySchema.options.map((key) => {
        const definition = definitions.get(preferenceFields.shape[key]);
        if (!definition)
            throw new Error(`Preference ${key} has no definition.`);
        return { key, ...definition };
    });
}
