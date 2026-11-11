import { ActionButton } from '@operations-metta/ui/action-button';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from '@operations-metta/ui/empty';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import { MasterDetailLayout } from '@operations-metta/ui/master-detail-layout';
import {
    PageDialog,
    PageDialogBody,
    PageDialogContent,
    PageDialogToolbar,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { useSuspenseQuery } from '@tanstack/react-query';
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
    orpc,
    type ApiBody,
} from '../shell/index.ts';

// Master pekerjaan untuk isian Pekerjaan pada party. Tidak ada di CoreERP; bentuk layarnya mengikuti layar setup
// Organization: daftar di kiri, rincian di kanan, dan kartu Baru. Master kecil ini hanya punya nama.

const route = getRouteApi('/_app/sysadmin/address-book/occupations');
type Occupation = ApiBody<'occupationList'>['data'][number];
type Errors = Record<string, string[]>;

function failure(caught: unknown, fallback: string) {
    return caught instanceof ApiError && caught.status === 422
        ? { errors: caught.errors, message: null }
        : { errors: {}, message: errorText(caught, fallback) };
}

function CreateOccupation({
    onCreated,
}: {
    onCreated: (occupation: Occupation) => void;
}) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const close = () => {
        setName('');
        setErrors({});
        setMessage(null);
        setOpen(false);
    };

    const submit = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body } = await api.occupationCreate({ body: { name } });
            toast.success('Pekerjaan ditambahkan.');
            close();
            onCreated(body.data);
        } catch (caught) {
            const failed = failure(caught, 'Pekerjaan belum dibuat.');
            setErrors(failed.errors);
            setMessage(failed.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <ActionButton action="create" onClick={() => setOpen(true)} />
            {open && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next && !busy) close();
                    }}
                >
                    <PageDialogContent
                        title="Pekerjaan"
                        recordTitle={name || 'Pekerjaan baru'}
                        editing
                        busy={busy}
                    >
                        <form
                            noValidate
                            className="flex min-h-0 flex-1 flex-col"
                            onSubmit={(event) => {
                                event.preventDefault();
                                void submit();
                            }}
                        >
                            <PageDialogToolbar>
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
                                    onClick={close}
                                />
                            </PageDialogToolbar>
                            <FormErrorHeader
                                errors={errors}
                                message={message}
                                operation="Pekerjaan belum dibuat"
                            />
                            <PageDialogBody className="py-3">
                                <FormGrid columns={1}>
                                    <FormControl error={errors.name?.[0]}>
                                        <Input
                                            label="Nama pekerjaan"
                                            required
                                            maxLength={120}
                                            data-error-field="name"
                                            value={name}
                                            onChange={(event) =>
                                                setName(event.target.value)
                                            }
                                        />
                                    </FormControl>
                                </FormGrid>
                            </PageDialogBody>
                        </form>
                    </PageDialogContent>
                </PageDialog>
            )}
        </>
    );
}

function OccupationDetail({
    occupation,
    canManage,
    onSaved,
    onDeleted,
}: {
    occupation: Occupation;
    canManage: boolean;
    onSaved: (occupation: Occupation) => void;
    onDeleted: () => void;
}) {
    // Pekerjaan tersimpan langsung terbuka untuk diubah bila pengguna berhak mengubahnya.
    const editing = canManage;
    const [name, setName] = useState(occupation.name);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    const formId = `occupation-${occupation.id}`;

    const submit = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body } = await api.occupationUpdate({
                params: { id: occupation.id },
                body: { name, version: occupation.version },
            });
            toast.success('Pekerjaan disimpan.');
            onSaved(body.data);
        } catch (caught) {
            const failed = failure(caught, 'Perubahan belum disimpan.');
            setErrors(failed.errors);
            setMessage(failed.message);
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        const confirmed = await confirm({
            title: `Delete ${occupation.name}?`,
            description:
                'Pekerjaan ini tidak lagi ditawarkan. Pihak yang sudah memakainya tetap menyimpan pilihannya.',
            confirmLabel: 'Delete',
            destructive: true,
        });
        if (!confirmed) return;
        setBusy(true);
        setMessage(null);
        try {
            await api.occupationDelete({
                params: { id: occupation.id },
                body: { version: occupation.version },
            });
            toast.success('Pekerjaan dihapus.');
            onDeleted();
        } catch (caught) {
            setMessage(errorText(caught, 'Pekerjaan belum dihapus.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-card text-foreground">
            <RecordActionBar title={occupation.name}>
                {editing && (
                    <>
                        <ActionButton
                            action="save"
                            type="submit"
                            form={formId}
                            disabled={busy}
                            pending={busy}
                        />
                        <ActionButton
                            action="cancel"
                            disabled={busy}
                            onClick={() => {
                                setName(occupation.name);
                                setErrors({});
                                setMessage(null);
                            }}
                        />
                        <ActionButton
                            action="delete"
                            disabled={busy}
                            onClick={() => void remove()}
                        />
                    </>
                )}
            </RecordActionBar>
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
                <form
                    noValidate
                    id={formId}
                    onSubmit={(event) => {
                        event.preventDefault();
                        void submit();
                    }}
                >
                    <FormErrorHeader
                        errors={errors}
                        message={message}
                        operation="Perubahan belum disimpan"
                    />
                    <FormGrid columns={1}>
                        <FormControl error={errors.name?.[0]}>
                            <Input
                                label="Nama pekerjaan"
                                required
                                maxLength={120}
                                data-error-field="name"
                                value={name}
                                readOnly={!editing}
                                onChange={(event) =>
                                    setName(event.target.value)
                                }
                            />
                        </FormControl>
                    </FormGrid>
                </form>
            </div>
            {confirmation}
        </div>
    );
}

function OccupationsPage(): ReactNode {
    const { data: metadata } = useSuspenseQuery(
        orpc.partyMetadata.queryOptions({
            select: (response) => response.body.data,
        }),
    );
    const { q = '' } = route.useSearch();
    const navigate = route.useNavigate();
    const [selected, setSelected] = useState<Occupation | null>(null);
    const [showDetail, setShowDetail] = useState(false);
    const loader = useCallback<ListLoader<Occupation>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.occupationList(
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
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: q,
        getKey: (item) => item.id,
    });
    const saved = (occupation: Occupation) => {
        setSelected(occupation);
        setShowDetail(true);
        list.reload();
    };

    return (
        <ListPageLayout
            header={
                <RecordActionBar
                    title="Pekerjaan"
                    search={{
                        value: q,
                        onValueChange: (next) =>
                            void navigate({
                                search: next ? { q: next } : {},
                                replace: true,
                            }),
                        label: 'Cari pekerjaan',
                        placeholder: 'Cari nama...',
                    }}
                >
                    {metadata.canManage && (
                        <CreateOccupation onCreated={saved} />
                    )}
                </RecordActionBar>
            }
        >
            <MasterDetailLayout
                detailOpen={showDetail}
                onDetailOpenChange={setShowDetail}
                list={
                    <aside className="flex h-full min-h-0 min-w-0 flex-col">
                        <DataTable
                            data={list.items}
                            getRowKey={(item) => item.id}
                            columns={[
                                {
                                    id: 'name',
                                    header: 'Nama',
                                    cell: (item) => (
                                        <DataTableText>
                                            {item.name}
                                        </DataTableText>
                                    ),
                                    sortValue: (item) => item.name,
                                },
                            ]}
                            activeRowKey={selected?.id}
                            rowActivation="single-click"
                            onRowClick={(item) => {
                                setShowDetail(true);
                                setSelected(item);
                            }}
                            sort={list.sort}
                            onSortChange={list.onSortChange}
                            serverSort
                            incremental={list}
                            emptyMessage={
                                metadata.canManage
                                    ? 'Belum ada pekerjaan yang cocok. Pilih Baru untuk menambah.'
                                    : 'Belum ada pekerjaan yang cocok.'
                            }
                        />
                    </aside>
                }
            >
                <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
                    {selected ? (
                        <OccupationDetail
                            key={`${selected.id}:${selected.version}`}
                            occupation={selected}
                            canManage={metadata.canManage}
                            onSaved={saved}
                            onDeleted={() => {
                                setSelected(null);
                                setShowDetail(false);
                                list.reload();
                            }}
                        />
                    ) : (
                        <Empty>
                            <EmptyHeader>
                                <EmptyTitle>Pilih pekerjaan</EmptyTitle>
                                <EmptyDescription>
                                    Pilih pekerjaan dari daftar untuk melihat
                                    atau mengubahnya.
                                </EmptyDescription>
                            </EmptyHeader>
                        </Empty>
                    )}
                </div>
            </MasterDetailLayout>
        </ListPageLayout>
    );
}

export const page = definePage({
    path: '/sysadmin/address-book/occupations',
    previousPaths: ['/settings/occupations'],
    layout: 'app',
    title: 'Pekerjaan',
    validateSearch: z.object({ q: z.string().max(200).optional() }),
    component: OccupationsPage,
});
