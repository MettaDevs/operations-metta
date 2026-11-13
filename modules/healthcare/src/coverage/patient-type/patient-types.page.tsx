import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import {
    Field,
    FieldDescription,
    FieldLabel,
} from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import { Input } from '@operations-metta/ui/input';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import {
    PageDialog,
    PageDialogBody,
    PageDialogContent,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { Select } from '@operations-metta/ui/select';
import { Switch } from '@operations-metta/ui/switch';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
    api,
    ApiError,
    definePage,
    errorText,
    FormErrorHeader,
    orpc,
    type ApiBody,
} from '@core/platform/shell/index.ts';
import {
    isProcedureTariff,
    procedureTariffs,
} from '../../clinical/procedure/procedure-price.options.ts';
import {
    isPatientTypeBehavior,
    patientTypeBehaviors,
    type PatientTypeBehavior,
} from './patient-type.behaviors.ts';

// Tipe pasien (Umum, BPJS, Asuransi, Perusahaan, dan seterusnya), master kecil per tenant dengan kode pendek.
// "Memakai penjamin" memunculkan isian penjamin dan nomor kartu di cara bayar pasien.

const route = getRouteApi('/_app/healthcare/coverage/patient-types');
// Nama perilaku di layar. Daftar perilakunya katalog kode (patient-type.behaviors.ts); yang dinyalakan tiap tipe
// pasien adalah data.
const behaviorLabels: Record<PatientTypeBehavior, string> = {
    requires_guarantor: 'Perlu perusahaan penjamin',
    requires_card_number: 'Perlu nomor kartu asuransi',
};
type PatientType = ApiBody<'healthcarePatientTypeList'>['data'][number];
type PriceGroup =
    ApiBody<'healthcarePatientTypeMetadata'>['price_groups'][number];
type Errors = Record<string, string[]>;
const tariffItems = Object.entries(procedureTariffs).map(([value, label]) => ({
    value,
    label,
}));
// Pilihan "Sama dengan kelompok harga" di Kelompok harga tarif jasa, dikirim kosong: tarif dicari di kelompok harga tipe
// itu sendiri.
const SAME_PRICE_GROUP = '__same__';
const searchSchema = z.object({ q: z.string().max(200).optional() });

function PatientTypeCard({
    type,
    canManage,
    onSaved,
    onClose,
}: {
    type: PatientType | null;
    canManage: boolean;
    onSaved: (type: PatientType) => void;
    onClose: () => void;
}): ReactNode {
    // Tipe pasien tersimpan langsung terbuka untuk diubah bila pengguna berhak mengubahnya.
    const editing = type === null || canManage;
    const blank = {
        code: type?.code ?? '',
        name: type?.name ?? '',
        behaviors: type?.behaviors ?? [],
        // Tipe baru langsung aktif.
        is_active: type?.is_active ?? true,
        is_default: type?.is_default ?? false,
        max_visits_per_section_per_day: String(
            type?.max_visits_per_section_per_day ?? 0,
        ),
        // Kelompok harga boleh kosong; pilihan rujukan tidak bisa dikosongkan, jadi ia dibuka lewat saklar.
        has_price_group: (type?.price_group_id ?? null) !== null,
        price_group_id: type?.price_group_id ?? null,
        procedure_tariff: type?.procedure_tariff ?? 'general',
        procedure_tariff_price_group_id:
            type?.procedure_tariff_price_group_id ?? null,
    };
    const [form, setForm] = useState(blank);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    const priceGroupSwitchId = useId();
    // Popup pilihan kelompok harga dipasang di dalam kartu, supaya bisa dipilih dari dalam dialog.
    const portalContainer = useRef<HTMLFormElement>(null);
    const { data: metadata } = useQuery(
        orpc.healthcarePatientTypeMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    usePageDialogRecord({
        recordTitle: type ? `${type.code} · ${type.name}` : 'Tipe pasien baru',
        editing,
    });
    const priceGroups = (metadata?.price_groups ?? []).filter(
        (group) => group.active || group.id === type?.price_group_id,
    );
    const priceGroup: PriceGroup | null =
        priceGroups.find((group) => group.id === form.price_group_id) ??
        (form.price_group_id !== null &&
        form.price_group_id === type?.price_group_id
            ? {
                  id: form.price_group_id,
                  code: '',
                  name: type.price_group_name ?? '',
                  active: false,
              }
            : null);
    const tariffPriceGroups = [
        { value: SAME_PRICE_GROUP, label: 'Sama dengan kelompok harga' },
        ...(metadata?.price_groups ?? [])
            .filter(
                (group) =>
                    group.active ||
                    group.id === type?.procedure_tariff_price_group_id,
            )
            .map((group) => ({ value: group.id, label: group.name })),
    ];
    const tariffLabel = isProcedureTariff(form.procedure_tariff)
        ? procedureTariffs[form.procedure_tariff]
        : form.procedure_tariff;
    const tariffPriceGroupLabel =
        tariffPriceGroups.find(
            (item) =>
                item.value ===
                (form.procedure_tariff_price_group_id ?? SAME_PRICE_GROUP),
        )?.label ??
        type?.procedure_tariff_price_group_name ??
        '';
    const { has_price_group: hasPriceGroup, ...fields } = form;
    const payload = {
        ...fields,
        price_group_id: hasPriceGroup ? (form.price_group_id ?? '') : null,
    };

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body } = type
                ? await api.healthcarePatientTypeUpdate({
                      params: { id: type.id },
                      body: { ...payload, version: type.version },
                  })
                : await api.healthcarePatientTypeCreate({ body: payload });
            toast.success(
                type ? 'Tipe pasien diperbarui.' : 'Tipe pasien dibuat.',
            );
            onSaved(body.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Tipe pasien belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!type) return;
        if (
            !(await confirm({
                title: `Delete tipe pasien ${type.name}?`,
                description:
                    'Tipe pasien tidak bisa dipilih lagi. Cara bayar pasien yang sudah memakainya tetap tersimpan.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        try {
            await api.healthcarePatientTypeDelete({
                params: { id: type.id },
                body: { version: type.version },
            });
            toast.success('Tipe pasien dihapus.');
            onClose();
        } catch (caught) {
            setMessage(errorText(caught, 'Tipe pasien belum dihapus.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <form
            ref={portalContainer}
            noValidate
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
                event.preventDefault();
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
                                if (!type) {
                                    onClose();
                                    return;
                                }
                                setForm(blank);
                                setErrors({});
                            }}
                        />
                    </>
                )}
                {type && canManage && (
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
                operation="Tipe pasien belum disimpan"
            />
            <PageDialogBody className="py-3">
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
                                setForm({ ...form, code: event.target.value })
                            }
                        />
                    </FormControl>
                    <FormControl error={errors.name?.[0]}>
                        <Input
                            label="Nama"
                            required
                            maxLength={100}
                            data-error-field="name"
                            value={form.name}
                            readOnly={!editing}
                            onChange={(event) =>
                                setForm({ ...form, name: event.target.value })
                            }
                        />
                    </FormControl>
                    <FormControl hint="Kelompok harga menentukan tarif pasien bertipe ini. Beberapa tipe pasien boleh memakai kelompok yang sama.">
                        <Field orientation="horizontal" className="w-auto">
                            <Switch
                                id={priceGroupSwitchId}
                                checked={form.has_price_group}
                                disabled={!editing}
                                onCheckedChange={(checked) =>
                                    setForm({
                                        ...form,
                                        has_price_group: checked,
                                    })
                                }
                            />
                            <FieldLabel htmlFor={priceGroupSwitchId}>
                                Pakai kelompok harga
                            </FieldLabel>
                        </Field>
                    </FormControl>
                    {form.has_price_group && (
                        <FormControl
                            error={errors.price_group_id?.[0]}
                            data-error-field="price_group_id"
                        >
                            <InlineLookup
                                label="Kelompok harga"
                                required
                                disabled={!editing}
                                items={priceGroups}
                                value={priceGroup}
                                displayValue={priceGroup?.name ?? ''}
                                onValueChange={(item) =>
                                    setForm({
                                        ...form,
                                        price_group_id: item.id,
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
                    )}
                    <FormControl
                        error={errors.procedure_tariff?.[0]}
                        data-error-field="procedure_tariff"
                        hint="Cara mencari tarif tindakan untuk pasien bertipe ini. Tarif umum memakai Harga Baru, tarif BPJS memakai Harga Baru BPJS. Pilihan yang menyebut tanpa tarif lain tidak mengambil tarif kelas, dokter, atau kelompok harga lain bila tidak ada yang cocok, sehingga tindakan tampil tanpa harga."
                    >
                        {editing ? (
                            <Select
                                label="Tarif jasa"
                                required
                                items={tariffItems}
                                value={form.procedure_tariff}
                                onValueChange={(value) =>
                                    setForm({
                                        ...form,
                                        procedure_tariff: value ?? 'general',
                                    })
                                }
                                searchPlaceholder="Cari tarif jasa"
                                emptyMessage="Pilihan tidak ditemukan."
                                portalContainer={portalContainer}
                            />
                        ) : (
                            <Input
                                label="Tarif jasa"
                                value={tariffLabel}
                                readOnly
                            />
                        )}
                    </FormControl>
                    {form.procedure_tariff !== 'none' && (
                        <FormControl
                            error={errors.procedure_tariff_price_group_id?.[0]}
                            data-error-field="procedure_tariff_price_group_id"
                            hint="Kelompok harga yang tarif tindakannya dipakai pasien bertipe ini, misalnya tipe BPJS yang memakai tarif kelompok Umum. Harga obat tetap mengikuti kelompok harga di atas."
                        >
                            {editing ? (
                                <Select
                                    label="Kelompok harga tarif jasa"
                                    items={tariffPriceGroups}
                                    value={
                                        form.procedure_tariff_price_group_id ??
                                        SAME_PRICE_GROUP
                                    }
                                    onValueChange={(value) =>
                                        setForm({
                                            ...form,
                                            procedure_tariff_price_group_id:
                                                value === null ||
                                                value === SAME_PRICE_GROUP
                                                    ? null
                                                    : value,
                                        })
                                    }
                                    searchPlaceholder="Cari kelompok harga"
                                    emptyMessage="Kelompok harga tidak ditemukan. Tambahkan di Sys Admin, menu Harga."
                                    portalContainer={portalContainer}
                                />
                            ) : (
                                <Input
                                    label="Kelompok harga tarif jasa"
                                    value={tariffPriceGroupLabel}
                                    readOnly
                                />
                            )}
                        </FormControl>
                    )}
                    <FormControl
                        error={errors.max_visits_per_section_per_day?.[0]}
                        hint="Berapa kali pasien bertipe ini boleh didaftarkan ke poli yang sama dalam satu hari. Isi 0 bila tidak dibatasi."
                    >
                        <Input
                            label="Maks. kunjungan per poli per hari"
                            required
                            inputMode="numeric"
                            maxLength={3}
                            data-error-field="max_visits_per_section_per_day"
                            value={form.max_visits_per_section_per_day}
                            readOnly={!editing}
                            onChange={(event) =>
                                setForm({
                                    ...form,
                                    max_visits_per_section_per_day:
                                        event.target.value,
                                })
                            }
                        />
                    </FormControl>
                    {patientTypeBehaviors.map((behavior) => (
                        <Field
                            key={behavior}
                            orientation="horizontal"
                            className="w-auto"
                        >
                            <Switch
                                id={`patient-type-${behavior}`}
                                checked={form.behaviors.includes(behavior)}
                                disabled={!editing}
                                onCheckedChange={(checked) =>
                                    setForm({
                                        ...form,
                                        behaviors: checked
                                            ? [...form.behaviors, behavior]
                                            : form.behaviors.filter(
                                                  (item) => item !== behavior,
                                              ),
                                    })
                                }
                            />
                            <FieldLabel htmlFor={`patient-type-${behavior}`}>
                                {behaviorLabels[behavior]}
                            </FieldLabel>
                        </Field>
                    ))}
                    <Field orientation="horizontal" className="w-auto">
                        <Switch
                            id="patient-type-active"
                            checked={form.is_active}
                            disabled={!editing}
                            onCheckedChange={(checked) =>
                                setForm({ ...form, is_active: checked })
                            }
                        />
                        <FieldLabel htmlFor="patient-type-active">
                            Aktif
                        </FieldLabel>
                    </Field>
                    <Field orientation="horizontal" className="w-auto">
                        <Switch
                            id="patient-type-default"
                            checked={form.is_default}
                            disabled={!editing}
                            onCheckedChange={(checked) =>
                                setForm({ ...form, is_default: checked })
                            }
                        />
                        <FieldLabel htmlFor="patient-type-default">
                            Bawaan pasien baru
                        </FieldLabel>
                    </Field>
                    {editing && form.is_default && (
                        <FieldDescription>
                            Pasien baru otomatis memakai tipe ini. Tipe lain
                            yang sebelumnya bawaan dilepas saat disimpan.
                        </FieldDescription>
                    )}
                </FormGrid>
            </PageDialogBody>
            {confirmation}
        </form>
    );
}

function PatientTypesPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [open, setOpen] = useState<PatientType | 'new' | null>(null);
    const [canManage, setCanManage] = useState(false);
    const loader = useCallback<ListLoader<PatientType>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.healthcarePatientTypeList(
                {
                    query: {
                        q: query,
                        ...(cursor ? { cursor } : {}),
                        ...(sort
                            ? { sort: sort.columnId, direction: sort.direction }
                            : {}),
                    },
                },
                { signal },
            );
            setCanManage(body.can_manage);
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (type) => type.id,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Tipe pasien"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: q ? { q } : {},
                                    replace: true,
                                }),
                            label: 'Cari tipe pasien',
                            placeholder: 'Cari kode atau nama...',
                        }}
                    >
                        {canManage && (
                            <ActionButton
                                action="create"
                                onClick={() => setOpen('new')}
                            />
                        )}
                    </RecordActionBar>
                }
                footer={
                    <p className="p-3 text-sm text-muted-foreground">
                        {list.items.length} tipe pasien dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(type) => type.id}
                    getRowLabel={(type) => type.name}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, type) => setOpen(type)}
                    onRowClick={(type) => setOpen(type)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        canManage
                            ? 'Belum ada tipe pasien. Pilih Baru untuk menambahkan tipe pasien yang dipakai klinik.'
                            : 'Belum ada tipe pasien.'
                    }
                    columns={[
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 120,
                            cell: (type) => (
                                <DataTableText>{type.code}</DataTableText>
                            ),
                            sortValue: (type) => type.code,
                        },
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 240,
                            cell: (type) => (
                                <DataTableText>{type.name}</DataTableText>
                            ),
                            sortValue: (type) => type.name,
                        },
                        {
                            id: 'behaviors',
                            header: 'Perilaku',
                            width: 300,
                            cell: (type) => (
                                <DataTableText>
                                    {type.behaviors
                                        .filter(isPatientTypeBehavior)
                                        .map(
                                            (behavior) =>
                                                behaviorLabels[behavior],
                                        )
                                        .join(', ') || '—'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'price-group',
                            header: 'Kelompok harga',
                            width: 180,
                            cell: (type) => (
                                <DataTableText>
                                    {type.price_group_name ?? '—'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'visit-limit',
                            header: 'Maks. per poli per hari',
                            width: 170,
                            cell: (type) => (
                                <DataTableText>
                                    {type.max_visits_per_section_per_day ||
                                        'Tanpa batas'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 110,
                            cell: (type) => (
                                <Badge
                                    variant={
                                        type.is_active ? 'secondary' : 'outline'
                                    }
                                >
                                    {type.is_active ? 'Aktif' : 'Nonaktif'}
                                    {type.is_default ? ' · Bawaan' : ''}
                                </Badge>
                            ),
                        },
                    ]}
                />
            </ListPageLayout>
            {open && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setOpen(null);
                    }}
                >
                    <PageDialogContent title="Tipe pasien">
                        <PatientTypeCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            type={open === 'new' ? null : open}
                            canManage={canManage}
                            onSaved={(type) => {
                                setOpen(type);
                                list.reload();
                            }}
                            onClose={() => {
                                setOpen(null);
                                list.reload();
                            }}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
        </>
    );
}

export const page = definePage({
    path: '/healthcare/coverage/patient-types',
    previousPaths: ['/healthcare/patient-types'],
    layout: 'app',
    title: 'Tipe pasien',
    validateSearch: searchSchema,
    component: PatientTypesPage,
});
