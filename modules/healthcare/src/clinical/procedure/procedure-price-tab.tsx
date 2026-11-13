import { ActionButton } from '@operations-metta/ui/action-button';
import { DataTable } from '@operations-metta/ui/data-table';
import { displayNumber } from '@operations-metta/ui/display-number';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ComponentDialog, PriceDialog } from './procedure-price-dialogs.tsx';
import {
    priceTotal,
    type ComponentDraft,
    type PriceDraft,
    type PriceMetadata,
    type SavedPrice,
} from './procedure-price-draft.ts';

const rowActions = [
    { id: 'edit', label: 'Ubah' },
    { id: 'delete', label: 'Delete', destructive: true },
];
const deleteMessage = 'Apakah Anda yakin ingin menghapus data ini?';

type ComponentRow = {
    key: string;
    index: number;
    // Kosong untuk baris Total di bawah grid, seperti tfoot grid sistem lama.
    component: ComponentDraft | null;
};

function nameOf(
    list: { id: string; name: string }[] | undefined,
    id: string | null,
    savedId: string | null | undefined,
    savedName: string | null | undefined,
    wildcard: string,
): string {
    if (id === null) return wildcard;
    return (
        list?.find((item) => item.id === id)?.name ??
        (savedId === id ? (savedName ?? '') : '')
    );
}

// Tab Detail Harga kartu Jasa sistem lama (views/services/price/table.php): grid baris harga, lalu Detail Komponen
// Jasa milik baris harga yang dipilih dengan klik dua kali, beserta baris Total.
export function ProcedurePriceTab({
    prices,
    saved,
    metadata,
    editing,
    onChange,
}: {
    prices: PriceDraft[];
    saved: SavedPrice[];
    metadata: PriceMetadata | undefined;
    editing: boolean;
    onChange: (prices: PriceDraft[]) => void;
}): ReactNode {
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [openPrice, setOpenPrice] = useState<PriceDraft | 'new' | null>(null);
    const [openComponent, setOpenComponent] = useState<number | 'new' | null>(
        null,
    );
    const { confirm, confirmation } = useConfirmation();
    const selected = prices.find((price) => price.key === selectedKey) ?? null;
    const savedOf = (price: PriceDraft | null) =>
        price?.id ? saved.find((item) => item.id === price.id) : undefined;
    const replaceSelected = (components: ComponentDraft[]) =>
        onChange(
            prices.map((price) =>
                price.key === selectedKey ? { ...price, components } : price,
            ),
        );
    const componentRows: ComponentRow[] = selected
        ? [
              ...selected.components.map((component, index) => ({
                  key: component.charge_component_id,
                  index,
                  component,
              })),
              { key: 'total', index: -1, component: null },
          ]
        : [];
    const componentName = (id: string) => {
        const found = metadata?.charge_components.find(
            (item) => item.id === id,
        );
        const held = savedOf(selected)?.components.find(
            (item) => item.charge_component_id === id,
        );
        return found
            ? `${found.code} ${found.name}`
            : held
              ? `${held.charge_component_code} ${held.charge_component_name}`
              : '';
    };
    const amount = (
        row: ComponentRow,
        field: 'new_price' | 'new_hc_price' | 'new_bpjs_price',
    ) =>
        displayNumber(
            row.component
                ? row.component[field]
                : priceTotal(selected?.components ?? [], field),
        );

    return (
        <div className="flex flex-col gap-3">
            {editing && (
                <div>
                    <ActionButton
                        action="create"
                        type="button"
                        onClick={() => setOpenPrice('new')}
                    />
                </div>
            )}
            <DataTable
                scrollMode="inline"
                data={prices}
                getRowKey={(price) => price.key}
                showRowNumbers
                activeRowKey={selectedKey ?? undefined}
                onRowClick={(price) =>
                    setSelectedKey(price.key === selectedKey ? null : price.key)
                }
                actions={editing ? rowActions : []}
                actionsPlacement="inline"
                onRowAction={(action, price) => {
                    if (action === 'edit') setOpenPrice(price);
                    else
                        void confirm({
                            title: 'Delete baris harga?',
                            description: deleteMessage,
                            confirmLabel: 'Delete',
                            destructive: true,
                        }).then((yes) => {
                            if (!yes) return;
                            onChange(
                                prices.filter((item) => item.key !== price.key),
                            );
                            if (price.key === selectedKey) setSelectedKey(null);
                        });
                }}
                emptyMessage="Belum ada harga."
                columns={[
                    {
                        id: 'care_class',
                        header: 'Kelas',
                        width: 140,
                        cell: (price) =>
                            nameOf(
                                metadata?.care_classes,
                                price.care_class_id,
                                savedOf(price)?.care_class_id,
                                savedOf(price)?.care_class_name,
                                'XX',
                            ),
                    },
                    {
                        id: 'price_group',
                        header: 'Kelompok Harga',
                        width: 160,
                        cell: (price) =>
                            nameOf(
                                metadata?.price_groups,
                                price.price_group_id,
                                savedOf(price)?.price_group_id,
                                savedOf(price)?.price_group_name,
                                '',
                            ),
                    },
                    {
                        id: 'specialty',
                        header: 'Spesialis',
                        width: 160,
                        cell: (price) =>
                            nameOf(
                                metadata?.specialties,
                                price.specialty_id,
                                savedOf(price)?.specialty_id,
                                savedOf(price)?.specialty_name,
                                'ALL',
                            ),
                    },
                    {
                        id: 'doctor',
                        header: 'Dokter',
                        width: 200,
                        cell: (price) =>
                            nameOf(
                                metadata?.doctors,
                                price.doctor_id,
                                savedOf(price)?.doctor_id,
                                savedOf(price)?.doctor_name,
                                'None',
                            ),
                    },
                    {
                        id: 'location',
                        header: 'Lokasi',
                        width: 90,
                        cell: (price) => price.location,
                    },
                    {
                        id: 'operation_category',
                        header: 'Kategori Operasi',
                        width: 160,
                        cell: (price) =>
                            nameOf(
                                metadata?.operation_categories,
                                price.operation_category_id,
                                savedOf(price)?.operation_category_id,
                                savedOf(price)?.operation_category_name,
                                'ALL',
                            ),
                    },
                ]}
            />
            <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Detail Komponen Jasa</h3>
                {editing && (
                    <ActionButton
                        action="create"
                        type="button"
                        disabled={!selected}
                        onClick={() => setOpenComponent('new')}
                    />
                )}
            </div>
            <DataTable
                scrollMode="inline"
                data={componentRows}
                getRowKey={(row) => row.key}
                actions={editing ? rowActions : []}
                getRowActions={(row) =>
                    editing && row.component ? rowActions : []
                }
                actionsPlacement="inline"
                onRowAction={(action, row) => {
                    if (!selected || !row.component) return;
                    if (action === 'edit') setOpenComponent(row.index);
                    else
                        void confirm({
                            title: 'Delete komponen?',
                            description: deleteMessage,
                            confirmLabel: 'Delete',
                            destructive: true,
                        }).then((yes) => {
                            if (yes)
                                replaceSelected(
                                    selected.components.filter(
                                        (_, index) => index !== row.index,
                                    ),
                                );
                        });
                }}
                emptyMessage="Klik dua kali baris harga untuk melihat komponennya."
                columns={[
                    {
                        id: 'description',
                        header: 'Deskripsi',
                        width: 240,
                        cell: (row) =>
                            row.component
                                ? componentName(
                                      row.component.charge_component_id,
                                  )
                                : 'Total',
                    },
                    {
                        id: 'incentive',
                        header: 'Insentif',
                        width: 90,
                        align: 'right',
                        cell: (row) =>
                            row.component
                                ? `${displayNumber(row.component.incentive_percent)}%`
                                : '',
                    },
                    {
                        id: 'quantity',
                        header: 'Qty',
                        width: 80,
                        align: 'right',
                        cell: (row) =>
                            row.component
                                ? displayNumber(row.component.quantity)
                                : '',
                    },
                    {
                        id: 'new_price',
                        header: 'Harga Baru',
                        width: 140,
                        align: 'right',
                        cell: (row) => amount(row, 'new_price'),
                    },
                    {
                        id: 'new_hc_price',
                        header: 'Harga Baru HC',
                        width: 140,
                        align: 'right',
                        cell: (row) => amount(row, 'new_hc_price'),
                    },
                    {
                        id: 'new_bpjs_price',
                        header: 'Harga Baru BPJS',
                        width: 140,
                        align: 'right',
                        cell: (row) => amount(row, 'new_bpjs_price'),
                    },
                ]}
            />
            {openPrice !== null && (
                <PriceDialog
                    price={openPrice === 'new' ? null : openPrice}
                    saved={openPrice === 'new' ? undefined : savedOf(openPrice)}
                    metadata={metadata}
                    onClose={() => setOpenPrice(null)}
                    onConfirm={(price) => {
                        onChange(
                            openPrice === 'new'
                                ? [...prices, price]
                                : prices.map((item) =>
                                      item.key === price.key ? price : item,
                                  ),
                        );
                        setOpenPrice(null);
                    }}
                />
            )}
            {openComponent !== null && selected && (
                <ComponentDialog
                    component={
                        openComponent === 'new'
                            ? null
                            : (selected.components[openComponent] ?? null)
                    }
                    heldIds={
                        new Set(
                            savedOf(selected)?.components.map(
                                (item) => item.charge_component_id,
                            ),
                        )
                    }
                    takenIds={
                        new Set(
                            selected.components
                                .filter((_, index) => index !== openComponent)
                                .map((item) => item.charge_component_id),
                        )
                    }
                    metadata={metadata}
                    onClose={() => setOpenComponent(null)}
                    onConfirm={(component) => {
                        replaceSelected(
                            openComponent === 'new'
                                ? [...selected.components, component]
                                : selected.components.map((item, index) =>
                                      index === openComponent
                                          ? component
                                          : item,
                                  ),
                        );
                        setOpenComponent(null);
                    }}
                />
            )}
            {confirmation}
        </div>
    );
}
