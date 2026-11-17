import { Button } from '@operations-metta/ui/button';
import type { DataTableColumn } from '@operations-metta/ui/data-table';
import { DataTableText } from '@operations-metta/ui/data-table';
import { displayDate } from '@operations-metta/ui/date-picker';
import { displayNumber } from '@operations-metta/ui/display-number';
import { DocumentLines } from '@operations-metta/ui/document-lines';
import { FormControl } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import type { Reference } from '@operations-metta/ui/master-lookup';
import { Select } from '@operations-metta/ui/select';
import { useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import {
    BatchLookup,
    type PickedBatch,
} from '../service-location/pharmacy-lookups.tsx';
import {
    compoundText,
    instructionText,
    isCompoundHeader,
    type Prescription,
    type PrescriptionLine,
} from '../prescription/prescription-facts.tsx';
import { SubstituteDialog } from './substitute-dialog.tsx';

export type Taken = {
    batch_number: string | null;
    expiry_date: string | null;
    quantity: string;
};

export type UnitOption = Reference & { quantity_per_unit: string };

export const substitutionConsents = [
    'dokter',
    'pasien',
    'dokter_dan_pasien',
] as const;
export type SubstitutionConsent = (typeof substitutionConsents)[number];

export const consentLabels = {
    dokter: 'Dokter',
    pasien: 'Pasien',
    dokter_dan_pasien: 'Dokter dan pasien',
} as const satisfies Record<SubstitutionConsent, string>;

// Obat yang boleh diserahkan untuk satu baris resep: obat resep dan obat penggantinya, masing-masing dengan satuannya.
export type ItemOption = {
    item: Reference;
    is_prescribed: boolean;
    notes: string | null;
    units: UnitOption[];
};

// Penggantian obat resep pada baris ini. by dan at kosong sampai penggantiannya tersimpan.
export type LineSubstitution = {
    consent: SubstitutionConsent;
    reason: string;
    by: string | null;
    at: string | null;
};

// Harga yang disalin ke baris saat disiapkan; kosong selama belum disiapkan. computed_* adalah hitungan sistem, dan
// changed mencatat siapa yang mengubah harganya dan alasannya.
export type LinePrice = {
    unit_price: string;
    discount_percent: string;
    amount: string;
    computed_unit_price: string;
    computed_discount_percent: string;
    changed: { by: string; at: string; reason: string } | null;
};

// Nilai yang dipakai, dengan hitungan sistem di bawahnya bila harga baris itu diubah.
function PriceText({
    value,
    computed,
    changed,
}: {
    value: string;
    computed: string;
    changed: LinePrice['changed'];
}): ReactNode {
    return (
        <DataTableText multiline>
            <span className="block tabular-nums">{displayNumber(value)}</span>
            {changed && value !== computed && (
                <span
                    className="block text-xs text-muted-foreground tabular-nums"
                    title={`Diubah ${changed.by}: ${changed.reason}`}
                >
                    {`Sistem ${displayNumber(computed)}`}
                </span>
            )}
        </DataTableText>
    );
}

// Isian satu obat resep. Jumlah disimpan sebagai teks yang tampil di isian (12,5) dan baru diubah ke angka API saat
// dikirim.
export type LineDraft = {
    prescriptionLineId: string;
    item: Reference;
    units: UnitOption[];
    substitution: LineSubstitution | null;
    quantity: string;
    unit: UnitOption;
    batch: PickedBatch | null;
    reason: string;
    taken: Taken[];
    price: LinePrice | null;
};

type Row = {
    line: PrescriptionLine;
    // Urutan baris obat di antara baris obat saja, sama dengan indeks `lines.N` pada pesan kesalahan server.
    index: number | null;
    draft: LineDraft | null;
};

const unitLabel = (unit: UnitOption) =>
    `${unit.code} · isi ${displayNumber(unit.quantity_per_unit)}`;

// Satu baris per batch yang diambil, supaya batch kedua tidak terpotong di kolom yang sempit.
function TakenBatches({
    taken,
    baseCode,
}: {
    taken: Taken[];
    baseCode: string;
}): ReactNode {
    if (!taken.length) return <DataTableText>—</DataTableText>;
    return (
        <DataTableText multiline>
            {taken.map((part, at) => (
                <span key={at} className="block tabular-nums">
                    {`${part.batch_number ?? 'Tanpa batch'}${part.expiry_date ? ` · ED ${displayDate(part.expiry_date)}` : ''} · ${displayNumber(part.quantity)} ${baseCode}`}
                </span>
            ))}
        </DataTableText>
    );
}

// Baris penyerahan di bawah baris resepnya. Kepala racikan tampil sebagai pengelompok; komponennya adalah obat yang
// disiapkan seperti obat tunggal.
export function DispensingLines({
    prescription,
    lines,
    onChange,
    editing,
    prepared,
    errors,
    stock,
    options,
    canSubstitute,
    locationId,
    portalContainer,
}: {
    prescription: Prescription;
    lines: LineDraft[];
    onChange: (lines: LineDraft[]) => void;
    editing: boolean;
    prepared: boolean;
    errors: Record<string, string[]>;
    stock: Map<string, string>;
    options: Map<string, ItemOption[]>;
    canSubstitute: boolean;
    locationId: string | null;
    portalContainer: RefObject<HTMLElement | null>;
}): ReactNode {
    const [substituting, setSubstituting] = useState<string | null>(null);
    const content = editing ? 'control' : 'text';
    const field = (index: number, name: string) => `lines.${index}.${name}`;
    const error = (index: number | null, name: string) =>
        index === null ? undefined : errors[field(index, name)]?.[0];
    const byLine = new Map(
        lines.map((line) => [line.prescriptionLineId, line]),
    );
    let position = 0;
    const rows: Row[] = prescription.lines.map((line) => {
        if (isCompoundHeader(line)) return { line, index: null, draft: null };
        const index = position++;
        return { line, index, draft: byLine.get(line.id) ?? null };
    });
    const update = (prescriptionLineId: string, change: Partial<LineDraft>) =>
        onChange(
            lines.map((line) =>
                line.prescriptionLineId === prescriptionLineId
                    ? { ...line, ...change }
                    : line,
            ),
        );
    const text = (value: string) => <DataTableText>{value}</DataTableText>;
    const baseCode = (draft: LineDraft | null) => draft?.units[0]?.code ?? '';
    const choices = (draft: LineDraft): UnitOption[] =>
        draft.units.some((unit) => unit.id === draft.unit.id)
            ? draft.units
            : [draft.unit, ...draft.units];
    const itemOptions = (draft: LineDraft): ItemOption[] => {
        const listed = options.get(draft.prescriptionLineId) ?? [];
        return !listed.length ||
            listed.some((option) => option.item.id === draft.item.id)
            ? listed
            : [
                  ...listed,
                  {
                      item: draft.item,
                      is_prescribed: false,
                      notes: null,
                      units: draft.units,
                  },
              ];
    };
    const open = substituting
        ? lines.find((line) => line.prescriptionLineId === substituting)
        : undefined;
    const openLine = open
        ? prescription.lines.find((line) => line.id === open.prescriptionLineId)
        : undefined;

    const columns: DataTableColumn<Row>[] = [
        {
            id: 'item',
            header: 'Obat',
            minWidth: 260,
            cell: ({ line, draft, index }) =>
                isCompoundHeader(line) ? (
                    <DataTableText multiline>
                        <span className="block font-medium">
                            {compoundText(line)}
                        </span>
                        {instructionText(line) && (
                            <span className="block text-muted-foreground">
                                {instructionText(line)}
                            </span>
                        )}
                    </DataTableText>
                ) : (
                    <DataTableText multiline>
                        <span
                            className={
                                line.compound !== null ? 'block ps-4' : 'block'
                            }
                        >
                            {`${line.item?.code ?? ''} · ${line.item?.name ?? ''}`}
                        </span>
                        {draft?.substitution && (
                            <SubstitutionText
                                draft={draft}
                                indented={line.compound !== null}
                            />
                        )}
                        {index !== null &&
                            [
                                'item_id',
                                'substitution_consent',
                                'substitution_reason',
                            ]
                                .map((name) => error(index, name))
                                .filter(Boolean)
                                .map((message) => (
                                    <span
                                        key={message}
                                        role="alert"
                                        data-error-field={field(
                                            index,
                                            'item_id',
                                        )}
                                        className="block text-xs text-destructive"
                                    >
                                        {message}
                                    </span>
                                ))}
                        {editing &&
                            canSubstitute &&
                            draft &&
                            itemOptions(draft).length > 1 && (
                                <Button
                                    type="button"
                                    variant="link"
                                    size="sm"
                                    className={
                                        line.compound !== null
                                            ? 'h-auto py-0 ps-4'
                                            : 'h-auto px-0 py-0'
                                    }
                                    onClick={() =>
                                        setSubstituting(
                                            draft.prescriptionLineId,
                                        )
                                    }
                                >
                                    {draft.substitution
                                        ? 'Ubah obat pengganti'
                                        : 'Ganti obat'}
                                </Button>
                            )}
                        {instructionText(line) && (
                            <span
                                className={
                                    line.compound !== null
                                        ? 'block ps-4 text-muted-foreground'
                                        : 'block text-muted-foreground'
                                }
                            >
                                {instructionText(line)}
                            </span>
                        )}
                    </DataTableText>
                ),
        },
        {
            id: 'prescribed',
            header: 'Resep',
            width: 100,
            align: 'right',
            cell: ({ line }) =>
                isCompoundHeader(line)
                    ? null
                    : text(
                          `${displayNumber(line.quantity ?? '0')} ${line.unit?.code ?? ''}`,
                      ),
        },
    ];
    if (!prepared)
        columns.push({
            id: 'stock',
            header: 'Stok di lokasi',
            width: 110,
            align: 'right',
            cell: ({ draft }) =>
                draft
                    ? text(
                          `${displayNumber(stock.get(draft.item.id) ?? '0')} ${baseCode(draft)}`,
                      )
                    : null,
        });
    columns.push(
        {
            id: 'quantity',
            header: 'Diserahkan',
            content,
            minWidth: 120,
            cell: ({ draft, index }) =>
                draft === null ? null : editing ? (
                    <FormControl error={error(index, 'quantity')}>
                        <Input
                            label="Diserahkan"
                            required
                            inputMode="decimal"
                            data-error-field={field(index ?? 0, 'quantity')}
                            value={draft.quantity}
                            onChange={(event) =>
                                update(draft.prescriptionLineId, {
                                    quantity: event.target.value,
                                })
                            }
                        />
                    </FormControl>
                ) : (
                    text(draft.quantity)
                ),
        },
        {
            id: 'unit',
            header: 'Satuan',
            content,
            minWidth: 150,
            cell: ({ draft, index }) =>
                draft === null ? null : editing ? (
                    <FormControl
                        error={error(index, 'unit_id')}
                        data-error-field={field(index ?? 0, 'unit_id')}
                    >
                        <Select
                            label="Satuan"
                            required
                            items={choices(draft).map((unit) => ({
                                value: unit.id,
                                label: unitLabel(unit),
                            }))}
                            value={draft.unit.id}
                            onValueChange={(value) => {
                                const unit = choices(draft).find(
                                    (option) => option.id === value,
                                );
                                if (unit)
                                    update(draft.prescriptionLineId, {
                                        unit,
                                    });
                            }}
                            portalContainer={portalContainer}
                        />
                    </FormControl>
                ) : (
                    text(draft.unit.code)
                ),
        },
        {
            id: 'batch',
            header: prepared ? 'Batch diambil' : 'Batch',
            content: prepared ? 'text' : content,
            minWidth: prepared ? 240 : 200,
            cell: ({ line, draft, index }) =>
                draft === null || !line.item ? null : prepared ? (
                    <TakenBatches
                        taken={draft.taken}
                        baseCode={baseCode(draft)}
                    />
                ) : editing ? (
                    <BatchLookup
                        hint="Boleh dikosongkan: batch diambil otomatis saat disiapkan, menurut cara pengambilan lokasi ini (kedaluwarsa terdekat lebih dulu). Bila caranya Pilih batch manual, batch wajib dipilih."
                        itemId={draft.item.id}
                        locationId={locationId}
                        field={field(index ?? 0, 'batch_id')}
                        value={draft.batch}
                        onChange={(batch) =>
                            update(draft.prescriptionLineId, { batch })
                        }
                        error={error(index, 'batch_id')}
                        portalContainer={portalContainer}
                    />
                ) : (
                    text(draft.batch?.batch_number ?? 'Diambil otomatis')
                ),
        },
    );
    if (prepared)
        columns.push(
            {
                id: 'unit_price',
                header: 'Harga satuan',
                width: 120,
                align: 'right',
                cell: ({ draft }) =>
                    draft?.price ? (
                        <PriceText
                            value={draft.price.unit_price}
                            computed={draft.price.computed_unit_price}
                            changed={draft.price.changed}
                        />
                    ) : null,
            },
            {
                id: 'discount_percent',
                header: 'Diskon %',
                width: 90,
                align: 'right',
                cell: ({ draft }) =>
                    draft?.price ? (
                        <PriceText
                            value={draft.price.discount_percent}
                            computed={draft.price.computed_discount_percent}
                            changed={draft.price.changed}
                        />
                    ) : null,
            },
            {
                id: 'amount',
                header: 'Nilai',
                width: 130,
                align: 'right',
                cell: ({ draft }) =>
                    draft?.price
                        ? text(displayNumber(draft.price.amount))
                        : null,
            },
        );
    columns.push({
        id: 'reason',
        header: 'Alasan bila kurang',
        content,
        minWidth: 200,
        cell: ({ draft, index }) =>
            draft === null ? null : editing ? (
                <FormControl error={error(index, 'reason')}>
                    <Input
                        label="Alasan"
                        maxLength={200}
                        data-error-field={field(index ?? 0, 'reason')}
                        value={draft.reason}
                        onChange={(event) =>
                            update(draft.prescriptionLineId, {
                                reason: event.target.value,
                            })
                        }
                    />
                </FormControl>
            ) : (
                text(draft.reason)
            ),
    });

    return (
        <>
            <DocumentLines
                title="Obat"
                data={rows}
                getRowKey={(row) => row.line.id}
                getRowLabel={(row) =>
                    row.line.item?.name ?? `Racikan ${row.line.compound ?? ''}`
                }
                showRowNumbers
                readOnly={!editing}
                portalContainer={portalContainer}
                emptyMessage="Resep ini tidak berisi obat."
                columns={columns}
            />
            {open && (
                <SubstituteDialog
                    prescribedName={openLine?.item?.name ?? ''}
                    options={itemOptions(open)}
                    current={{
                        itemId: open.item.id,
                        consent: open.substitution?.consent ?? null,
                        reason: open.substitution?.reason ?? '',
                    }}
                    stock={stock}
                    onClose={() => setSubstituting(null)}
                    onApply={({ option, consent, reason }) => {
                        setSubstituting(null);
                        const sameItem = option.item.id === open.item.id;
                        const unit = sameItem
                            ? open.unit
                            : (option.units.find(
                                  (candidate) => candidate.id === open.unit.id,
                              ) ??
                              option.units[0] ??
                              open.unit);
                        update(open.prescriptionLineId, {
                            item: option.item,
                            units: option.units,
                            unit,
                            batch: sameItem ? open.batch : null,
                            substitution:
                                option.is_prescribed || !consent
                                    ? null
                                    : sameItem &&
                                        open.substitution?.consent ===
                                            consent &&
                                        open.substitution.reason === reason
                                      ? open.substitution
                                      : { consent, reason, by: null, at: null },
                        });
                    }}
                />
            )}
        </>
    );
}

// Obat pengganti yang diserahkan di bawah obat resep, dengan yang menyetujui dan alasannya.
function SubstitutionText({
    draft,
    indented,
}: {
    draft: LineDraft;
    indented: boolean;
}): ReactNode {
    const substitution = draft.substitution;
    if (!substitution) return null;
    return (
        <>
            <span
                className={
                    indented ? 'block ps-4 font-medium' : 'block font-medium'
                }
            >
                {`Diganti ${draft.item.code} · ${draft.item.name}`}
            </span>
            <span
                className={
                    indented
                        ? 'block ps-4 text-xs text-muted-foreground'
                        : 'block text-xs text-muted-foreground'
                }
            >
                {[
                    `Disetujui ${consentLabels[substitution.consent].toLowerCase()}`,
                    substitution.reason,
                    substitution.by,
                ]
                    .filter(Boolean)
                    .join(' · ')}
            </span>
        </>
    );
}
