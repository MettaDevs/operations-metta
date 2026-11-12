import { Input } from '@operations-metta/ui/input';
import { Select } from '@operations-metta/ui/select';
import type { ReactNode, RefObject } from 'react';
import type { ApiBody } from '../../../platform/shell/index.ts';

// Pilihan mesin stok di layar persediaan. Label ditulis per nilai, supaya cara baru di mesin langsung gagal dikompilasi
// sampai labelnya ada.

type Setup = ApiBody<'inventorySetupShow'>['data'];
export type PickingMethod = Setup['picking_method'];
export type TransferMode = Setup['transfer_mode'];

export const pickingLabels: Record<PickingMethod, string> = {
    fefo: 'FEFO',
    fifo: 'FIFO',
    manual: 'Pilih batch manual',
};

export const transferLabels: Record<TransferMode, string> = {
    langsung: 'Langsung',
    kirim_terima: 'Kirim lalu terima',
};

export const costingLabels: Record<Setup['costing_method'], string> = {
    fifo: 'FIFO',
};

// Nilai pilihan "ikuti setelan di atasnya". Select menganggap nilai kosong sebagai belum memilih, jadi ia butuh nilai
// sendiri; di API nilainya null.
const INHERIT = 'inherit';

function isOption<K extends string>(
    labels: Record<K, string>,
    value: string | null,
): value is K {
    return value !== null && Object.hasOwn(labels, value);
}

// Select untuk satu setelan stok; tanpa izin ubah ia menjadi isian baca saja, karena Select tidak punya keadaan itu.
// inherit memberi label pilihan "ikuti" yang menyimpan null.
export function PolicySelect<K extends string>({
    label,
    labels,
    value,
    onChange,
    inherit,
    editing,
    portalContainer,
}: {
    label: string;
    labels: Record<K, string>;
    value: K | null;
    onChange: (value: K | null) => void;
    inherit?: string;
    editing: boolean;
    portalContainer?: RefObject<HTMLElement | null>;
}): ReactNode {
    const items = [
        ...(inherit === undefined ? [] : [{ value: INHERIT, label: inherit }]),
        ...Object.entries<string>(labels).map(([option, text]) => ({
            value: option,
            label: text,
        })),
    ];
    const selected = value ?? (inherit === undefined ? null : INHERIT);
    if (!editing)
        return (
            <Input
                label={label}
                value={
                    items.find((item) => item.value === selected)?.label ?? ''
                }
                readOnly
            />
        );
    return (
        <Select
            label={label}
            required={inherit === undefined}
            items={items}
            value={selected}
            onValueChange={(next) => {
                if (isOption(labels, next)) onChange(next);
                else if (next === INHERIT) onChange(null);
            }}
            searchPlaceholder={`Cari ${label.toLowerCase()}`}
            emptyMessage="Pilihan tidak ditemukan."
            portalContainer={portalContainer}
        />
    );
}
