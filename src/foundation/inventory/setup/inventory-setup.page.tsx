import { ActionButton } from '@operations-metta/ui/action-button';
import { Button } from '@operations-metta/ui/button';
import {
    CollapsibleSection,
    CollapsibleSectionGroup,
} from '@operations-metta/ui/collapsible-section';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import {
    Field,
    FieldDescription,
    FieldLabel,
} from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { Switch } from '@operations-metta/ui/switch';
import { useSuspenseQueries } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Hash } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    definePage,
    errorText,
    FormErrorHeader,
    orpc,
    useUnsavedChangesGuard,
    type ApiBody,
} from '../../../platform/shell/index.ts';
import {
    costingLabels,
    pickingLabels,
    PolicySelect,
    transferLabels,
    type PickingMethod,
    type TransferMode,
} from './stock-policy-options.tsx';

// Setelan persediaan per legal entity (Inventory Setup di BC): cara pengambilan, penolakan stok minus, cara mutasi,
// nomor dokumen, dan cara pengambilan per operating unit. Satu Simpan menyimpan setelan umum lalu setiap operating unit
// yang berubah.

type Setup = ApiBody<'inventorySetupShow'>;
type Numbering = Setup['numbering'][number];
type UnitRow = ApiBody<'inventorySetupUnitList'>['data'][number];
type Saved = { general: Setup['data']; units: UnitRow[] };
type Draft = {
    picking: PickingMethod;
    refuseNegative: boolean;
    transferMode: TransferMode;
    units: Record<string, PickingMethod | null>;
};

const draftOf = (saved: Saved): Draft => ({
    picking: saved.general.picking_method,
    refuseNegative: saved.general.refuse_negative_stock,
    transferMode: saved.general.transfer_mode,
    units: Object.fromEntries(
        saved.units.map((unit) => [
            unit.operating_unit.id,
            unit.picking_method,
        ]),
    ),
});

const unitPicking = (draft: Draft, unit: UnitRow) =>
    draft.units[unit.operating_unit.id] ?? null;

const unitField = (unit: UnitRow) =>
    `units.${unit.operating_unit.id}.picking_method`;

const formatOf = (entry: Numbering) =>
    entry.sequences.map((sequence) => sequence.format).join(', ') ||
    'Belum diatur';

// Nomor dokumen diatur di layar Nomor dokumen; di sini hanya formatnya dan jalan ke pengaturannya.
function NumberingField({
    entry,
    canOpen,
}: {
    entry: Numbering;
    canOpen: boolean;
}): ReactNode {
    const only = entry.sequences.length === 1 ? entry.sequences[0] : undefined;
    return (
        <>
            <FormControl>
                <Input
                    label={entry.reference.name}
                    value={formatOf(entry)}
                    readOnly
                />
            </FormControl>
            {canOpen && (
                <Button
                    variant="ghost"
                    size="command"
                    className="justify-self-start"
                    asChild
                >
                    <Link
                        to="/sysadmin/number-sequences"
                        search={{
                            reference: entry.reference.id,
                            ...(only ? { sequence: only.id } : {}),
                        }}
                    >
                        <Hash aria-hidden="true" />
                        {only ? 'Buka pengaturan nomor' : 'Atur nomor'}
                    </Link>
                </Button>
            )}
        </>
    );
}

function SetupForm({
    setup,
    units,
    onSaved,
}: {
    setup: Setup;
    units: UnitRow[];
    onSaved: () => Promise<void>;
}): ReactNode {
    const editing = setup.can_manage;
    const [saved, setSaved] = useState<Saved>({
        general: setup.data,
        units,
    });
    const [draft, setDraft] = useState(() => draftOf(saved));
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const reset = () => {
        setDraft(draftOf(saved));
        setErrors({});
        setMessage(null);
    };
    const dirty =
        draft.picking !== saved.general.picking_method ||
        draft.refuseNegative !== saved.general.refuse_negative_stock ||
        draft.transferMode !== saved.general.transfer_mode ||
        saved.units.some(
            (unit) => unitPicking(draft, unit) !== unit.picking_method,
        );
    const leaveGuard = useUnsavedChangesGuard(dirty, reset);
    const overridden = saved.units.filter(
        (unit) => unitPicking(draft, unit) !== null,
    ).length;

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        let general: Saved['general'];
        try {
            const { body } = await api.inventorySetupUpdate({
                body: {
                    picking_method: draft.picking,
                    refuse_negative_stock: draft.refuseNegative,
                    transfer_mode: draft.transferMode,
                    version: saved.general.version,
                },
            });
            general = body.data;
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else
                setMessage(
                    errorText(caught, 'Setelan persediaan belum disimpan.'),
                );
            setBusy(false);
            return;
        }
        // Setiap operating unit punya versinya sendiri. Yang gagal tetap di draft, jadi Simpan berikutnya mengulanginya
        // dengan versi setelan umum yang baru.
        const failed: Record<string, string[]> = {};
        const results = await Promise.all(
            saved.units.map(async (unit) => {
                const picking = unitPicking(draft, unit);
                if (picking === unit.picking_method) return unit;
                try {
                    const { body } = await api.inventorySetupUnitUpdate({
                        params: { id: unit.operating_unit.id },
                        body: {
                            picking_method: picking,
                            version: unit.version,
                        },
                    });
                    return body.data;
                } catch (caught) {
                    failed[unitField(unit)] = [
                        caught instanceof ApiError && caught.status === 422
                            ? caught.message
                            : errorText(
                                  caught,
                                  `Setelan ${unit.operating_unit.name} belum disimpan.`,
                              ),
                    ];
                    return unit;
                }
            }),
        );
        setSaved({ general, units: results });
        setBusy(false);
        if (Object.keys(failed).length) {
            setErrors(failed);
            return;
        }
        toast.success('Setelan persediaan disimpan.');
        await onSaved();
    };

    return (
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
            <RecordActionBar title="Setelan persediaan">
                {editing && (
                    <>
                        <ActionButton
                            action="save"
                            type="submit"
                            form="inventory-setup"
                            disabled={busy}
                            pending={busy}
                        />
                        <ActionButton
                            action="cancel"
                            disabled={busy}
                            onClick={reset}
                        />
                    </>
                )}
            </RecordActionBar>
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
                <form
                    noValidate
                    id="inventory-setup"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void save();
                    }}
                >
                    <FormErrorHeader
                        errors={errors}
                        message={message}
                        operation="Setelan persediaan belum disimpan"
                    />
                    <CollapsibleSectionGroup
                        defaultValue={[
                            'general',
                            'location',
                            'numbering',
                            'units',
                        ]}
                    >
                        <CollapsibleSection
                            value="general"
                            title="Umum"
                            summary={`${pickingLabels[draft.picking]} · Stok minus ${draft.refuseNegative ? 'ditolak' : 'boleh'}`}
                        >
                            <FormGrid>
                                <FormControl
                                    error={errors.picking_method?.[0]}
                                    hint="Urutan batch yang diambil saat stok keluar. FEFO: yang kedaluwarsanya paling dekat keluar lebih dulu. FIFO: yang masuk lebih dulu keluar lebih dulu. Pilih batch manual: petugas memilih sendiri batch yang dikeluarkan."
                                    data-error-field="picking_method"
                                >
                                    <PolicySelect
                                        label="Cara pengambilan"
                                        labels={pickingLabels}
                                        value={draft.picking}
                                        editing={editing}
                                        onChange={(picking) => {
                                            if (picking)
                                                setDraft({ ...draft, picking });
                                        }}
                                    />
                                </FormControl>
                                <FormControl hint="Barang yang masuk lebih dulu dihitung keluar lebih dulu. Metode rata-rata menyusul.">
                                    <Input
                                        label="Metode harga pokok"
                                        value={
                                            costingLabels[
                                                saved.general.costing_method
                                            ]
                                        }
                                        readOnly
                                    />
                                </FormControl>
                                <FormControl
                                    error={errors.refuse_negative_stock?.[0]}
                                    hint="Bila mati, stok keluar boleh melebihi stok yang tercatat sehingga stok bisa minus. Mutasi antarlokasi selalu ditolak bila stoknya tidak cukup."
                                    data-error-field="refuse_negative_stock"
                                >
                                    <Field
                                        orientation="horizontal"
                                        className="w-auto"
                                    >
                                        <Switch
                                            id="inventory-refuse-negative"
                                            checked={draft.refuseNegative}
                                            disabled={!editing}
                                            onCheckedChange={(refuseNegative) =>
                                                setDraft({
                                                    ...draft,
                                                    refuseNegative,
                                                })
                                            }
                                        />
                                        <FieldLabel
                                            htmlFor="inventory-refuse-negative"
                                            className="font-normal"
                                        >
                                            Tolak stok minus
                                        </FieldLabel>
                                    </Field>
                                </FormControl>
                            </FormGrid>
                        </CollapsibleSection>
                        <CollapsibleSection
                            value="location"
                            title="Lokasi"
                            summary={`Mutasi ${transferLabels[draft.transferMode].toLowerCase()}`}
                        >
                            <FormGrid>
                                <FormControl
                                    error={errors.transfer_mode?.[0]}
                                    hint="Langsung: stok pindah dalam satu langkah. Kirim lalu terima: stok singgah di lokasi transit sampai lokasi tujuan menerimanya."
                                    data-error-field="transfer_mode"
                                >
                                    <PolicySelect
                                        label="Cara mutasi"
                                        labels={transferLabels}
                                        value={draft.transferMode}
                                        editing={editing}
                                        onChange={(transferMode) => {
                                            if (transferMode)
                                                setDraft({
                                                    ...draft,
                                                    transferMode,
                                                });
                                        }}
                                    />
                                </FormControl>
                            </FormGrid>
                        </CollapsibleSection>
                        <CollapsibleSection
                            value="numbering"
                            title="Penomoran"
                            summary={setup.numbering
                                .map(
                                    (entry) =>
                                        `${entry.reference.name}: ${formatOf(entry)}`,
                                )
                                .join(' · ')}
                        >
                            <FormGrid>
                                {setup.numbering.map((entry) => (
                                    <NumberingField
                                        key={entry.reference.id}
                                        entry={entry}
                                        canOpen={setup.can_open_numbering}
                                    />
                                ))}
                            </FormGrid>
                        </CollapsibleSection>
                        <CollapsibleSection
                            value="units"
                            title="Operating unit"
                            summary={
                                overridden
                                    ? `${overridden} operating unit memakai cara pengambilan sendiri`
                                    : 'Semua mengikuti legal entity'
                            }
                        >
                            <FieldDescription className="mb-3">
                                Cara pengambilan yang berlaku: setelan lokasi
                                lebih dulu, lalu operating unit, lalu legal
                                entity.
                            </FieldDescription>
                            <DataTable
                                data={saved.units}
                                getRowKey={(unit) => unit.operating_unit.id}
                                getRowLabel={(unit) => unit.operating_unit.name}
                                cellMode="document"
                                scrollMode="inline"
                                emptyMessage="Belum ada operating unit aktif."
                                columns={[
                                    {
                                        id: 'operating_unit',
                                        header: 'Operating unit',
                                        width: 280,
                                        cell: (unit) => (
                                            <DataTableText>
                                                {unit.operating_unit.name}
                                            </DataTableText>
                                        ),
                                    },
                                    {
                                        id: 'picking_method',
                                        header: 'Cara pengambilan',
                                        content: 'control',
                                        minWidth: 280,
                                        cell: (unit) => (
                                            <FormControl
                                                error={
                                                    errors[unitField(unit)]?.[0]
                                                }
                                                data-error-field={unitField(
                                                    unit,
                                                )}
                                            >
                                                <PolicySelect
                                                    label="Cara pengambilan"
                                                    labels={pickingLabels}
                                                    inherit={`Ikuti legal entity (${pickingLabels[draft.picking]})`}
                                                    value={unitPicking(
                                                        draft,
                                                        unit,
                                                    )}
                                                    editing={editing}
                                                    onChange={(picking) =>
                                                        setDraft({
                                                            ...draft,
                                                            units: {
                                                                ...draft.units,
                                                                [unit
                                                                    .operating_unit
                                                                    .id]:
                                                                    picking,
                                                            },
                                                        })
                                                    }
                                                />
                                            </FormControl>
                                        ),
                                    },
                                ]}
                            />
                        </CollapsibleSection>
                    </CollapsibleSectionGroup>
                </form>
            </div>
            {leaveGuard}
        </div>
    );
}

function InventorySetupPage(): ReactNode {
    const [setup, units] = useSuspenseQueries({
        queries: [
            orpc.inventorySetupShow.queryOptions({
                select: (response) => response.body,
            }),
            orpc.inventorySetupUnitList.queryOptions({
                select: (response) => response.body.data,
            }),
        ],
    });
    // Form dipasang ulang dari data terbaru setelah Simpan, supaya versi dan isiannya sama dengan yang tersimpan.
    const key = [
        setup.data.data.version,
        ...units.data.map(
            (unit) => `${unit.operating_unit.id}:${unit.version ?? ''}`,
        ),
    ].join('|');
    return (
        <SetupForm
            key={key}
            setup={setup.data}
            units={units.data}
            onSaved={async () => {
                await Promise.all([setup.refetch(), units.refetch()]);
            }}
        />
    );
}

export const page = definePage({
    path: '/sysadmin/inventory/setup',
    layout: 'app',
    title: 'Setelan persediaan',
    component: InventorySetupPage,
});
