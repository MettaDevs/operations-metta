import { ActionButton } from '@operations-metta/ui/action-button';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import { Select } from '@operations-metta/ui/select';
import {
    PageDialog,
    PageDialogBody,
    PageDialogContent,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    type ApiBody,
} from '../../../platform/shell/index.ts';
import {
    displayNumber,
    parseDisplayNumber,
} from '@operations-metta/ui/display-number';
import type { Item } from '../item/item-lookup.tsx';
import { LocationLookup } from '../location/location-lookup.tsx';
import type { Reference } from '@operations-metta/ui/master-lookup';

type Level = ApiBody<'inventoryStockkeepingUnitList'>['data'][number];
type Policy = NonNullable<Level['reordering_policy']>;
type Errors = Record<string, string[]>;

const notPlanned = 'tidak';
const policyLabels: Record<Policy, string> = {
    jumlah_tetap: 'Jumlah tetap',
    maksimum: 'Sampai stok maksimum',
};
const policyItems = [
    { value: notPlanned, label: 'Tidak dihitung' },
    ...Object.entries(policyLabels).map(([value, label]) => ({ value, label })),
];
const policyOf = (value: string | null): Policy | null =>
    value === 'jumlah_tetap' || value === 'maksimum' ? value : null;

const numberFormat =
    'Tulis angka seperti 12.500 atau 1,5. Titik untuk ribuan, koma untuk desimal.';

function LevelCard({
    item,
    level,
    canManage,
    onSaved,
    onClose,
}: {
    item: Item;
    level: Level | null;
    canManage: boolean;
    onSaved: (level: Level) => void;
    onClose: () => void;
}): ReactNode {
    const editing = level === null || canManage;
    const blank = {
        location: level?.location ?? null,
        minimum: level?.minimum_quantity
            ? displayNumber(level.minimum_quantity)
            : '',
        maximum: level?.maximum_quantity
            ? displayNumber(level.maximum_quantity)
            : '',
        policy: level?.reordering_policy ?? null,
        reorder: level?.reorder_quantity
            ? displayNumber(level.reorder_quantity)
            : '',
    };
    const [form, setForm] = useState<{
        location: Reference | null;
        minimum: string;
        maximum: string;
        policy: Policy | null;
        reorder: string;
    }>(blank);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const [operation, setOperation] = useState('belum disimpan');
    const { confirm, confirmation } = useConfirmation();
    const portalContainer = useRef<HTMLDivElement>(null);
    const dirty = JSON.stringify(form) !== JSON.stringify(blank);
    usePageDialogRecord({
        recordTitle: level
            ? `${item.code} di ${level.location.code}`
            : `Stok minimum dan maksimum baru ${item.code}`,
        editing,
        dirty,
    });

    const save = async () => {
        setOperation('belum disimpan');
        const found: Errors = {};
        const amount = (field: string, typed: string) => {
            const trimmed = typed.trim();
            if (!trimmed) return null;
            const parsed = parseDisplayNumber(trimmed);
            if (parsed === null) found[field] = [numberFormat];
            return parsed ?? trimmed;
        };
        const body = {
            item_id: item.id,
            location_id: form.location?.id ?? '',
            minimum_quantity: amount('minimum_quantity', form.minimum),
            maximum_quantity: amount('maximum_quantity', form.maximum),
            reordering_policy: form.policy,
            reorder_quantity: amount('reorder_quantity', form.reorder),
        };
        setMessage(null);
        if (Object.keys(found).length) {
            setErrors(found);
            return;
        }
        setBusy(true);
        setErrors({});
        try {
            const { body: saved } = level
                ? await api.inventoryStockkeepingUnitUpdate({
                      params: { id: level.id },
                      body: { ...body, version: level.version },
                  })
                : await api.inventoryStockkeepingUnitCreate({ body });
            toast.success(
                level
                    ? 'Stok minimum dan maksimum diperbarui.'
                    : 'Stok minimum dan maksimum disimpan.',
            );
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else
                setMessage(
                    errorText(
                        caught,
                        'Stok minimum dan maksimum belum disimpan.',
                    ),
                );
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!level) return;
        if (
            !(await confirm({
                title: `Delete stok minimum dan maksimum ${item.code} di ${level.location.code}?`,
                description:
                    'Stok minimum dan maksimum barang ini di lokasi itu menjadi kosong sampai diatur lagi. Stoknya tidak berubah.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setOperation('belum dihapus');
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            await api.inventoryStockkeepingUnitDelete({
                params: { id: level.id },
                body: { version: level.version },
            });
            toast.success('Stok minimum dan maksimum dihapus.');
            onClose();
        } catch (caught) {
            setMessage(
                errorText(caught, 'Stok minimum dan maksimum belum dihapus.'),
            );
        } finally {
            setBusy(false);
        }
    };

    return (
        <div ref={portalContainer} className="flex min-h-0 flex-1 flex-col">
            <form
                noValidate
                className="flex min-h-0 flex-1 flex-col"
                onSubmit={(event) => {
                    event.preventDefault();
                    // Kartu ini terbuka di atas kartu barang; submit-nya tidak boleh ikut menyimpan kartu barang.
                    event.stopPropagation();
                    void save();
                }}
            >
                <PageDialogToolbar>
                    {editing && (
                        <>
                            <ActionButton
                                action="save"
                                type="submit"
                                disabled={busy}
                                pending={busy}
                            />
                            <ActionButton
                                action="cancel"
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                    if (!level) {
                                        onClose();
                                        return;
                                    }
                                    setForm(blank);
                                    setErrors({});
                                }}
                            />
                        </>
                    )}
                    {level && canManage && (
                        <ActionButton
                            action="archive"
                            disabled={busy}
                            onClick={() => void remove()}
                        />
                    )}
                </PageDialogToolbar>
                <FormErrorHeader
                    errors={errors}
                    message={message}
                    operation={`Stok minimum dan maksimum ${operation}`}
                />
                <PageDialogBody className="py-3">
                    <FormGrid>
                        <FormControl>
                            <Input
                                label="Barang"
                                readOnly
                                value={`${item.code} - ${item.name}`}
                            />
                        </FormControl>
                        <LocationLookup
                            label="Lokasi"
                            required
                            transit={false}
                            field="location_id"
                            value={form.location}
                            onChange={(location) =>
                                setForm({ ...form, location })
                            }
                            disabled={!editing}
                            error={errors.location_id?.[0]}
                            portalContainer={portalContainer}
                        />
                        <FormControl
                            error={errors.minimum_quantity?.[0]}
                            hint={`Batas bawah stok di lokasi ini dalam ${item.base_unit.code}. Hitung saran di Permintaan pembelian menyarankan pesan bila stok tersedia sampai di angka ini atau di bawahnya.`}
                        >
                            <Input
                                label={`Stok minimum (${item.base_unit.code})`}
                                inputMode="decimal"
                                data-error-field="minimum_quantity"
                                value={form.minimum}
                                readOnly={!editing}
                                onChange={(event) =>
                                    setForm({
                                        ...form,
                                        minimum: event.target.value,
                                    })
                                }
                            />
                        </FormControl>
                        <FormControl
                            error={errors.maximum_quantity?.[0]}
                            hint={`Stok yang ingin dicapai di lokasi ini dalam ${item.base_unit.code}.`}
                        >
                            <Input
                                label={`Stok maksimum (${item.base_unit.code})`}
                                inputMode="decimal"
                                data-error-field="maximum_quantity"
                                value={form.maximum}
                                readOnly={!editing}
                                onChange={(event) =>
                                    setForm({
                                        ...form,
                                        maximum: event.target.value,
                                    })
                                }
                            />
                        </FormControl>
                        <FormControl
                            error={errors.reordering_policy?.[0]}
                            hint="Jumlah tetap memesan jumlah pesan ulang, diulang sampai stok di atas stok minimum. Sampai stok maksimum memesan selisih stok tersedia dengan stok maksimum. Tidak dihitung berarti Hitung saran melewati barang ini di lokasi ini."
                        >
                            {editing ? (
                                <Select
                                    label="Cara pesan ulang"
                                    items={policyItems}
                                    value={form.policy ?? notPlanned}
                                    onValueChange={(value) =>
                                        setForm({
                                            ...form,
                                            policy: policyOf(value),
                                        })
                                    }
                                    portalContainer={portalContainer}
                                />
                            ) : (
                                <Input
                                    label="Cara pesan ulang"
                                    readOnly
                                    value={
                                        form.policy
                                            ? policyLabels[form.policy]
                                            : 'Tidak dihitung'
                                    }
                                />
                            )}
                        </FormControl>
                        <FormControl
                            error={errors.reorder_quantity?.[0]}
                            hint={`Jumlah sekali pesan dalam ${item.base_unit.code}, dipakai cara pesan jumlah tetap.`}
                        >
                            <Input
                                label={`Jumlah pesan ulang (${item.base_unit.code})`}
                                inputMode="decimal"
                                data-error-field="reorder_quantity"
                                value={form.reorder}
                                readOnly={!editing}
                                onChange={(event) =>
                                    setForm({
                                        ...form,
                                        reorder: event.target.value,
                                    })
                                }
                            />
                        </FormControl>
                    </FormGrid>
                </PageDialogBody>
                {confirmation}
            </form>
        </div>
    );
}

export function StockkeepingUnits({ item }: { item: Item | null }): ReactNode {
    const [open, setOpen] = useState<Level | 'new' | null>(null);
    const queryClient = useQueryClient();
    const queryKey = ['inventory-stockkeeping-units', item?.id];
    const levels = useQuery({
        queryKey,
        queryFn: async () =>
            (
                await api.inventoryStockkeepingUnitList({
                    query: { item_id: item?.id ?? '', per_page: 100 },
                })
            ).body,
        enabled: item !== null,
    });
    const reload = () => void queryClient.invalidateQueries({ queryKey });

    if (!item)
        return (
            <p className="text-sm text-muted-foreground">
                Stok minimum dan maksimum per lokasi bisa diatur setelah barang
                disimpan.
            </p>
        );
    const rows = levels.data?.data ?? [];
    const canManage = levels.data?.can_manage ?? false;
    return (
        <div className="space-y-2">
            {canManage && (
                <ActionButton
                    action="create"
                    type="button"
                    onClick={() => setOpen('new')}
                />
            )}
            <DataTable<Level>
                data={rows}
                scrollMode="inline"
                getRowKey={(row) => row.id}
                getRowLabel={(row) => row.location.name}
                onRowClick={(row) => setOpen(row)}
                emptyMessage={
                    levels.isError
                        ? errorText(
                              levels.error,
                              'Stok minimum dan maksimum belum bisa dimuat.',
                          )
                        : levels.isPending
                          ? 'Memuat…'
                          : canManage
                            ? 'Belum ada lokasi. Pilih Baru untuk mengatur stok minimum dan maksimum.'
                            : 'Belum ada lokasi yang diatur.'
                }
                columns={[
                    {
                        id: 'location',
                        header: 'Lokasi',
                        width: 220,
                        cell: (row) => (
                            <DataTableText>
                                {`${row.location.code} · ${row.location.name}`}
                            </DataTableText>
                        ),
                    },
                    {
                        id: 'minimum',
                        header: 'Stok minimum',
                        width: 130,
                        align: 'right',
                        cell: (row) => (
                            <DataTableText>
                                {row.minimum_quantity
                                    ? displayNumber(row.minimum_quantity)
                                    : ''}
                            </DataTableText>
                        ),
                    },
                    {
                        id: 'maximum',
                        header: 'Stok maksimum',
                        width: 130,
                        align: 'right',
                        cell: (row) => (
                            <DataTableText>
                                {row.maximum_quantity
                                    ? displayNumber(row.maximum_quantity)
                                    : ''}
                            </DataTableText>
                        ),
                    },
                    {
                        id: 'policy',
                        header: 'Cara pesan ulang',
                        width: 180,
                        cell: (row) => (
                            <DataTableText>
                                {row.reordering_policy
                                    ? policyLabels[row.reordering_policy]
                                    : ''}
                            </DataTableText>
                        ),
                    },
                    {
                        id: 'reorder',
                        header: 'Jumlah pesan ulang',
                        width: 150,
                        align: 'right',
                        cell: (row) => (
                            <DataTableText>
                                {row.reorder_quantity
                                    ? displayNumber(row.reorder_quantity)
                                    : ''}
                            </DataTableText>
                        ),
                    },
                ]}
            />
            {open && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setOpen(null);
                    }}
                >
                    <PageDialogContent title="Stok minimum dan maksimum">
                        <LevelCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            item={item}
                            level={open === 'new' ? null : open}
                            canManage={canManage}
                            onSaved={(saved) => {
                                setOpen(saved);
                                reload();
                            }}
                            onClose={() => {
                                setOpen(null);
                                reload();
                            }}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
        </div>
    );
}
