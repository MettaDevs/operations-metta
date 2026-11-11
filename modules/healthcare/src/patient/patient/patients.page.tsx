import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { displayDate } from '@operations-metta/ui/date-picker';
import { FilterPane } from '@operations-metta/ui/filter-pane';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import type { LookupLoader } from '@operations-metta/ui/inline-lookup';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import {
    PageDialog,
    PageDialogContent,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { Select } from '@operations-metta/ui/select';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { useRecordNavigation } from '@operations-metta/ui/use-record-navigation';
import { useRecordTransition } from '@operations-metta/ui/use-record-transition';
import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import {
    api,
    definePage,
    orpc,
    type ApiBody,
} from '@core/platform/shell/index.ts';
import { PatientCard, type PatientRow } from './patient-card.tsx';

// Daftar pasien yang terlihat bagi pengguna (sekelompok berbagi dengan unit kerjanya), kartu pasien, dan pendaftaran
// pasien baru. Pencarian sama dengan sistem lama: nama, NRM, NIK, no. BPJS/jaminan, dan tanggal lahir.

const route = getRouteApi('/_app/healthcare/patient/patients');
const ALL = 'all';
type Search = z.infer<typeof searchSchema>;
type PatientType = ApiBody<'healthcarePatientTypeList'>['data'][number];
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    patient_type: z.string().max(100).optional(),
    patient: z.string().max(100).optional(),
});

function PatientTypeFilter({
    value,
    onChange,
}: {
    value: string | undefined;
    onChange: (type: PatientType | null) => void;
}): ReactNode {
    const [selected, setSelected] = useState<PatientType | null>(null);
    const loader = useCallback<LookupLoader<PatientType>>(
        async ({ query, cursor, signal }) => {
            const { body } = await api.healthcarePatientTypeList(
                { query: { q: query, ...(cursor ? { cursor } : {}) } },
                { signal },
            );
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [],
    );
    return (
        <InlineLookup
            label="Tipe pasien"
            loadItems={loader}
            value={value && selected?.id === value ? selected : null}
            onValueChange={(type) => {
                setSelected(type);
                onChange(type);
            }}
            getItemValue={(item) => item.id}
            getItemLabel={(item) => item.name}
            placeholder="Semua tipe pasien"
            emptyMessage="Tipe pasien tidak ditemukan."
            columns={[
                { id: 'code', header: 'Kode', cell: (item) => item.code },
                { id: 'name', header: 'Nama', cell: (item) => item.name },
            ]}
            showDetails={false}
        />
    );
}

function PatientsPage(): ReactNode {
    const { data: metadata } = useSuspenseQuery(
        orpc.healthcarePatientMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const contentRef = useRef<HTMLDivElement>(null);
    const [creating, setCreating] = useState(false);
    const [createKey, setCreateKey] = useState(0);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const filterPanelId = useId();
    const transition = useRecordTransition(dirty, busy);
    const { status, patient_type: patientType } = search;
    const filterKey = JSON.stringify([status, patientType]);
    const references = (category: string, code: string | null) =>
        code === null
            ? null
            : (metadata.reference_values[category]?.find(
                  (value) => value.code === code,
              )?.name ?? code);

    const loader = useCallback<ListLoader<PatientRow>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.healthcarePatientList(
                {
                    query: {
                        ...(status ? { status } : {}),
                        ...(patientType
                            ? { patient_type_id: patientType }
                            : {}),
                        q: query,
                        ...(cursor ? { cursor } : {}),
                        ...(sort
                            ? { sort: sort.columnId, direction: sort.direction }
                            : {}),
                    },
                },
                { signal },
            );
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [status, patientType],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (patient) => patient.id,
    });
    const setSearch = (next: Partial<Search>, replace = true) =>
        void navigate({
            search: (current) =>
                Object.fromEntries(
                    Object.entries<string | undefined>({
                        ...current,
                        ...next,
                    }).filter(
                        ([, value]) => value !== undefined && value !== '',
                    ),
                ),
            replace,
        });
    const openPatient = (id: string) => setSearch({ patient: id }, false);
    const closePatient = () => setSearch({ patient: undefined }, false);
    const startNew = () =>
        transition.request(() => {
            setSearch({ patient: undefined });
            setCreateKey((key) => key + 1);
            setCreating(true);
        });
    const navigation = useRecordNavigation({
        items: list.items,
        currentId: search.patient ?? null,
        getId: (patient) => patient.id,
        onNavigate: (id) => transition.request(() => openPatient(id)),
        scopeKey: `${filterKey}:${search.q ?? ''}`,
        disabled: busy || dirty,
        hasMore: list.hasMore,
        loading: list.loading,
        loadMore: list.loadMore,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Pasien"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) => setSearch({ q }),
                            label: 'Cari pasien',
                            placeholder:
                                'Cari nama, NRM, NIK, no. BPJS/jaminan, atau tanggal lahir...',
                        }}
                        filter={{
                            open: filtersOpen,
                            onOpenChange: setFiltersOpen,
                            active: Boolean(status || patientType),
                            controls: filterPanelId,
                        }}
                    >
                        {metadata.permissions.create && (
                            <ActionButton action="create" onClick={startNew} />
                        )}
                    </RecordActionBar>
                }
                filterPanel={
                    filtersOpen ? (
                        <FilterPane
                            id={filterPanelId}
                            title="Filter"
                            description="Hasil diperbarui otomatis saat filter diubah."
                            onClose={() => setFiltersOpen(false)}
                        >
                            <div className="p-4">
                                <FormGrid columns={1}>
                                    <FormControl>
                                        <Select
                                            label="Status"
                                            items={[
                                                {
                                                    value: ALL,
                                                    label: 'Semua status',
                                                },
                                                {
                                                    value: 'active',
                                                    label: 'Aktif',
                                                },
                                                {
                                                    value: 'inactive',
                                                    label: 'Nonaktif',
                                                },
                                            ]}
                                            value={status ?? ALL}
                                            onValueChange={(value) =>
                                                setSearch({
                                                    status:
                                                        value === 'active' ||
                                                        value === 'inactive'
                                                            ? value
                                                            : undefined,
                                                })
                                            }
                                            searchPlaceholder="Cari status"
                                            emptyMessage="Status tidak ditemukan."
                                        />
                                    </FormControl>
                                    <FormControl>
                                        <PatientTypeFilter
                                            value={patientType}
                                            onChange={(type) =>
                                                setSearch({
                                                    patient_type: type?.id,
                                                })
                                            }
                                        />
                                    </FormControl>
                                </FormGrid>
                            </div>
                        </FilterPane>
                    ) : null
                }
                footer={
                    <p className="p-3 text-sm text-muted-foreground">
                        {list.items.length} pasien dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(patient) => patient.id}
                    getRowLabel={(patient) => `${patient.nrm} ${patient.name}`}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, patient) => openPatient(patient.id)}
                    activeRowKey={search.patient}
                    onRowClick={(patient) => openPatient(patient.id)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        metadata.permissions.create
                            ? 'Belum ada pasien yang cocok. Pilih Baru atau ubah pencarian.'
                            : 'Belum ada pasien yang cocok.'
                    }
                    columns={[
                        {
                            id: 'nrm',
                            header: 'NRM',
                            width: 120,
                            cell: (patient) => (
                                <DataTableText>{patient.nrm}</DataTableText>
                            ),
                            sortValue: (patient) => patient.nrm,
                        },
                        {
                            // Satu sel berisi identitas pasien, satu baris per isian dengan label, mengikuti daftar
                            // pasien aplikasi lama supaya petugas mengenali pasien tanpa membuka kartunya.
                            id: 'name',
                            header: 'Identitas',
                            width: 340,
                            sortValue: (patient) => patient.name,
                            cell: (patient) => (
                                <DataTableText multiline>
                                    <ul className="list-disc space-y-0.5 pl-4">
                                        <li className="font-medium">
                                            {patient.name}
                                        </li>
                                        {[
                                            ['NIK', patient.nik],
                                            [
                                                'No. penjamin',
                                                patient.card_number,
                                            ],
                                            [
                                                'No. dok RM',
                                                patient.document_number,
                                            ],
                                            ['No. RM lama', patient.old_number],
                                            [
                                                'Jenis kelamin',
                                                references(
                                                    'gender',
                                                    patient.gender,
                                                ),
                                            ],
                                            [
                                                'Tempat lahir',
                                                patient.birth_place,
                                            ],
                                            [
                                                'Tgl. lahir',
                                                patient.birth_date &&
                                                    displayDate(
                                                        patient.birth_date,
                                                    ),
                                            ],
                                        ].map(([label, value]) => (
                                            <li key={label}>
                                                {label}: {value || '—'}
                                            </li>
                                        ))}
                                    </ul>
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'address',
                            header: 'Alamat',
                            width: 320,
                            cell: (patient) => (
                                <DataTableText multiline>
                                    {patient.address?.replaceAll('\n', ', ') ??
                                        '—'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 110,
                            cell: (patient) => (
                                <Badge
                                    variant={
                                        patient.is_active
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {patient.is_active ? 'Aktif' : 'Nonaktif'}
                                </Badge>
                            ),
                        },
                    ]}
                />
            </ListPageLayout>
            {(creating || search.patient) && (
                <PageDialog
                    open
                    onOpenChange={(open) => {
                        if (!open && !busy)
                            transition.request(() => {
                                setCreating(false);
                                closePatient();
                            });
                    }}
                >
                    <PageDialogContent
                        ref={contentRef}
                        title="Pasien"
                        busy={busy}
                        onNew={
                            metadata.permissions.create ? startNew : undefined
                        }
                        navigation={creating ? undefined : navigation}
                        onEscapeKeyDown={(event) => {
                            if (
                                busy ||
                                contentRef.current?.querySelector(
                                    '[role="combobox"][aria-expanded="true"]',
                                )
                            )
                                event.preventDefault();
                        }}
                    >
                        <PatientCard
                            key={creating ? `new-${createKey}` : search.patient}
                            patientId={
                                creating ? null : (search.patient ?? null)
                            }
                            metadata={metadata}
                            portalContainer={contentRef}
                            onBusyChange={setBusy}
                            onDirtyChange={setDirty}
                            onCancelNew={() =>
                                transition.request(() => setCreating(false))
                            }
                            onCreated={(patient) => {
                                setCreating(false);
                                setDirty(false);
                                list.reload();
                                openPatient(patient.id);
                            }}
                            onUpdated={() => list.reload()}
                            onDeleted={() => {
                                list.reload();
                                closePatient();
                            }}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
            {transition.confirmation}
        </>
    );
}

export const page = definePage({
    path: '/healthcare/patient/patients',
    previousPaths: ['/healthcare/patients'],
    layout: 'app',
    title: 'Pasien',
    validateSearch: searchSchema,
    component: PatientsPage,
});
