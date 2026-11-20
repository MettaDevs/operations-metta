import { z } from 'zod';

type PreferenceDefinition = {
    label: string;
    help?: string;
    options: { value: string; label: string }[];
};

const definitions = z.registry<PreferenceDefinition>();

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
