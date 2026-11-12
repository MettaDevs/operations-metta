import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { displayDate } from '@operations-metta/ui/date-picker';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import {
    PageDialog,
    PageDialogContent,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import {
    api,
    definePage,
    errorText,
    orpc,
    type ApiBody,
} from '../../../platform/shell/index.ts';
import {
    StockCountCard,
    stockCountStatusLabels,
    type StockCountPermissions,
} from './stock-count-card.tsx';

// Opname stok (Physical Inventory Orders di BC): draf, selesai dihitung, diposting, atau dibatalkan. Dokumen dibuka
// lewat `?document=<id>`, supaya layar lain, misalnya kartu stok, bisa menautkan opnamenya langsung.

const route = getRouteApi('/_app/sysadmin/inventory/stock-counts');
type Row = ApiBody<'inventoryStockCountList'>['data'][number];
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    document: z.string().max(100).optional(),
});
type Search = z.infer<typeof searchSchema>;
const noPermissions: StockCountPermissions = {
    update: false,
    post: false,
    reverse: false,
};

function StockCountsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const contentRef = useRef<HTMLDivElement>(null);
    // Nomor kartu baru yang sedang terbuka; 0 berarti tidak sedang membuat opname.
    const [creating, setCreating] = useState(0);
    const setSearch = (next: Partial<Search>, replace = true) =>
        navigate({
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
    const opened = useQuery({
        ...orpc.inventoryStockCountShow.queryOptions({
            input: { params: { id: search.document ?? '' } },
            select: (response) => response.body,
        }),
        enabled: search.document !== undefined && creating === 0,
    });
    const [listPermissions, setPermissions] =
        useState<StockCountPermissions>(noPermissions);
    const loader = useCallback<ListLoader<Row>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.inventoryStockCountList(
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
            setPermissions(body.permissions);
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (row) => row.id,
    });
    const permissions = opened.data?.permissions ?? listPermissions;
    const show = (row: Row) => void setSearch({ document: row.id }, false);
    const close = () => {
        setCreating(0);
        void setSearch({ document: undefined }, false);
        list.reload();
    };

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Opname stok"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: q ? { q } : {},
                                    replace: true,
                                }),
                            label: 'Cari opname',
                            placeholder:
                                'Cari nomor, lokasi, atau keterangan...',
                        }}
                    >
                        {permissions.update && (
                            <ActionButton
                                action="create"
                                onClick={() => {
                                    void setSearch({ document: undefined });
                                    setCreating((key) => key + 1);
                                }}
                            />
                        )}
                    </RecordActionBar>
                }
                footer={
                    <p className="p-3 text-sm text-muted-foreground">
                        {list.items.length} opname dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(row) => row.id}
                    getRowLabel={(row) => row.number}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    activeRowKey={search.document}
                    onRowAction={(_, row) => show(row)}
                    onRowClick={(row) => show(row)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        permissions.update
                            ? 'Belum ada opname. Pilih Baru untuk menghitung stok satu lokasi.'
                            : 'Belum ada opname.'
                    }
                    columns={[
                        {
                            id: 'number',
                            header: 'Nomor',
                            width: 140,
                            cell: (row) => (
                                <DataTableText>{row.number}</DataTableText>
                            ),
                            sortValue: (row) => row.number,
                        },
                        {
                            id: 'count_date',
                            header: 'Tanggal hitung',
                            width: 120,
                            cell: (row) => (
                                <DataTableText>
                                    {displayDate(row.count_date)}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.count_date,
                        },
                        {
                            id: 'location',
                            header: 'Lokasi',
                            width: 200,
                            cell: (row) => (
                                <DataTableText>
                                    {row.location.name}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.location.code,
                        },
                        {
                            id: 'line_count',
                            header: 'Baris',
                            width: 80,
                            align: 'right',
                            cell: (row) => (
                                <DataTableText>{row.line_count}</DataTableText>
                            ),
                        },
                        {
                            id: 'posting_date',
                            header: 'Tanggal posting',
                            width: 120,
                            cell: (row) => (
                                <DataTableText>
                                    {displayDate(row.posting_date)}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.posting_date,
                        },
                        {
                            id: 'description',
                            header: 'Keterangan',
                            width: 220,
                            cell: (row) => (
                                <DataTableText>
                                    {row.description ?? ''}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 140,
                            cell: (row) => (
                                <Badge
                                    variant={
                                        row.status === 'draf' ||
                                        row.status === 'dihitung'
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {stockCountStatusLabels[row.status]}
                                </Badge>
                            ),
                            sortValue: (row) => row.status,
                        },
                    ]}
                />
            </ListPageLayout>
            {(creating > 0 || search.document) && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) close();
                    }}
                >
                    <PageDialogContent
                        ref={contentRef}
                        title="Opname stok"
                        defaultExpanded
                        onEscapeKeyDown={(event) => {
                            if (
                                contentRef.current?.querySelector(
                                    '[role="combobox"][aria-expanded="true"]',
                                )
                            )
                                event.preventDefault();
                        }}
                    >
                        {creating > 0 ? (
                            <StockCountCard
                                key={`baru-${creating}`}
                                count={null}
                                permissions={permissions}
                                portalContainer={contentRef}
                                onSaved={(count) => {
                                    list.reload();
                                    void setSearch(
                                        { document: count.id },
                                        false,
                                    ).then(() => setCreating(0));
                                }}
                                onClose={close}
                            />
                        ) : opened.data ? (
                            <StockCountCard
                                key={opened.data.data.id}
                                count={opened.data.data}
                                permissions={permissions}
                                portalContainer={contentRef}
                                onSaved={() => list.reload()}
                                onClose={close}
                            />
                        ) : (
                            <p className="p-6 text-sm text-muted-foreground">
                                {opened.isError
                                    ? errorText(
                                          opened.error,
                                          'Opname belum bisa dibuka.',
                                      )
                                    : 'Memuat opname…'}
                            </p>
                        )}
                    </PageDialogContent>
                </PageDialog>
            )}
        </>
    );
}

export const page = definePage({
    path: '/sysadmin/inventory/stock-counts',
    layout: 'app',
    title: 'Opname stok',
    validateSearch: searchSchema,
    component: StockCountsPage,
});
