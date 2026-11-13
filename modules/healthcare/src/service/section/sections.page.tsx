import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { Checkbox } from '@operations-metta/ui/checkbox';
import {
    Field,
    FieldLabel,
    FieldLegend,
    FieldSet,
} from '@operations-metta/ui/field';
import { FilterPane } from '@operations-metta/ui/filter-pane';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import { MultiSelect } from '@operations-metta/ui/multi-select';
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
import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useId, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
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
import { isSectionKind, sectionKinds } from './section.kinds.ts';
import {
    defaultQueueMode,
    isQueueMode,
    queueModes,
} from './section.queue-modes.ts';

// Section: poli dan titik layanan lain di satu unit, dipilih saat pendaftaran kunjungan kelak, beserta ruangan yang
// melayaninya. Ruangan sendiri diisi di layar Ruangan.

const route = getRouteApi('/_app/healthcare/service/sections');
const ALL = 'all';
type Section = ApiBody<'healthcareSectionList'>['data'][number];
type Metadata = ApiBody<'healthcareSectionMetadata'>;
type Search = z.infer<typeof searchSchema>;
type Errors = Record<string, string[]>;
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    unit: z.string().max(100).optional(),
    kind: z.string().max(40).optional(),
    status: z.enum(['active', 'inactive']).optional(),
});
const kindItems = Object.entries(sectionKinds).map(([value, label]) => ({
    value,
    label,
}));
const kindLabel = (kind: string) =>
    isSectionKind(kind) ? sectionKinds[kind] : kind;
const queueModeItems = Object.entries(queueModes).map(([value, label]) => ({
    value,
    label,
}));
const queueModeLabel = (mode: string) =>
    isQueueMode(mode) ? queueModes[mode] : mode;
function SectionCard({
    section,
    metadata,
    portalContainer,
    onSaved,
    onClose,
}: {
    section: Section | null;
    metadata: Metadata;
    portalContainer: RefObject<HTMLElement | null>;
    onSaved: (section: Section) => void;
    onClose: () => void;
}): ReactNode {
    // Section tersimpan langsung terbuka untuk diubah bila pengguna berhak mengubahnya.
    const editing =
        section === null
            ? metadata.permissions.create
            : metadata.permissions.update;
    const blank = {
        operating_unit_id: section?.operating_unit_id ?? null,
        code: section?.code ?? '',
        name: section?.name ?? '',
        kind: section?.kind ?? null,
        document_code: section?.document_code ?? '',
        bpjs_clinic_code: section?.bpjs_clinic_code ?? '',
        queue_mode: section?.queue_mode ?? defaultQueueMode,
        queue_prefix: section?.queue_prefix ?? '',
        room_ids: (section?.rooms ?? []).map((room) => room.id),
        cluster_ids: (section?.clusters ?? []).map((cluster) => cluster.id),
        // Section baru memakai bagian pemeriksaan bawaan.
        examination_panels:
            section?.examination_panels ??
            metadata.examination_panels
                .filter((panel) => panel.by_default)
                .map((panel) => panel.code),
        // Section baru langsung aktif.
        is_active: section?.is_active ?? true,
    };
    const [form, setForm] = useState(blank);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    usePageDialogRecord({
        recordTitle: section?.name ?? 'Section baru',
        editing,
    });
    const units = metadata.operating_units.map((unit) => ({
        value: unit.id,
        label: unit.name,
    }));
    const rooms = metadata.rooms
        .filter((room) => room.operating_unit_id === form.operating_unit_id)
        .map((room) => ({
            value: room.id,
            label: `${room.code} · ${room.name}${room.is_active ? '' : ' (nonaktif)'}`,
        }));

    const clusters = metadata.clusters
        .filter(
            (cluster) =>
                cluster.is_active || form.cluster_ids.includes(cluster.id),
        )
        .map((cluster) => ({
            value: cluster.id,
            label: `${cluster.code} ${cluster.name}${cluster.is_active ? '' : ' (nonaktif)'}`,
        }));

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        const body = {
            operating_unit_id: form.operating_unit_id ?? '',
            code: form.code,
            name: form.name,
            kind: form.kind ?? '',
            document_code: form.document_code || null,
            bpjs_clinic_code: form.bpjs_clinic_code || null,
            queue_mode: form.queue_mode,
            queue_prefix: form.queue_prefix || null,
            room_ids: form.room_ids,
            cluster_ids: form.cluster_ids,
            examination_panels: form.examination_panels,
            is_active: form.is_active,
        };
        try {
            const { body: saved } = section
                ? await api.healthcareSectionUpdate({
                      params: { id: section.id },
                      body: { ...body, version: section.version },
                  })
                : await api.healthcareSectionCreate({ body });
            toast.success(section ? 'Section diperbarui.' : 'Section dibuat.');
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Section belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!section) return;
        if (
            !(await confirm({
                title: `Delete section ${section.name}?`,
                description:
                    'Section tidak bisa dipilih lagi. Kodenya bisa dipakai lagi untuk section baru, dan namanya untuk section baru di unit yang sama.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        try {
            await api.healthcareSectionDelete({
                params: { id: section.id },
                body: { version: section.version },
            });
            toast.success('Section dihapus.');
            onClose();
        } catch (caught) {
            setMessage(errorText(caught, 'Section belum dihapus.'));
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
                                if (!section) {
                                    onClose();
                                    return;
                                }
                                setForm(blank);
                                setErrors({});
                            }}
                        />
                    </>
                )}
                {section && metadata.permissions.delete && (
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
                operation="Section belum disimpan"
            />
            <PageDialogBody className="py-3">
                <FormGrid>
                    <FormControl error={errors.operating_unit_id?.[0]}>
                        {editing ? (
                            <Select
                                label="Unit"
                                required
                                items={units}
                                value={form.operating_unit_id}
                                onValueChange={(value) =>
                                    setForm({
                                        ...form,
                                        operating_unit_id: value,
                                        room_ids:
                                            value === form.operating_unit_id
                                                ? form.room_ids
                                                : [],
                                    })
                                }
                                placeholder="Pilih unit"
                                searchPlaceholder="Cari unit"
                                emptyMessage="Unit tidak ditemukan."
                                portalContainer={portalContainer}
                            />
                        ) : (
                            <Input
                                label="Unit"
                                value={section?.operating_unit_name ?? ''}
                                readOnly
                            />
                        )}
                    </FormControl>
                    <FormControl
                        error={errors.code?.[0]}
                        hint="Tampil di alamat halaman pemeriksaan pasien, jadi tidak boleh sama dengan section lain di unit mana pun."
                    >
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
                    <FormControl error={errors.kind?.[0]}>
                        {editing ? (
                            <Select
                                label="Jenis"
                                required
                                items={kindItems}
                                value={form.kind}
                                onValueChange={(value) =>
                                    setForm({ ...form, kind: value })
                                }
                                placeholder="Pilih jenis"
                                searchPlaceholder="Cari jenis"
                                emptyMessage="Jenis tidak ditemukan."
                                portalContainer={portalContainer}
                            />
                        ) : (
                            <Input
                                label="Jenis"
                                value={form.kind ? kindLabel(form.kind) : ''}
                                readOnly
                            />
                        )}
                    </FormControl>
                    <FormControl error={errors.document_code?.[0]}>
                        <Input
                            label="Kode nomor bukti"
                            maxLength={10}
                            data-error-field="document_code"
                            value={form.document_code}
                            readOnly={!editing}
                            onChange={(event) =>
                                setForm({
                                    ...form,
                                    document_code: event.target.value,
                                })
                            }
                        />
                    </FormControl>
                    <FormControl error={errors.bpjs_clinic_code?.[0]}>
                        <Input
                            label="Kode poli BPJS"
                            maxLength={20}
                            data-error-field="bpjs_clinic_code"
                            value={form.bpjs_clinic_code}
                            readOnly={!editing}
                            onChange={(event) =>
                                setForm({
                                    ...form,
                                    bpjs_clinic_code: event.target.value,
                                })
                            }
                        />
                    </FormControl>
                    <Field orientation="horizontal" className="w-auto">
                        <Switch
                            id="section-active"
                            checked={form.is_active}
                            disabled={!editing}
                            onCheckedChange={(checked) =>
                                setForm({ ...form, is_active: checked })
                            }
                        />
                        <FieldLabel htmlFor="section-active">Aktif</FieldLabel>
                    </Field>
                    <FormControl
                        error={errors.queue_mode?.[0]}
                        hint="Satu antrean untuk semua ruangan: pasien mendapat satu nomor untuk section ini setiap hari, lalu ruangan yang memanggil pasien itulah yang melayaninya. Antrean per jadwal praktik: setiap jadwal dokter punya urutan nomornya sendiri. Nomor antrean mulai lagi dari awal setiap hari."
                    >
                        {editing ? (
                            <Select
                                label="Cara antrean"
                                required
                                items={queueModeItems}
                                value={form.queue_mode}
                                onValueChange={(value) =>
                                    setForm({
                                        ...form,
                                        queue_mode: value ?? defaultQueueMode,
                                    })
                                }
                                searchPlaceholder="Cari cara antrean"
                                emptyMessage="Cara antrean tidak ditemukan."
                                portalContainer={portalContainer}
                            />
                        ) : (
                            <Input
                                label="Cara antrean"
                                value={queueModeLabel(form.queue_mode)}
                                readOnly
                            />
                        )}
                    </FormControl>
                    <FormControl error={errors.queue_prefix?.[0]}>
                        <Input
                            label="Awalan nomor antrean"
                            maxLength={5}
                            placeholder="Misalnya A untuk A-012"
                            data-error-field="queue_prefix"
                            value={form.queue_prefix}
                            readOnly={!editing}
                            onChange={(event) =>
                                setForm({
                                    ...form,
                                    queue_prefix: event.target.value,
                                })
                            }
                        />
                    </FormControl>
                    <FormControl error={errors.room_ids?.[0]}>
                        {editing ? (
                            <MultiSelect
                                label="Ruangan"
                                items={rooms}
                                value={form.room_ids}
                                onValueChange={(roomIds) =>
                                    setForm({ ...form, room_ids: roomIds })
                                }
                                placeholder={
                                    form.operating_unit_id
                                        ? 'Pilih ruangan'
                                        : 'Pilih unit dulu'
                                }
                                searchPlaceholder="Cari ruangan"
                                emptyMessage="Belum ada ruangan di unit ini. Tambahkan di layar Ruangan."
                                portalContainer={portalContainer}
                            />
                        ) : (
                            <Input
                                label="Ruangan"
                                value={(section?.rooms ?? [])
                                    .map((room) => room.name)
                                    .join(', ')}
                                readOnly
                            />
                        )}
                    </FormControl>
                    <FormControl
                        error={errors.cluster_ids?.[0]}
                        hint="Pasien hanya bisa didaftarkan ke section ini bila klasternya dipilih di sini. Kosongkan bila section melayani semua klaster."
                    >
                        {editing ? (
                            <MultiSelect
                                label="Klaster"
                                items={clusters}
                                value={form.cluster_ids}
                                onValueChange={(clusterIds) =>
                                    setForm({
                                        ...form,
                                        cluster_ids: clusterIds,
                                    })
                                }
                                placeholder="Semua klaster"
                                searchPlaceholder="Cari klaster"
                                emptyMessage="Belum ada klaster. Tambahkan di layar Klaster."
                                portalContainer={portalContainer}
                            />
                        ) : (
                            <Input
                                label="Klaster"
                                value={
                                    (section?.clusters ?? [])
                                        .map((cluster) => cluster.name)
                                        .join(', ') || 'Semua klaster'
                                }
                                readOnly
                            />
                        )}
                    </FormControl>
                </FormGrid>
                <FieldSet
                    className="mt-4 gap-2"
                    data-error-field="examination_panels"
                >
                    <FieldLegend
                        variant="label"
                        hint="Bagian yang tampil dan diisi di halaman pemeriksaan pasien section ini. Poli gigi biasanya memakai Pemeriksaan dasar gigi tanpa Keadaan fisik dan Anatomi tubuh."
                    >
                        Bagian pemeriksaan
                    </FieldLegend>
                    <div className="gap-x-6 sm:columns-2">
                        {metadata.examination_panels.map((panel) => (
                            <Field
                                key={panel.code}
                                orientation="horizontal"
                                className="mb-2 w-auto break-inside-avoid"
                            >
                                <Checkbox
                                    id={`section-panel-${panel.code}`}
                                    checked={form.examination_panels.includes(
                                        panel.code,
                                    )}
                                    disabled={!editing}
                                    onCheckedChange={(checked) =>
                                        setForm({
                                            ...form,
                                            examination_panels:
                                                metadata.examination_panels
                                                    .map((item) => item.code)
                                                    .filter((code) =>
                                                        code === panel.code
                                                            ? checked === true
                                                            : form.examination_panels.includes(
                                                                  code,
                                                              ),
                                                    ),
                                        })
                                    }
                                />
                                <FieldLabel
                                    htmlFor={`section-panel-${panel.code}`}
                                    className="font-normal"
                                >
                                    {panel.label}
                                </FieldLabel>
                            </Field>
                        ))}
                    </div>
                    {errors.examination_panels?.[0] && (
                        <p className="text-sm text-destructive">
                            {errors.examination_panels[0]}
                        </p>
                    )}
                </FieldSet>
            </PageDialogBody>
            {confirmation}
        </form>
    );
}

function SectionsPage(): ReactNode {
    const { data: metadata } = useSuspenseQuery(
        orpc.healthcareSectionMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const contentRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState<Section | 'new' | null>(null);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const filterPanelId = useId();
    const { unit, kind, status } = search;
    const setSearch = (next: Partial<Search>) =>
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
            replace: true,
        });
    const loader = useCallback<ListLoader<Section>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.healthcareSectionList(
                {
                    query: {
                        q: query,
                        ...(unit ? { operating_unit_id: unit } : {}),
                        ...(kind ? { kind } : {}),
                        ...(status ? { status } : {}),
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
        [unit, kind, status],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (section) => section.id,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Section"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) => setSearch({ q }),
                            label: 'Cari section',
                            placeholder:
                                'Cari nama section, unit, atau kode...',
                        }}
                        filter={{
                            open: filtersOpen,
                            onOpenChange: setFiltersOpen,
                            active: Boolean(unit || kind || status),
                            controls: filterPanelId,
                        }}
                    >
                        {metadata.permissions.create && (
                            <ActionButton
                                action="create"
                                onClick={() => setOpen('new')}
                            />
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
                                            label="Unit"
                                            items={[
                                                {
                                                    value: ALL,
                                                    label: 'Semua unit',
                                                },
                                                ...metadata.operating_units.map(
                                                    (option) => ({
                                                        value: option.id,
                                                        label: option.name,
                                                    }),
                                                ),
                                            ]}
                                            value={unit ?? ALL}
                                            onValueChange={(value) =>
                                                setSearch({
                                                    unit:
                                                        value === ALL
                                                            ? undefined
                                                            : (value ??
                                                              undefined),
                                                })
                                            }
                                            searchPlaceholder="Cari unit"
                                            emptyMessage="Unit tidak ditemukan."
                                        />
                                    </FormControl>
                                    <FormControl>
                                        <Select
                                            label="Jenis"
                                            items={[
                                                {
                                                    value: ALL,
                                                    label: 'Semua jenis',
                                                },
                                                ...kindItems,
                                            ]}
                                            value={kind ?? ALL}
                                            onValueChange={(value) =>
                                                setSearch({
                                                    kind:
                                                        value === ALL
                                                            ? undefined
                                                            : (value ??
                                                              undefined),
                                                })
                                            }
                                            searchPlaceholder="Cari jenis"
                                            emptyMessage="Jenis tidak ditemukan."
                                        />
                                    </FormControl>
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
                                </FormGrid>
                            </div>
                        </FilterPane>
                    ) : null
                }
                footer={
                    <p className="p-3 text-sm text-muted-foreground">
                        {list.items.length} section dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(section) => section.id}
                    getRowLabel={(section) => section.name}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, section) => setOpen(section)}
                    onRowClick={(section) => setOpen(section)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        metadata.permissions.create
                            ? 'Belum ada section yang cocok. Pilih Baru untuk menambahkan.'
                            : 'Belum ada section yang cocok.'
                    }
                    columns={[
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 110,
                            cell: (section) => (
                                <DataTableText>{section.code}</DataTableText>
                            ),
                            sortValue: (section) => section.code,
                        },
                        {
                            id: 'name',
                            header: 'Section',
                            width: 240,
                            cell: (section) => (
                                <DataTableText>{section.name}</DataTableText>
                            ),
                            sortValue: (section) => section.name,
                        },
                        {
                            id: 'operating_unit_name',
                            header: 'Unit',
                            width: 220,
                            cell: (section) => (
                                <DataTableText>
                                    {section.operating_unit_name}
                                </DataTableText>
                            ),
                            sortValue: (section) => section.operating_unit_name,
                        },
                        {
                            id: 'kind',
                            header: 'Jenis',
                            width: 150,
                            cell: (section) => (
                                <DataTableText>
                                    {kindLabel(section.kind)}
                                </DataTableText>
                            ),
                            sortValue: (section) => section.kind,
                        },
                        {
                            id: 'document_code',
                            header: 'Kode nomor bukti',
                            width: 150,
                            cell: (section) => (
                                <DataTableText>
                                    {section.document_code ?? ''}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 110,
                            cell: (section) => (
                                <Badge
                                    variant={
                                        section.is_active
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {section.is_active ? 'Aktif' : 'Nonaktif'}
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
                    <PageDialogContent ref={contentRef} title="Section">
                        <SectionCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            section={open === 'new' ? null : open}
                            metadata={metadata}
                            portalContainer={contentRef}
                            onSaved={(section) => {
                                setOpen(section);
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
    path: '/healthcare/service/sections',
    layout: 'app',
    title: 'Section',
    validateSearch: searchSchema,
    component: SectionsPage,
});
