import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FilterPane } from '@operations-metta/ui/filter-pane';
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

// Ruangan: ruang fisik di satu unit, misalnya L1R1 di lantai 1. Section memilih ruangan yang melayaninya, dan petugas
// yang memanggil pasien kelak memilih ruangannya.

const route = getRouteApi('/_app/healthcare/service/rooms');
const ALL = 'all';
type Room = ApiBody<'healthcareRoomList'>['data'][number];
type Metadata = ApiBody<'healthcareRoomMetadata'>;
type Search = z.infer<typeof searchSchema>;
type Errors = Record<string, string[]>;
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    unit: z.string().max(100).optional(),
    status: z.enum(['active', 'inactive']).optional(),
});

function RoomCard({
    room,
    metadata,
    portalContainer,
    onSaved,
    onClose,
}: {
    room: Room | null;
    metadata: Metadata;
    portalContainer: RefObject<HTMLElement | null>;
    onSaved: (room: Room) => void;
    onClose: () => void;
}): ReactNode {
    // Ruangan tersimpan langsung terbuka untuk diubah bila pengguna berhak mengubahnya.
    const editing =
        room === null
            ? metadata.permissions.create
            : metadata.permissions.update;
    const blank = {
        operating_unit_id: room?.operating_unit_id ?? null,
        code: room?.code ?? '',
        floor: room?.floor ?? '',
        name: room?.name ?? '',
        display_name: room?.display_name ?? '',
        sort_order: String(room?.sort_order ?? 0),
        // Ruangan baru langsung aktif.
        is_active: room?.is_active ?? true,
    };
    const [form, setForm] = useState(blank);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    const dirty = JSON.stringify(form) !== JSON.stringify(blank);
    usePageDialogRecord({
        recordTitle: room?.name ?? 'Ruangan baru',
        editing,
        dirty,
    });
    const text = (
        id: 'code' | 'floor' | 'name' | 'display_name',
        label: string,
        maxLength: number,
        required = false,
    ) => (
        <FormControl error={errors[id]?.[0]}>
            <Input
                label={label}
                required={required}
                maxLength={maxLength}
                data-error-field={id}
                value={form[id]}
                readOnly={!editing}
                onChange={(event) =>
                    setForm({ ...form, [id]: event.target.value })
                }
            />
        </FormControl>
    );

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        const body = {
            operating_unit_id: form.operating_unit_id ?? '',
            code: form.code,
            floor: form.floor || null,
            name: form.name,
            display_name: form.display_name || null,
            sort_order: Number.parseInt(form.sort_order, 10) || 0,
            is_active: form.is_active,
        };
        try {
            const { body: saved } = room
                ? await api.healthcareRoomUpdate({
                      params: { id: room.id },
                      body: { ...body, version: room.version },
                  })
                : await api.healthcareRoomCreate({ body });
            toast.success(room ? 'Ruangan diperbarui.' : 'Ruangan dibuat.');
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Ruangan belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!room) return;
        if (
            !(await confirm({
                title: `Delete ruangan ${room.name}?`,
                description:
                    'Ruangan tidak bisa dipilih lagi dan dilepas dari section yang memakainya. Kodenya bisa dipakai lagi untuk ruangan baru di unit yang sama.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        try {
            await api.healthcareRoomDelete({
                params: { id: room.id },
                body: { version: room.version },
            });
            toast.success('Ruangan dihapus.');
            onClose();
        } catch (caught) {
            setMessage(errorText(caught, 'Ruangan belum dihapus.'));
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
                                if (!room) {
                                    onClose();
                                    return;
                                }
                                setForm(blank);
                                setErrors({});
                            }}
                        />
                    </>
                )}
                {room && metadata.permissions.delete && (
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
                operation="Ruangan belum disimpan"
            />
            <PageDialogBody className="py-3">
                <FormGrid>
                    <FormControl error={errors.operating_unit_id?.[0]}>
                        {editing ? (
                            <Select
                                label="Unit"
                                required
                                items={metadata.operating_units.map((unit) => ({
                                    value: unit.id,
                                    label: unit.name,
                                }))}
                                value={form.operating_unit_id}
                                onValueChange={(value) =>
                                    setForm({
                                        ...form,
                                        operating_unit_id: value,
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
                                value={room?.operating_unit_name ?? ''}
                                readOnly
                            />
                        )}
                    </FormControl>
                    {text('code', 'Kode', 20, true)}
                    {text('name', 'Nama', 100, true)}
                    {text('floor', 'Lantai', 50)}
                    {text('display_name', 'Nama di layar antrean', 100)}
                    <FormControl error={errors.sort_order?.[0]}>
                        <Input
                            label="Urutan"
                            type="number"
                            inputMode="numeric"
                            data-error-field="sort_order"
                            value={form.sort_order}
                            readOnly={!editing}
                            onChange={(event) =>
                                setForm({
                                    ...form,
                                    sort_order: event.target.value,
                                })
                            }
                        />
                    </FormControl>
                    <Field orientation="horizontal" className="w-auto">
                        <Switch
                            id="room-active"
                            checked={form.is_active}
                            disabled={!editing}
                            onCheckedChange={(checked) =>
                                setForm({ ...form, is_active: checked })
                            }
                        />
                        <FieldLabel htmlFor="room-active">Aktif</FieldLabel>
                    </Field>
                </FormGrid>
            </PageDialogBody>
            {confirmation}
        </form>
    );
}

function RoomsPage(): ReactNode {
    const { data: metadata } = useSuspenseQuery(
        orpc.healthcareRoomMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const contentRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState<Room | 'new' | null>(null);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const filterPanelId = useId();
    const { unit, status } = search;
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
    const loader = useCallback<ListLoader<Room>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.healthcareRoomList(
                {
                    query: {
                        q: query,
                        ...(unit ? { operating_unit_id: unit } : {}),
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
        [unit, status],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (room) => room.id,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Ruangan"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) => setSearch({ q }),
                            label: 'Cari ruangan',
                            placeholder: 'Cari kode, nama, atau lantai...',
                        }}
                        filter={{
                            open: filtersOpen,
                            onOpenChange: setFiltersOpen,
                            active: Boolean(unit || status),
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
                        {list.items.length} ruangan dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(room) => room.id}
                    getRowLabel={(room) => `${room.code} ${room.name}`}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, room) => setOpen(room)}
                    onRowClick={(room) => setOpen(room)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        metadata.permissions.create
                            ? 'Belum ada ruangan yang cocok. Pilih Baru untuk menambahkan.'
                            : 'Belum ada ruangan yang cocok.'
                    }
                    columns={[
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 110,
                            cell: (room) => (
                                <DataTableText>{room.code}</DataTableText>
                            ),
                            sortValue: (room) => room.code,
                        },
                        {
                            id: 'name',
                            header: 'Ruangan',
                            width: 220,
                            cell: (room) => (
                                <DataTableText>{room.name}</DataTableText>
                            ),
                            sortValue: (room) => room.name,
                        },
                        {
                            id: 'floor',
                            header: 'Lantai',
                            width: 120,
                            cell: (room) => (
                                <DataTableText>
                                    {room.floor ?? ''}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'operating_unit_name',
                            header: 'Unit',
                            width: 220,
                            cell: (room) => (
                                <DataTableText>
                                    {room.operating_unit_name}
                                </DataTableText>
                            ),
                            sortValue: (room) => room.operating_unit_name,
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 110,
                            cell: (room) => (
                                <Badge
                                    variant={
                                        room.is_active ? 'secondary' : 'outline'
                                    }
                                >
                                    {room.is_active ? 'Aktif' : 'Nonaktif'}
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
                    <PageDialogContent ref={contentRef} title="Ruangan">
                        <RoomCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            room={open === 'new' ? null : open}
                            metadata={metadata}
                            portalContainer={contentRef}
                            onSaved={(room) => {
                                setOpen(room);
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
    path: '/healthcare/service/rooms',
    layout: 'app',
    title: 'Ruangan',
    validateSearch: searchSchema,
    component: RoomsPage,
});
