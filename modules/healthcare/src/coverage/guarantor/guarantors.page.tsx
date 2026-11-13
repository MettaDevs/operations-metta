import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import type { LookupLoader } from '@operations-metta/ui/inline-lookup';
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
import { useCallback, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
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

// Penjamin cara bayar pasien: organisasi di buku alamat (misalnya BPJS Kesehatan) yang menjamin satu tipe pasien.
// Nama penjamin adalah nama organisasinya, jadi setelah dibuat ia diubah di Buku alamat.

const route = getRouteApi('/_app/healthcare/coverage/guarantors');
type Guarantor = ApiBody<'healthcareGuarantorList'>['data'][number];
type PatientType = ApiBody<'healthcarePatientTypeList'>['data'][number];
type Errors = Record<string, string[]>;
const searchSchema = z.object({ q: z.string().max(200).optional() });

function GuarantorCard({
    guarantor,
    canManage,
    portalContainer,
    onSaved,
    onClose,
}: {
    guarantor: Guarantor | null;
    canManage: boolean;
    portalContainer: RefObject<HTMLElement | null>;
    onSaved: (guarantor: Guarantor) => void;
    onClose: () => void;
}): ReactNode {
    // Penjamin tersimpan langsung terbuka untuk diubah bila pengguna berhak mengubahnya.
    const editing = guarantor === null || canManage;
    const blank = {
        name: guarantor?.name ?? '',
        patient_type: guarantor
            ? {
                  id: guarantor.patient_type_id,
                  name: guarantor.patient_type_name,
              }
            : null,
        // Penjamin baru langsung aktif.
        is_active: guarantor?.is_active ?? true,
        is_default: guarantor?.is_default ?? false,
    };
    const [form, setForm] = useState(blank);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    usePageDialogRecord({
        recordTitle: guarantor?.name ?? 'Penjamin baru',
        editing,
    });
    const loader = useCallback<LookupLoader<PatientType>>(
        async ({ query, cursor, signal }) => {
            const { body } = await api.healthcarePatientTypeList(
                {
                    query: {
                        q: query,
                        active: '1',
                        ...(cursor ? { cursor } : {}),
                    },
                },
                { signal },
            );
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [],
    );

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        const patientTypeId = form.patient_type?.id ?? '';
        try {
            const { body } = guarantor
                ? await api.healthcareGuarantorUpdate({
                      params: { id: guarantor.id },
                      body: {
                          patient_type_id: patientTypeId,
                          is_active: form.is_active,
                          is_default: form.is_default,
                          version: guarantor.version,
                      },
                  })
                : await api.healthcareGuarantorCreate({
                      body: {
                          name: form.name,
                          patient_type_id: patientTypeId,
                          is_active: form.is_active,
                          is_default: form.is_default,
                      },
                  });
            toast.success(
                guarantor ? 'Penjamin diperbarui.' : 'Penjamin dibuat.',
            );
            onSaved(body.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Penjamin belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!guarantor) return;
        if (
            !(await confirm({
                title: `Delete penjamin ${guarantor.name}?`,
                description:
                    'Penjamin tidak bisa dipilih lagi untuk tipe pasien ini. Cara bayar pasien yang sudah memakainya tetap tersimpan, dan organisasinya tetap ada di buku alamat.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        try {
            await api.healthcareGuarantorDelete({
                params: { id: guarantor.id },
                body: { version: guarantor.version },
            });
            toast.success('Penjamin dihapus.');
            onClose();
        } catch (caught) {
            setMessage(errorText(caught, 'Penjamin belum dihapus.'));
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
                                if (!guarantor) {
                                    onClose();
                                    return;
                                }
                                setForm(blank);
                                setErrors({});
                            }}
                        />
                    </>
                )}
                {guarantor && canManage && (
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
                operation="Penjamin belum disimpan"
            />
            <PageDialogBody className="py-3">
                <FormGrid>
                    <FormControl
                        error={errors.name?.[0]}
                        hint={
                            guarantor
                                ? 'Nama organisasi diubah di Buku alamat, karena organisasinya bisa dipakai peran lain.'
                                : 'Organisasi baru dibuat di buku alamat dengan nama ini.'
                        }
                    >
                        <Input
                            label="Nama penjamin"
                            required
                            maxLength={200}
                            data-error-field="name"
                            value={form.name}
                            readOnly={!editing || guarantor !== null}
                            onChange={(event) =>
                                setForm({ ...form, name: event.target.value })
                            }
                        />
                    </FormControl>
                    <FormControl error={errors.patient_type_id?.[0]}>
                        {editing ? (
                            <InlineLookup
                                label="Tipe pasien"
                                required
                                loadItems={loader}
                                value={
                                    form.patient_type
                                        ? {
                                              ...form.patient_type,
                                              code: '',
                                              behaviors: [],
                                              is_active: true,
                                              is_default: false,
                                              max_visits_per_section_per_day: 0,
                                              price_group_id: null,
                                              price_group_name: null,
                                              version: 0,
                                          }
                                        : null
                                }
                                onValueChange={(type) =>
                                    setForm({
                                        ...form,
                                        patient_type: {
                                            id: type.id,
                                            name: type.name,
                                        },
                                    })
                                }
                                getItemValue={(item) => item.id}
                                getItemLabel={(item) => item.name}
                                placeholder="Cari tipe pasien…"
                                emptyMessage="Tipe pasien tidak ditemukan."
                                columns={[
                                    {
                                        id: 'code',
                                        header: 'Kode',
                                        cell: (item) => item.code,
                                    },
                                    {
                                        id: 'name',
                                        header: 'Nama',
                                        cell: (item) => item.name,
                                    },
                                ]}
                                portalContainer={portalContainer}
                                showDetails={false}
                            />
                        ) : (
                            <Input
                                label="Tipe pasien"
                                value={form.patient_type?.name ?? ''}
                                readOnly
                            />
                        )}
                    </FormControl>
                    <Field orientation="horizontal" className="w-auto">
                        <Switch
                            id="guarantor-active"
                            checked={form.is_active}
                            disabled={!editing}
                            onCheckedChange={(checked) =>
                                setForm({ ...form, is_active: checked })
                            }
                        />
                        <FieldLabel htmlFor="guarantor-active">
                            Aktif
                        </FieldLabel>
                    </Field>
                    <Field orientation="horizontal" className="w-auto">
                        <Switch
                            id="guarantor-default"
                            checked={form.is_default}
                            disabled={!editing}
                            onCheckedChange={(checked) =>
                                setForm({ ...form, is_default: checked })
                            }
                        />
                        <FieldLabel htmlFor="guarantor-default">
                            Bawaan untuk tipe pasien ini
                        </FieldLabel>
                    </Field>
                </FormGrid>
            </PageDialogBody>
            {confirmation}
        </form>
    );
}

function GuarantorsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const contentRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState<Guarantor | 'new' | null>(null);
    const [canManage, setCanManage] = useState(false);
    const loader = useCallback<ListLoader<Guarantor>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.healthcareGuarantorList(
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
        getKey: (guarantor) => guarantor.id,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Penjamin"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: q ? { q } : {},
                                    replace: true,
                                }),
                            label: 'Cari penjamin',
                            placeholder:
                                'Cari nama penjamin atau tipe pasien...',
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
                        {list.items.length} penjamin dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(guarantor) => guarantor.id}
                    getRowLabel={(guarantor) => guarantor.name}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, guarantor) => setOpen(guarantor)}
                    onRowClick={(guarantor) => setOpen(guarantor)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        canManage
                            ? 'Belum ada penjamin. Pilih Baru untuk menambahkan.'
                            : 'Belum ada penjamin.'
                    }
                    columns={[
                        {
                            id: 'name',
                            header: 'Penjamin',
                            width: 280,
                            cell: (guarantor) => (
                                <DataTableText>{guarantor.name}</DataTableText>
                            ),
                            sortValue: (guarantor) => guarantor.name,
                        },
                        {
                            id: 'patient_type_name',
                            header: 'Tipe pasien',
                            width: 200,
                            cell: (guarantor) => (
                                <DataTableText>
                                    {guarantor.patient_type_name}
                                </DataTableText>
                            ),
                            sortValue: (guarantor) =>
                                guarantor.patient_type_name,
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 110,
                            cell: (guarantor) => (
                                <Badge
                                    variant={
                                        guarantor.is_active
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {guarantor.is_active ? 'Aktif' : 'Nonaktif'}
                                    {guarantor.is_default ? ' · Bawaan' : ''}
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
                    <PageDialogContent ref={contentRef} title="Penjamin">
                        <GuarantorCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            guarantor={open === 'new' ? null : open}
                            canManage={canManage}
                            portalContainer={contentRef}
                            onSaved={(guarantor) => {
                                setOpen(guarantor);
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
    path: '/healthcare/coverage/guarantors',
    previousPaths: ['/healthcare/guarantors'],
    layout: 'app',
    title: 'Penjamin',
    validateSearch: searchSchema,
    component: GuarantorsPage,
});
