import { ActionButton } from '@operations-metta/ui/action-button';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import {
    PageDialog,
    PageDialogContent,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import {
    CodeListCard,
    type CodeListEntry,
    type CodeListKind,
} from './code-list-card.tsx';

export const codeListSearchSchema = z.object({
    q: z.string().max(200).optional(),
});
type Search = z.infer<typeof codeListSearchSchema>;

export type CodeListBatch = {
    data: CodeListEntry[];
    next_cursor: string | null;
    can_manage: boolean;
};

// Daftar kode dan nama untuk satuan dan alasan penyesuaian. can_manage datang bersama setiap batch daftar.
export function CodeListPage({
    kind,
    load,
    search,
    onSearchChange,
}: {
    kind: CodeListKind;
    load: (
        query: {
            q: string;
            cursor?: string;
            sort?: string;
            direction?: 'asc' | 'desc';
        },
        signal: AbortSignal,
    ) => Promise<CodeListBatch>;
    search: Search;
    onSearchChange: (next: Search) => void;
}): ReactNode {
    const [open, setOpen] = useState<CodeListEntry | 'new' | null>(null);
    const [canManage, setCanManage] = useState(false);
    const loader = useCallback<ListLoader<CodeListEntry>>(
        async ({ query, cursor, sort, signal }) => {
            const batch = await load(
                {
                    q: query,
                    ...(cursor ? { cursor } : {}),
                    ...(sort
                        ? { sort: sort.columnId, direction: sort.direction }
                        : {}),
                },
                signal,
            );
            setCanManage(batch.can_manage);
            return { items: batch.data, nextCursor: batch.next_cursor };
        },
        [load],
    );
    const items = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (entry) => entry.id,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title={kind.title}
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                onSearchChange({ q: q || undefined }),
                            label: `Cari ${kind.noun}`,
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
                        {items.items.length} baris dimuat
                    </p>
                }
            >
                <DataTable
                    data={items.items}
                    getRowKey={(entry) => entry.id}
                    getRowLabel={(entry) => entry.name}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, entry) => setOpen(entry)}
                    onRowClick={(entry) => setOpen(entry)}
                    sort={items.sort}
                    onSortChange={items.onSortChange}
                    serverSort
                    incremental={items}
                    emptyMessage={
                        canManage
                            ? `Belum ada ${kind.noun} yang cocok. Pilih Baru untuk menambahkan.`
                            : `Belum ada ${kind.noun} yang cocok.`
                    }
                    columns={[
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 160,
                            cell: (entry) => (
                                <DataTableText>{entry.code}</DataTableText>
                            ),
                            sortValue: (entry) => entry.code,
                        },
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 420,
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
                    <PageDialogContent title={kind.title}>
                        <CodeListCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            kind={kind}
                            entry={open === 'new' ? null : open}
                            canManage={canManage}
                            onSaved={(entry) => {
                                setOpen(entry);
                                items.reload();
                            }}
                            onClose={() => {
                                setOpen(null);
                                items.reload();
                            }}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
        </>
    );
}
