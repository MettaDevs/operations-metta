import { ActionButton } from '@operations-metta/ui/action-button';
import {
    CollapsibleSection,
    CollapsibleSectionGroup,
} from '@operations-metta/ui/collapsible-section';
import { DatePicker, displayDate } from '@operations-metta/ui/date-picker';
import {
    displayNumber,
    parseDisplayNumber,
} from '@operations-metta/ui/display-number';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
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
import { useQuery } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    orpc,
    type ApiBody,
} from '@core/platform/shell/index.ts';
import { GradingGroupCard } from '../grading-group/grading-group-card.tsx';
import { GradingGroupLookup } from '../grading-group/grading-group-lookup.tsx';

export type DrugPrice = ApiBody<'pharmacyDrugPriceList'>['data'][number];
type PriceGroup = ApiBody<'pharmacyDrugPriceMetadata'>['price_groups'][number];

const today = () => new Date().toLocaleDateString('sv');

const formOf = (row: DrugPrice | null) => ({
    priceGroupId: row?.price_group.id ?? null,
    // Baris grading boleh berlaku untuk semua barang; pilihan rujukan tidak bisa dikosongkan, jadi kelompok grading
    // dibuka lewat saklar.
    hasGradingGroup: row ? row.grading_group !== null : true,
    gradingGroup: row?.grading_group ?? null,
    ktpPatient: row?.ktp_patient ?? true,
    priceFrom: displayNumber(row?.price_from ?? '0'),
    priceTo: displayNumber(row?.price_to ?? '1000000000'),
    markupPercent: row ? displayNumber(row.markup_percent) : '',
    discountPercent: displayNumber(row?.discount_percent ?? '0'),
    effectiveFrom: row?.effective_from ?? today(),
});
type PriceForm = ReturnType<typeof formOf>;

const typed = (text: string) => parseDisplayNumber(text) ?? text;

// Kartu satu baris grading harga obat (SIMmGradingHargaObat sistem lama): untuk pembeli berkelompok harga ini dengan
// Patient KTP ini dan obat berkelompok grading ini (atau semua obat), dengan harga dasar di rentang ini, harga jual naik
// sekian persen mulai tanggal berlakunya.
export function DrugPriceCard({
    record,
    canManage,
    onSaved,
    onClose,
}: {
    record: DrugPrice | null;
    canManage: boolean;
    onSaved: (row: DrugPrice) => void;
    onClose: () => void;
}): ReactNode {
    const [form, setForm] = useState<PriceForm>(() => formOf(record));
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const [lastAction, setLastAction] = useState<'save' | 'delete'>('save');
    const [creatingGroup, setCreatingGroup] = useState(false);
    const { confirm, confirmation } = useConfirmation();
    const gradingSwitchId = useId();
    const ktpSwitchId = useId();
    const portalContainer = useRef<HTMLDivElement>(null);
    const dirty = JSON.stringify(form) !== JSON.stringify(formOf(record));
    const { data: metadata } = useQuery(
        orpc.pharmacyDrugPriceMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const priceGroups = (metadata?.price_groups ?? []).filter(
        (group) => group.active || group.id === record?.price_group.id,
    );
    const priceGroup: PriceGroup | null =
        priceGroups.find((group) => group.id === form.priceGroupId) ?? null;
    usePageDialogRecord({
        recordTitle: record
            ? `${record.price_group.name} · ${record.grading_group?.name ?? 'Semua barang'}`
            : 'Grading harga obat baru',
        editing: canManage,
        dirty,
    });

    const run = async (
        action: 'save' | 'delete',
        request: () => Promise<void>,
        failed: string,
    ) => {
        setLastAction(action);
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            await request();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, failed));
        } finally {
            setBusy(false);
        }
    };

    const save = async () => {
        if (form.hasGradingGroup && !form.gradingGroup) {
            setLastAction('save');
            setErrors({ grading_group_id: ['Pilih kelompok grading.'] });
            return;
        }
        const body = {
            price_group_id: form.priceGroupId ?? '',
            grading_group_id: form.hasGradingGroup
                ? (form.gradingGroup?.id ?? null)
                : null,
            ktp_patient: form.ktpPatient,
            price_from: typed(form.priceFrom),
            price_to: typed(form.priceTo),
            markup_percent: typed(form.markupPercent),
            discount_percent: typed(form.discountPercent),
            effective_from: form.effectiveFrom,
        };
        await run(
            'save',
            async () => {
                const { body: saved } = record
                    ? await api.pharmacyDrugPriceUpdate({
                          params: { id: record.id },
                          body: { ...body, version: record.version },
                      })
                    : await api.pharmacyDrugPriceCreate({ body });
                toast.success(
                    record
                        ? 'Grading harga obat diperbarui.'
                        : 'Grading harga obat dibuat.',
                );
                onSaved(saved.data);
            },
            'Grading harga obat belum disimpan.',
        );
    };

    const remove = async () => {
        if (!record) return;
        if (
            !(await confirm({
                title: 'Delete grading harga obat ini?',
                description:
                    'Penyerahan berikutnya tidak lagi memakai baris ini. Harga penyerahan yang sudah disiapkan tidak berubah.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        await run(
            'delete',
            async () => {
                await api.pharmacyDrugPriceDelete({
                    params: { id: record.id },
                    body: { version: record.version },
                });
                toast.success('Grading harga obat dihapus.');
                onClose();
            },
            'Grading harga obat belum dihapus.',
        );
    };

    const amount = (
        field: 'priceFrom' | 'priceTo' | 'markupPercent' | 'discountPercent',
        name: string,
        label: string,
        hint?: string,
    ) => (
        <FormControl error={errors[name]?.[0]} hint={hint}>
            <Input
                label={label}
                required
                inputMode="decimal"
                data-error-field={name}
                value={form[field]}
                readOnly={!canManage}
                onChange={(event) =>
                    setForm({ ...form, [field]: event.target.value })
                }
            />
        </FormControl>
    );

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
                    {canManage && (
                        <>
                            <ActionButton
                                action="save"
                                type="submit"
                                disabled={busy}
                                pending={busy && lastAction === 'save'}
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
                </PageDialogToolbar>
                <FormErrorHeader
                    errors={errors}
                    message={message}
                    operation={
                        lastAction === 'delete'
                            ? 'Grading harga obat belum dihapus'
                            : 'Grading harga obat belum disimpan'
                    }
                />
                <PageDialogBody className="py-3">
                    <CollapsibleSectionGroup defaultValue={['scope', 'price']}>
                        <CollapsibleSection
                            value="scope"
                            title="Berlaku untuk"
                            summary={[
                                priceGroup?.name,
                                form.hasGradingGroup
                                    ? form.gradingGroup?.name
                                    : 'Semua barang',
                                form.ktpPatient
                                    ? 'Patient KTP'
                                    : 'Bukan Patient KTP',
                                `mulai ${displayDate(form.effectiveFrom)}`,
                            ]
                                .filter(Boolean)
                                .join(' · ')}
                        >
                            <FormGrid>
                                <FormControl
                                    error={errors.price_group_id?.[0]}
                                    data-error-field="price_group_id"
                                    hint="Kelompok harga pembeli, dari tipe pasien kunjungan resepnya."
                                >
                                    <InlineLookup
                                        label="Kelompok harga"
                                        required
                                        disabled={!canManage}
                                        items={priceGroups}
                                        value={priceGroup}
                                        displayValue={priceGroup?.name ?? ''}
                                        onValueChange={(item) =>
                                            setForm({
                                                ...form,
                                                priceGroupId: item.id,
                                            })
                                        }
                                        getItemValue={(item) => item.id}
                                        getItemLabel={(item) => item.name}
                                        getSearchText={(item) =>
                                            `${item.code} ${item.name}`
                                        }
                                        placeholder="Cari kelompok harga..."
                                        emptyMessage="Kelompok harga tidak ditemukan. Tambahkan di Sys Admin, menu Harga."
                                        showDetails={false}
                                        showFullList={false}
                                        portalContainer={portalContainer}
                                        columns={[
                                            {
                                                id: 'code',
                                                header: 'Kode',
                                                width: 120,
                                                cell: (item) => item.code,
                                            },
                                            {
                                                id: 'name',
                                                header: 'Nama',
                                                width: 220,
                                                cell: (item) => item.name,
                                            },
                                        ]}
                                    />
                                </FormControl>
                                <FormControl hint="Matikan untuk grading yang berlaku bagi semua obat. Obat yang kelompoknya punya grading sendiri memakai grading kelompoknya lebih dulu.">
                                    <Field
                                        orientation="horizontal"
                                        className="w-auto"
                                    >
                                        <Switch
                                            id={gradingSwitchId}
                                            checked={form.hasGradingGroup}
                                            disabled={!canManage}
                                            onCheckedChange={(
                                                hasGradingGroup,
                                            ) =>
                                                setForm({
                                                    ...form,
                                                    hasGradingGroup,
                                                })
                                            }
                                        />
                                        <FieldLabel
                                            htmlFor={gradingSwitchId}
                                            className="font-normal"
                                        >
                                            Hanya satu kelompok grading
                                        </FieldLabel>
                                    </Field>
                                </FormControl>
                                {form.hasGradingGroup && (
                                    <GradingGroupLookup
                                        required
                                        value={form.gradingGroup}
                                        onChange={(gradingGroup) =>
                                            setForm({ ...form, gradingGroup })
                                        }
                                        disabled={!canManage}
                                        error={errors.grading_group_id?.[0]}
                                        portalContainer={portalContainer}
                                        onCreate={
                                            canManage
                                                ? () => setCreatingGroup(true)
                                                : undefined
                                        }
                                    />
                                )}
                                <FormControl hint="Nyala untuk pasien yang memegang KTP setempat, mati untuk yang tidak. Grading ini hanya dipakai resep pasien dengan isian Patient KTP yang sama; pasien yang tidak punya grading untuk isiannya memakai grading semua barang untuk isian itu, lalu harga dasar.">
                                    <Field
                                        orientation="horizontal"
                                        className="w-auto"
                                    >
                                        <Switch
                                            id={ktpSwitchId}
                                            checked={form.ktpPatient}
                                            disabled={!canManage}
                                            onCheckedChange={(ktpPatient) =>
                                                setForm({ ...form, ktpPatient })
                                            }
                                        />
                                        <FieldLabel
                                            htmlFor={ktpSwitchId}
                                            className="font-normal"
                                        >
                                            Patient KTP
                                        </FieldLabel>
                                    </Field>
                                </FormControl>
                                <FormControl
                                    error={errors.effective_from?.[0]}
                                    hint="Penyerahan pada tanggal ini atau sesudahnya memakai grading ini, sampai ada grading yang berlaku lebih baru."
                                >
                                    <DatePicker
                                        label="Berlaku mulai"
                                        required
                                        data-error-field="effective_from"
                                        value={form.effectiveFrom}
                                        readOnly={!canManage}
                                        onValueChange={(effectiveFrom) =>
                                            setForm({ ...form, effectiveFrom })
                                        }
                                        portalContainer={portalContainer}
                                    />
                                </FormControl>
                            </FormGrid>
                        </CollapsibleSection>
                        <CollapsibleSection
                            value="price"
                            title="Harga"
                            summary={`naik ${form.markupPercent || '0'}% · diskon ${form.discountPercent || '0'}%`}
                        >
                            <FormGrid>
                                {amount(
                                    'priceFrom',
                                    'price_from',
                                    'Harga dasar dari',
                                    'Rentang harga dasar obat per satuan dasar. Kedua batas termasuk.',
                                )}
                                {amount(
                                    'priceTo',
                                    'price_to',
                                    'Harga dasar sampai',
                                )}
                                {amount(
                                    'markupPercent',
                                    'markup_percent',
                                    '% naik',
                                    'Harga jual = harga dasar x (1 + % naik / 100), dibulatkan menurut Setelan farmasi.',
                                )}
                                {amount(
                                    'discountPercent',
                                    'discount_percent',
                                    '% diskon',
                                    'Diskon baris penyerahan. Harga satuan tidak berkurang; nilainya yang dipotong.',
                                )}
                            </FormGrid>
                        </CollapsibleSection>
                    </CollapsibleSectionGroup>
                </PageDialogBody>
                {confirmation}
            </form>
            {creatingGroup && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setCreatingGroup(false);
                    }}
                >
                    <PageDialogContent title="Kelompok grading">
                        <GradingGroupCard
                            record={null}
                            canManage
                            onSaved={(group) => {
                                setCreatingGroup(false);
                                setForm((current) => ({
                                    ...current,
                                    hasGradingGroup: true,
                                    gradingGroup: {
                                        id: group.id,
                                        name: group.name,
                                    },
                                }));
                            }}
                            onClose={() => setCreatingGroup(false)}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
        </div>
    );
}
