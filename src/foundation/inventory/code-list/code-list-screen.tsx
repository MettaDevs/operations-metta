import { ActionButton } from '@operations-metta/ui/action-button';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
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
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    ApiError,
    errorText,
    FormErrorHeader,
} from '../../../platform/shell/index.ts';

export type CodeEntry = {
    id: string;
    code: string;
    name: string;
    version: number;
};
type Errors = Record<string, string[]>;
type Fields = { code: string; name: string };

// Endpoint satu daftar kode (kode pendek yang diketik pengguna dan nama), misalnya sumber dana atau program.
export type CodeListSource = {
    title: string;
    label: string;
    list: (
        query: {
            q: string;
            cursor?: string;
            sort?: string;
            direction?: 'asc' | 'desc';
        },
        signal: AbortSignal,
    ) => Promise<{
        data: CodeEntry[];
        next_cursor: string | null;
        can_manage: boolean;
    }>;
    create: (body: Fields) => Promise<CodeEntry>;
    update: (
        id: string,
        body: Fields & { version: number },
    ) => Promise<CodeEntry>;
    remove: (id: string, version: number) => Promise<unknown>;
};

export function CodeEntryCard({
    source,
    entry,
    canManage,
    onSaved,
    onClose,
}: {
    source: CodeListSource;
    entry: CodeEntry | null;
    canManage: boolean;
    onSaved: (entry: CodeEntry) => void;
    onClose: () => void;
}): ReactNode {
    const editing = entry === null || canManage;
    const blank = { code: entry?.code ?? '', name: entry?.name ?? '' };
    const [form, setForm] = useState(blank);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    usePageDialogRecord({
        recordTitle: entry
            ? `${entry.code} ${entry.name}`
            : `${source.title} baru`,
        editing,
    });

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const saved = entry
                ? await source.update(entry.id, {
                      ...form,
                      version: entry.version,
                  })
                : await source.create(form);
            toast.success(
                entry
                    ? `${source.title} diperbarui.`
                    : `${source.title} dibuat.`,
            );
            onSaved(saved);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else
                setMessage(
                    errorText(caught, `${source.title} belum disimpan.`),
                );
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!entry) return;
        if (
            !(await confirm({
                title: `Delete ${source.label} ${entry.code}?`,
                description: `${source.title} ini tidak bisa dipilih lagi. Yang sudah dipakai penerimaan atau stok tidak bisa dihapus.`,
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        setErrors({});
        try {
            await source.remove(entry.id, entry.version);
            toast.success(`${source.title} dihapus.`);
            onClose();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else
                setMessage(errorText(caught, `${source.title} belum dihapus.`));
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
                                if (!entry) {
                                    onClose();
                                    return;
                                }
                                setForm(blank);
                                setErrors({});
                            }}
                        />
                    </>
                )}
                {entry && canManage && (
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
                operation={`${source.title} belum disimpan`}
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
                </FormGrid>
            </PageDialogBody>
            {confirmation}
        </form>
    );
}

// Daftar kode milik legal entity aktif dengan kartu Baru/Ubah/Delete, seperti daftar Code dan Description di BC.
export function CodeListScreen({
    source,
    query,
    onQueryChange,
}: {
    source: CodeListSource;
    query: string;
    onQueryChange: (query: string) => void;
}): ReactNode {
    const [open, setOpen] = useState<CodeEntry | 'new' | null>(null);
    const [canManage, setCanManage] = useState(false);
    const loader = useCallback<ListLoader<CodeEntry>>(
        async ({ query: q, cursor, sort, signal }) => {
            const body = await source.list(
                {
                    q,
                    ...(cursor ? { cursor } : {}),
                    ...(sort
                        ? { sort: sort.columnId, direction: sort.direction }
                        : {}),
                },
                signal,
            );
            setCanManage(body.can_manage);
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [source],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query,
        getKey: (entry) => entry.id,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title={source.title}
                        search={{
                            value: query,
                            onValueChange: onQueryChange,
                            label: `Cari ${source.label}`,
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
                        {list.items.length} {source.label} dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(entry) => entry.id}
                    getRowLabel={(entry) => entry.name}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, entry) => setOpen(entry)}
                    onRowClick={(entry) => setOpen(entry)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        canManage
                            ? `Belum ada ${source.label}. Pilih Baru untuk menambahkan.`
                            : `Belum ada ${source.label}.`
                    }
                    columns={[
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 140,
                            cell: (entry) => (
                                <DataTableText>{entry.code}</DataTableText>
                            ),
                            sortValue: (entry) => entry.code,
                        },
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 320,
                            cell: (entry) => (
                                <DataTableText>{entry.name}</DataTableText>
                            ),
                            sortValue: (entry) => entry.name,
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
                    <PageDialogContent title={source.title}>
                        <CodeEntryCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            source={source}
                            entry={open === 'new' ? null : open}
                            canManage={canManage}
                            onSaved={(entry) => {
                                setOpen(entry);
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
