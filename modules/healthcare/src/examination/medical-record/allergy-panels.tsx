import { DataTableText } from '@operations-metta/ui/data-table';
import { DocumentLines } from '@operations-metta/ui/document-lines';
import { FormControl } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import { Select } from '@operations-metta/ui/select';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { duplicateAllergyMessage } from './medical-record.messages.ts';
import type {
    MedicalRecordDraft,
    MedicalRecordMetadata,
} from './medical-record-panels.tsx';
import { DrugLookup, timeOf } from './order-panels.tsx';

// Daftar alergi pasien di panel Riwayat penyakit dan alergi. Alergi milik pasien, jadi terbawa ke pemeriksaan
// berikutnya. Jenis dan alergen baris yang sudah disimpan hanya dibaca; reaksi dan statusnya tetap bisa diubah.

type Draft = MedicalRecordDraft;
type SetDraft = (update: (draft: Draft) => Draft) => void;
type Allergy = NonNullable<Draft['allergy']>['items'][number];
type Category = NonNullable<Allergy['category']>;
type Status = Allergy['status'];
type Errors = Record<string, string[]>;

const categories = [
    { value: 'makanan', label: 'Makanan' },
    { value: 'udara', label: 'Udara' },
    { value: 'obat', label: 'Obat' },
    { value: 'lainnya', label: 'Lainnya' },
] as const satisfies readonly { value: Category; label: string }[];

const statuses = [
    { value: 'aktif', label: 'Aktif' },
    { value: 'tidak_aktif', label: 'Tidak aktif' },
    { value: 'sembuh', label: 'Sembuh' },
] as const satisfies readonly { value: Status; label: string }[];

const blankAllergy: Allergy = {
    id: null,
    category: null,
    allergen_id: null,
    allergen_name: null,
    drug_id: null,
    drug_code: null,
    drug_name: null,
    name: null,
    reaction: null,
    status: 'aktif',
    recorded_at: null,
    recorded_by: null,
};

const noAllergen = {
    allergen_id: null,
    allergen_name: null,
    drug_id: null,
    drug_code: null,
    drug_name: null,
    name: null,
} satisfies Partial<Allergy>;

// Kunci alergen ganda, sama dengan pemeriksaan server. Alergi lainnya tidak punya kunci.
const keyOf = (row: Allergy) =>
    row.drug_id
        ? `obat:${row.drug_id}`
        : row.allergen_id
          ? `${row.category ?? ''}:${row.allergen_id}`
          : null;

function allergenLabel(row: Allergy): string {
    if (row.drug_id)
        return row.drug_code
            ? `${row.drug_code} - ${row.drug_name ?? ''}`
            : (row.drug_name ?? '');
    if (row.category === 'obat' && row.allergen_name)
        return `Golongan ${row.allergen_name}`;
    return row.allergen_name ?? row.name ?? '';
}

export function AllergyLines({
    rows,
    setDraft,
    metadata,
    canCreate,
    errors,
    disabled,
}: {
    rows: Allergy[];
    setDraft: SetDraft;
    metadata: MedicalRecordMetadata;
    canCreate: boolean;
    errors: Errors;
    disabled: boolean;
}): ReactNode {
    const [selected, setSelected] = useState<number[]>([]);
    const lines = rows.map((row, index) => ({ index, row }));
    const field = (index: number, name: keyof Allergy) =>
        `allergy.items.${index}.${name}`;
    const error = (index: number, name: keyof Allergy) =>
        errors[field(index, name)]?.join(' ');
    const setItems = (next: (items: Allergy[]) => Allergy[]) =>
        setDraft((current) =>
            current.allergy
                ? {
                      ...current,
                      allergy: {
                          ...current.allergy,
                          items: next(current.allergy.items),
                      },
                  }
                : current,
        );
    const change = (index: number, values: Partial<Allergy>) =>
        setItems((items) =>
            items.map((row, at) =>
                at === index ? { ...row, ...values } : row,
            ),
        );
    // Alergen yang sudah ada di daftar ditolak saat dipilih, seperti obat ganda di resep.
    const pick = (index: number, values: Partial<Allergy>, label: string) => {
        const key = keyOf({ ...(rows[index] ?? blankAllergy), ...values });
        if (key && rows.some((row, at) => at !== index && keyOf(row) === key)) {
            toast.error(duplicateAllergyMessage(label));
            return;
        }
        change(index, values);
    };
    const allergenChoices = (category: 'makanan' | 'udara' | 'obat') =>
        (category === 'makanan'
            ? metadata.allergies.food
            : category === 'udara'
              ? metadata.allergies.airborne
              : metadata.allergies.drug_classes
        ).map((row) => ({ value: row.id, label: row.name }));
    const pickAllergen = (
        index: number,
        category: 'makanan' | 'udara' | 'obat',
        value: string | null,
    ) => {
        const choice = allergenChoices(category).find(
            (item) => item.value === value,
        );
        if (choice)
            pick(
                index,
                {
                    ...noAllergen,
                    allergen_id: choice.value,
                    allergen_name: choice.label,
                },
                choice.label,
            );
    };
    // Golongan obat adalah pilihan kedua di samping obat tertentu, jadi tidak wajib.
    const allergenSelect = (
        index: number,
        row: Allergy,
        category: 'makanan' | 'udara' | 'obat',
    ) => (
        <FormControl
            error={error(index, 'allergen_id')}
            data-error-field={field(index, 'allergen_id')}
        >
            <Select
                label={category === 'obat' ? 'Atau golongan obat' : 'Alergen'}
                placeholder={
                    category === 'obat'
                        ? 'Pilih golongan obat'
                        : 'Pilih alergen'
                }
                required={category !== 'obat'}
                items={allergenChoices(category)}
                value={row.allergen_id}
                onValueChange={(value) => pickAllergen(index, category, value)}
            />
        </FormControl>
    );
    const allergenControl = (index: number, row: Allergy): ReactNode => {
        switch (row.category) {
            case null:
                return <DataTableText>{''}</DataTableText>;
            case 'makanan':
            case 'udara':
                return allergenSelect(index, row, row.category);
            case 'obat':
                return (
                    <div className="space-y-2">
                        <DrugLookup
                            field={field(index, 'drug_id')}
                            required={false}
                            value={
                                row.drug_id
                                    ? {
                                          id: row.drug_id,
                                          code: row.drug_code,
                                          name: row.drug_name ?? '',
                                      }
                                    : null
                            }
                            canCreate={canCreate}
                            error={error(index, 'drug_id')}
                            onPick={(drug) =>
                                pick(
                                    index,
                                    {
                                        ...noAllergen,
                                        drug_id: drug.id,
                                        drug_code: drug.code,
                                        drug_name: drug.name,
                                    },
                                    drug.name,
                                )
                            }
                        />
                        {allergenSelect(index, row, 'obat')}
                    </div>
                );
            case 'lainnya':
                return (
                    <FormControl error={error(index, 'name')}>
                        <Input
                            id={field(index, 'name')}
                            data-error-field={field(index, 'name')}
                            label="Nama alergi"
                            required
                            maxLength={500}
                            value={row.name ?? ''}
                            onChange={(event) =>
                                change(index, {
                                    name: event.target.value || null,
                                })
                            }
                        />
                    </FormControl>
                );
            default: {
                const unknown: never = row.category;
                throw new Error(`Unknown allergy category ${String(unknown)}`);
            }
        }
    };
    return (
        <DocumentLines
            title="Alergi pasien"
            data={lines}
            getRowKey={(line) => line.index}
            getRowLabel={(line) =>
                allergenLabel(line.row) || `Alergi ${line.index + 1}`
            }
            showRowNumbers
            readOnly={disabled}
            disabled={disabled}
            selection={
                disabled
                    ? undefined
                    : {
                          selectedKeys: selected,
                          onSelectedKeysChange: (keys) =>
                              setSelected(keys.map(Number)),
                      }
            }
            onAddRow={() => setItems((items) => [...items, blankAllergy])}
            onDeleteRows={(removed) =>
                setItems((items) =>
                    items.filter(
                        (_, at) => !removed.some((line) => line.index === at),
                    ),
                )
            }
            emptyMessage={
                disabled
                    ? 'Belum ada alergi.'
                    : 'Belum ada alergi. Pilih Tambah untuk menambahkan alergi.'
            }
            columns={[
                {
                    id: 'category',
                    header: 'Jenis',
                    content: disabled ? 'text' : 'control',
                    minWidth: 130,
                    cell: ({ index, row }) =>
                        disabled || row.id ? (
                            <DataTableText>
                                {categories.find(
                                    (item) => item.value === row.category,
                                )?.label ?? ''}
                            </DataTableText>
                        ) : (
                            <FormControl
                                error={error(index, 'category')}
                                data-error-field={field(index, 'category')}
                            >
                                <Select
                                    label="Jenis"
                                    placeholder="Pilih jenis"
                                    required
                                    items={[...categories]}
                                    value={row.category}
                                    onValueChange={(value) =>
                                        change(index, {
                                            ...noAllergen,
                                            category:
                                                categories.find(
                                                    (item) =>
                                                        item.value === value,
                                                )?.value ?? null,
                                        })
                                    }
                                />
                            </FormControl>
                        ),
                },
                {
                    id: 'allergen',
                    header: 'Alergen',
                    content: disabled ? 'text' : 'control',
                    minWidth: 300,
                    cell: ({ index, row }) =>
                        disabled || row.id ? (
                            <DataTableText>{allergenLabel(row)}</DataTableText>
                        ) : (
                            allergenControl(index, row)
                        ),
                },
                {
                    id: 'reaction',
                    header: 'Reaksi',
                    content: disabled ? 'text' : 'control',
                    minWidth: 220,
                    cell: ({ index, row }) =>
                        disabled ? (
                            <DataTableText>{row.reaction ?? ''}</DataTableText>
                        ) : (
                            <FormControl error={error(index, 'reaction')}>
                                <Input
                                    id={field(index, 'reaction')}
                                    data-error-field={field(index, 'reaction')}
                                    label="Reaksi"
                                    maxLength={500}
                                    value={row.reaction ?? ''}
                                    onChange={(event) =>
                                        change(index, {
                                            reaction:
                                                event.target.value || null,
                                        })
                                    }
                                />
                            </FormControl>
                        ),
                },
                {
                    id: 'status',
                    header: 'Status',
                    content: disabled ? 'text' : 'control',
                    minWidth: 140,
                    cell: ({ index, row }) =>
                        disabled ? (
                            <DataTableText>
                                {statuses.find(
                                    (item) => item.value === row.status,
                                )?.label ?? ''}
                            </DataTableText>
                        ) : (
                            <FormControl
                                error={error(index, 'status')}
                                data-error-field={field(index, 'status')}
                            >
                                <Select
                                    label="Status"
                                    required
                                    items={[...statuses]}
                                    value={row.status}
                                    onValueChange={(value) => {
                                        const status = statuses.find(
                                            (item) => item.value === value,
                                        )?.value;
                                        if (status) change(index, { status });
                                    }}
                                />
                            </FormControl>
                        ),
                },
                {
                    id: 'recorded',
                    header: 'Dicatat',
                    content: 'text',
                    minWidth: 190,
                    cell: ({ row }) => (
                        <DataTableText>
                            {row.recorded_at
                                ? `${timeOf(row.recorded_at)} · ${row.recorded_by ?? ''}`
                                : ''}
                        </DataTableText>
                    ),
                },
            ]}
        />
    );
}
