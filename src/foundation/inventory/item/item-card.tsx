import { ActionButton } from '@operations-metta/ui/action-button';
import {
    CollapsibleSection,
    CollapsibleSectionGroup,
} from '@operations-metta/ui/collapsible-section';
import { FactBox } from '@operations-metta/ui/fact-box';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialog,
    PageDialogBody,
    PageDialogContent,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { Switch } from '@operations-metta/ui/switch';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
} from '../../../platform/shell/index.ts';
import { CodeEntryCard } from '../code-list/code-list-screen.tsx';
import { unitsOfMeasure } from '../code-list/code-list-sources.ts';
import { UnitOfMeasureLookup } from '../code-list/code-list-lookup.tsx';
import { ItemCategoryCard } from '../item-category/item-category-card.tsx';
import { ItemCategoryLookup } from '../item-category/item-category-lookup.tsx';
import type { Reference } from '../master-lookup.tsx';
import { PolicySelect } from '../setup/stock-policy-options.tsx';
import { StockkeepingUnits } from '../stockkeeping-unit/stockkeeping-units.tsx';
import { TrackingCodeCard } from '../tracking-code/tracking-code-card.tsx';
import { TrackingCodeLookup } from '../tracking-code/tracking-code-lookup.tsx';
import type { Item } from './item-lookup.tsx';
import { ItemStock } from './item-stock.tsx';

// Kartu barang (Item Card di BC). Kategori dan profil pelacakan boleh kosong; pilihan rujukan tidak bisa dikosongkan,
// jadi masing-masing dibuka lewat saklar seperti di kartu kategori barang.

type NegativeStock = 'refuse' | 'allow';
const negativeStockLabels: Record<NegativeStock, string> = {
    refuse: 'Tolak',
    allow: 'Izinkan',
};
const negativeStockSummary: Record<NegativeStock, string> = {
    refuse: 'Stok minus ditolak',
    allow: 'Stok minus diizinkan',
};

type Creating = 'unit' | 'category' | 'tracking';

const referenceOf = (row: Reference | null): Reference | null =>
    row && { id: row.id, code: row.code, name: row.name };

const formOf = (item: Item | null) => ({
    code: item?.code ?? '',
    name: item?.name ?? '',
    baseUnit: referenceOf(item?.base_unit ?? null),
    hasCategory: item?.category != null,
    category: referenceOf(item?.category ?? null),
    hasTracking: item?.tracking_code != null,
    trackingCode: referenceOf(item?.tracking_code ?? null),
    // Barang baru memakai profil pelacakan kategorinya sampai pengguna memilih profil sendiri, sama dengan yang disalin
    // server bila profil tidak dikirim. Barang tersimpan tidak pernah mengikuti kategori lagi.
    trackingChosen: item !== null,
    negativeStock:
        item?.refuse_negative_stock == null
            ? null
            : item.refuse_negative_stock
              ? ('refuse' as const)
              : ('allow' as const),
    isBlocked: item?.is_blocked ?? false,
});
type ItemForm = ReturnType<typeof formOf>;

const withCategory = (
    form: ItemForm,
    category: Reference & { tracking_code: Reference | null },
): ItemForm => ({
    ...form,
    hasCategory: true,
    category: referenceOf(category),
    ...(form.trackingChosen
        ? {}
        : {
              hasTracking: category.tracking_code !== null,
              trackingCode: referenceOf(category.tracking_code),
          }),
});

export function ItemCard({
    record,
    canManage,
    onSaved,
    onClose,
    onBusyChange,
    onDirtyChange,
}: {
    record: Item | null;
    canManage: boolean;
    onSaved: (row: Item) => void;
    onClose: () => void;
    // Halaman yang menjaga perubahan belum disimpan saat kartu ditutup atau berganti record.
    onBusyChange?: (busy: boolean) => void;
    onDirtyChange?: (dirty: boolean) => void;
}): ReactNode {
    const editing = canManage;
    // Sama dengan server: profil pelacakan terkunci sejak gerak stok pertama, satuan dasar hanya selama masih ada sisa.
    const trackingLocked = record?.has_entries ?? false;
    const unitLocked = record?.has_open_entries ?? false;
    const [form, setForm] = useState(() => formOf(record));
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const [lastAction, setLastAction] = useState<'save' | 'delete'>('save');
    const [creating, setCreating] = useState<Creating | null>(null);
    const [factBoxToolbar, setFactBoxToolbar] = useState<HTMLDivElement | null>(
        null,
    );
    const { confirm, confirmation } = useConfirmation();
    const idPrefix = useId();
    // Popup pilihan dipasang di dalam kartu, karena pemanggil tidak selalu memberi ref isi dialognya.
    const portalContainer = useRef<HTMLDivElement>(null);
    const dirty = JSON.stringify(form) !== JSON.stringify(formOf(record));
    useEffect(() => {
        onDirtyChange?.(dirty);
    }, [dirty, onDirtyChange]);
    useEffect(() => {
        onBusyChange?.(busy);
    }, [busy, onBusyChange]);
    useEffect(
        () => () => {
            onDirtyChange?.(false);
            onBusyChange?.(false);
        },
        [onDirtyChange, onBusyChange],
    );
    usePageDialogRecord({
        recordTitle: record ? `${record.code} ${record.name}` : 'Barang baru',
        editing,
        recordUrl: record
            ? `/sysadmin/inventory/items?item=${record.id}`
            : undefined,
    });

    const save = async () => {
        setLastAction('save');
        setBusy(true);
        setErrors({});
        setMessage(null);
        const missing: Record<string, string[]> = {};
        if (form.hasCategory && !form.category)
            missing.category_id = ['Pilih kategori.'];
        if (form.hasTracking && !form.trackingCode)
            missing.tracking_code_id = ['Pilih profil pelacakan.'];
        if (Object.keys(missing).length) {
            setErrors(missing);
            setBusy(false);
            return;
        }
        const body = {
            code: form.code,
            name: form.name,
            base_unit_id: form.baseUnit?.id ?? '',
            category_id: form.hasCategory ? (form.category?.id ?? null) : null,
            tracking_code_id: form.hasTracking
                ? (form.trackingCode?.id ?? null)
                : null,
            refuse_negative_stock:
                form.negativeStock === null
                    ? null
                    : form.negativeStock === 'refuse',
            is_blocked: form.isBlocked,
        };
        try {
            const { body: saved } = record
                ? await api.inventoryItemUpdate({
                      params: { id: record.id },
                      body: { ...body, version: record.version },
                  })
                : await api.inventoryItemCreate({ body });
            toast.success(record ? 'Barang diperbarui.' : 'Barang dibuat.');
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Barang belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!record) return;
        if (
            !(await confirm({
                title: `Delete barang ${record.code}?`,
                description:
                    'Barang ini tidak bisa dipilih lagi di dokumen stok.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        setLastAction('delete');
        setErrors({});
        setMessage(null);
        try {
            await api.inventoryItemDelete({
                params: { id: record.id },
                body: { version: record.version },
            });
            toast.success('Barang dihapus.');
            onClose();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Barang belum dihapus.'));
        } finally {
            setBusy(false);
        }
    };

    const created = (kind: Creating): { title: string; card: ReactNode } => {
        const close = () => setCreating(null);
        switch (kind) {
            case 'unit':
                return {
                    title: unitsOfMeasure.title,
                    card: (
                        <CodeEntryCard
                            source={unitsOfMeasure}
                            entry={null}
                            canManage
                            onSaved={(unit) => {
                                close();
                                setForm((current) => ({
                                    ...current,
                                    baseUnit: referenceOf(unit),
                                }));
                            }}
                            onClose={close}
                        />
                    ),
                };
            case 'category':
                return {
                    title: 'Kategori barang',
                    card: (
                        <ItemCategoryCard
                            record={null}
                            canManage
                            onSaved={(category) => {
                                close();
                                setForm((current) =>
                                    withCategory(current, category),
                                );
                            }}
                            onClose={close}
                        />
                    ),
                };
            case 'tracking':
                return {
                    title: 'Profil pelacakan',
                    card: (
                        <TrackingCodeCard
                            record={null}
                            canManage
                            onSaved={(trackingCode) => {
                                close();
                                setForm((current) => ({
                                    ...current,
                                    hasTracking: true,
                                    trackingCode: referenceOf(trackingCode),
                                    trackingChosen: true,
                                }));
                            }}
                            onClose={close}
                        />
                    ),
                };
            default: {
                const unknown: never = kind;
                throw new Error(`Unknown master: ${String(unknown)}`);
            }
        }
    };
    const nested = creating ? created(creating) : null;

    return (
        <div ref={portalContainer} className="flex min-h-0 flex-1 flex-col">
            <form
                noValidate
                className="flex min-h-0 flex-1 flex-col"
                onSubmit={(event) => {
                    event.preventDefault();
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
                                    if (!record) {
                                        onClose();
                                        return;
                                    }
                                    setForm(formOf(record));
                                    setErrors({});
                                    setMessage(null);
                                }}
                            />
                        </>
                    )}
                    {record && canManage && (
                        <ActionButton
                            action="archive"
                            disabled={busy}
                            onClick={() => void remove()}
                        />
                    )}
                    <div
                        ref={setFactBoxToolbar}
                        className="ms-auto flex items-center gap-1"
                    />
                </PageDialogToolbar>
                <FormErrorHeader
                    errors={errors}
                    message={message}
                    operation={
                        lastAction === 'delete'
                            ? 'Barang belum dihapus'
                            : 'Barang belum disimpan'
                    }
                />
                <PageDialogBody className="py-3">
                    <FactBox
                        toolbarContainer={factBoxToolbar}
                        details={<ItemStock item={record} canLeave={!dirty} />}
                    >
                        <CollapsibleSectionGroup
                            defaultValue={['general', 'inventory']}
                        >
                            <CollapsibleSection
                                value="general"
                                title="Umum"
                                summary={[
                                    form.baseUnit?.code,
                                    form.hasCategory
                                        ? form.category?.name
                                        : null,
                                    form.isBlocked ? 'Diblokir' : null,
                                ]
                                    .filter(Boolean)
                                    .join(' · ')}
                            >
                                <FormGrid>
                                    <FormControl error={errors.code?.[0]}>
                                        <Input
                                            label="Kode"
                                            required
                                            maxLength={20}
                                            data-error-field="code"
                                            value={form.code}
                                            readOnly={!editing}
                                            onChange={(event) =>
                                                setForm({
                                                    ...form,
                                                    code: event.target.value,
                                                })
                                            }
                                        />
                                    </FormControl>
                                    <FormControl error={errors.name?.[0]}>
                                        <Input
                                            label="Nama"
                                            required
                                            maxLength={200}
                                            data-error-field="name"
                                            value={form.name}
                                            readOnly={!editing}
                                            onChange={(event) =>
                                                setForm({
                                                    ...form,
                                                    name: event.target.value,
                                                })
                                            }
                                        />
                                    </FormControl>
                                    <UnitOfMeasureLookup
                                        label="Satuan dasar"
                                        required
                                        field="base_unit_id"
                                        value={form.baseUnit}
                                        onChange={(unit) =>
                                            setForm({
                                                ...form,
                                                baseUnit: referenceOf(unit),
                                            })
                                        }
                                        disabled={!editing || unitLocked}
                                        error={errors.base_unit_id?.[0]}
                                        hint={
                                            unitLocked
                                                ? 'Tidak bisa diganti karena barang ini masih punya stok atau kekurangan stok yang belum tertutup.'
                                                : 'Satuan untuk mencatat stok barang ini. Tidak bisa diganti selama barang ini masih punya stok.'
                                        }
                                        portalContainer={portalContainer}
                                        onCreate={
                                            editing && !unitLocked
                                                ? () => setCreating('unit')
                                                : undefined
                                        }
                                    />
                                    <FormControl
                                        error={errors.is_blocked?.[0]}
                                        hint="Barang yang diblokir tidak bisa dipilih di dokumen stok baru."
                                        data-error-field="is_blocked"
                                    >
                                        <Field
                                            orientation="horizontal"
                                            className="w-auto"
                                        >
                                            <Switch
                                                id={`${idPrefix}-blocked`}
                                                checked={form.isBlocked}
                                                disabled={!editing}
                                                onCheckedChange={(isBlocked) =>
                                                    setForm({
                                                        ...form,
                                                        isBlocked,
                                                    })
                                                }
                                            />
                                            <FieldLabel
                                                htmlFor={`${idPrefix}-blocked`}
                                                className="font-normal"
                                            >
                                                Diblokir
                                            </FieldLabel>
                                        </Field>
                                    </FormControl>
                                    <FormControl>
                                        <Field
                                            orientation="horizontal"
                                            className="w-auto"
                                        >
                                            <Switch
                                                id={`${idPrefix}-has-category`}
                                                checked={form.hasCategory}
                                                disabled={!editing}
                                                onCheckedChange={(
                                                    hasCategory,
                                                ) =>
                                                    setForm({
                                                        ...form,
                                                        hasCategory,
                                                    })
                                                }
                                            />
                                            <FieldLabel
                                                htmlFor={`${idPrefix}-has-category`}
                                                className="font-normal"
                                            >
                                                Pakai kategori
                                            </FieldLabel>
                                        </Field>
                                    </FormControl>
                                    {form.hasCategory && (
                                        <ItemCategoryLookup
                                            label="Kategori"
                                            required
                                            field="category_id"
                                            value={form.category}
                                            onChange={(category) =>
                                                setForm(
                                                    withCategory(
                                                        form,
                                                        category,
                                                    ),
                                                )
                                            }
                                            disabled={!editing}
                                            error={errors.category_id?.[0]}
                                            portalContainer={portalContainer}
                                            onCreate={
                                                editing
                                                    ? () =>
                                                          setCreating(
                                                              'category',
                                                          )
                                                    : undefined
                                            }
                                        />
                                    )}
                                </FormGrid>
                            </CollapsibleSection>
                            <CollapsibleSection
                                value="inventory"
                                title="Persediaan"
                                summary={[
                                    form.hasTracking && form.trackingCode
                                        ? form.trackingCode.name
                                        : 'Tanpa profil pelacakan',
                                    form.negativeStock
                                        ? negativeStockSummary[
                                              form.negativeStock
                                          ]
                                        : 'Stok minus mengikuti setelan persediaan',
                                ].join(' · ')}
                            >
                                <FormGrid>
                                    <FormControl
                                        hint={
                                            trackingLocked
                                                ? 'Tidak bisa diganti karena barang ini sudah punya gerak stok.'
                                                : 'Batch dan tanggal kedaluwarsa yang wajib dicatat saat stok barang ini masuk. Barang baru memakai profil kategorinya sampai Anda memilih sendiri.'
                                        }
                                    >
                                        <Field
                                            orientation="horizontal"
                                            className="w-auto"
                                        >
                                            <Switch
                                                id={`${idPrefix}-has-tracking`}
                                                checked={form.hasTracking}
                                                disabled={
                                                    !editing || trackingLocked
                                                }
                                                onCheckedChange={(
                                                    hasTracking,
                                                ) =>
                                                    setForm({
                                                        ...form,
                                                        hasTracking,
                                                        trackingChosen: true,
                                                    })
                                                }
                                            />
                                            <FieldLabel
                                                htmlFor={`${idPrefix}-has-tracking`}
                                                className="font-normal"
                                            >
                                                Pakai profil pelacakan
                                            </FieldLabel>
                                        </Field>
                                    </FormControl>
                                    {form.hasTracking && (
                                        <TrackingCodeLookup
                                            label="Profil pelacakan"
                                            required
                                            field="tracking_code_id"
                                            value={form.trackingCode}
                                            onChange={(trackingCode) =>
                                                setForm({
                                                    ...form,
                                                    trackingCode:
                                                        referenceOf(
                                                            trackingCode,
                                                        ),
                                                    trackingChosen: true,
                                                })
                                            }
                                            disabled={
                                                !editing || trackingLocked
                                            }
                                            error={errors.tracking_code_id?.[0]}
                                            portalContainer={portalContainer}
                                            onCreate={
                                                editing && !trackingLocked
                                                    ? () =>
                                                          setCreating(
                                                              'tracking',
                                                          )
                                                    : undefined
                                            }
                                        />
                                    )}
                                    <FormControl
                                        error={
                                            errors.refuse_negative_stock?.[0]
                                        }
                                        hint="Ikuti setelan persediaan memakai setelan legal entity yang aktif. Mutasi antarlokasi selalu ditolak bila stoknya tidak cukup."
                                        data-error-field="refuse_negative_stock"
                                    >
                                        <PolicySelect
                                            label="Stok minus"
                                            labels={negativeStockLabels}
                                            inherit="Ikuti setelan persediaan"
                                            value={form.negativeStock}
                                            editing={editing}
                                            onChange={(negativeStock) =>
                                                setForm({
                                                    ...form,
                                                    negativeStock,
                                                })
                                            }
                                            portalContainer={portalContainer}
                                        />
                                    </FormControl>
                                </FormGrid>
                            </CollapsibleSection>
                            <CollapsibleSection
                                value="stockkeeping-units"
                                title="Stok minimum dan maksimum per lokasi"
                                summary="Stok maksimum menjadi stok optimum di LPLPO"
                            >
                                <StockkeepingUnits item={record} />
                            </CollapsibleSection>
                        </CollapsibleSectionGroup>
                    </FactBox>
                </PageDialogBody>
                {confirmation}
            </form>
            {nested && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setCreating(null);
                    }}
                >
                    <PageDialogContent title={nested.title}>
                        {nested.card}
                    </PageDialogContent>
                </PageDialog>
            )}
        </div>
    );
}
