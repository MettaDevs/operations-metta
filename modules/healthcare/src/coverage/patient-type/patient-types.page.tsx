import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import {
    Field,
    FieldDescription,
    FieldLabel,
} from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
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
import { Switch } from '@operations-metta/ui/switch';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
    api,
    ApiError,
    definePage,
    errorText,
    FormErrorHeader,
    type ApiBody,
} from '@core/platform/shell/index.ts';
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
type Errors = Record<string, string[]>;
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
    };
    const [form, setForm] = useState(blank);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    usePageDialogRecord({
        recordTitle: type ? `${type.code} · ${type.name}` : 'Tipe pasien baru',
        editing,
    });

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body } = type
                ? await api.healthcarePatientTypeUpdate({
                      params: { id: type.id },
                      body: { ...form, version: type.version },
                  })
                : await api.healthcarePatientTypeCreate({ body: form });
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
