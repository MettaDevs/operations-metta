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
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { api, errorText, type ApiBody } from '../../../platform/shell/index.ts';
import {
    PostedTransferCard,
    postedTransferLabels,
    postedTransferStatusLabels,
    type PostedTransfer,
    type PostedTransferKind,
} from './posted-transfer-card.tsx';

type Row = ApiBody<'inventoryTransferShipmentList'>['data'][number];
const money = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });

const sources = {
    shipment: {
        list: api.inventoryTransferShipmentList,
        show: api.inventoryTransferShipmentShow,
        empty: 'Belum ada mutasi. Mutasi lahir saat amprah diposting kirim.',
        from: 'Dari',
    },
    receipt: {
        list: api.inventoryTransferReceiptList,
        show: api.inventoryTransferReceiptShow,
        empty: 'Belum ada penerimaan mutasi. Penerimaan lahir saat amprah diposting terima.',
        from: 'Dari transit',
    },
} as const;

// Daftar mutasi atau penerimaan mutasi terposting. Dokumennya dibuka hanya untuk dibaca dan dibatalkan postingnya.
export function PostedTransferList({
    kind,
    query,
    onQueryChange,
}: {
    kind: PostedTransferKind;
    query: string;
    onQueryChange: (query: string) => void;
}): ReactNode {
    const source = sources[kind];
    const title = postedTransferLabels[kind];
    const [open, setOpen] = useState<{
        document: PostedTransfer;
        reverse: boolean;
    } | null>(null);
    const loader = useCallback<ListLoader<Row>>(
        async ({ query: q, cursor, sort, signal }) => {
            const { body } = await source.list(
                {
                    query: {
                        q,
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
        [source],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query,
        getKey: (row) => row.id,
    });
    const show = async (row: Row) => {
        try {
            const { body } = await source.show({ params: { id: row.id } });
            setOpen({ document: body.data, reverse: body.permissions.reverse });
        } catch (caught) {
            toast.error(errorText(caught, `${title} belum bisa dibuka.`));
        }
    };

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title={title}
                        search={{
                            value: query,
                            onValueChange: onQueryChange,
                            label: `Cari ${title.toLowerCase()}`,
                            placeholder: 'Cari nomor, amprah, atau lokasi...',
                        }}
                    />
                }
                footer={
                    <p className="p-3 text-sm text-muted-foreground">
                        {list.items.length} {title.toLowerCase()} dimuat
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
                    onRowAction={(_, row) => void show(row)}
                    onRowClick={(row) => void show(row)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={source.empty}
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
                            id: 'posting_date',
                            header: 'Tanggal',
                            width: 110,
                            cell: (row) => (
                                <DataTableText>
                                    {displayDate(row.posting_date)}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.posting_date,
                        },
                        {
                            id: 'transfer_order',
                            header: 'Amprah',
                            width: 140,
                            cell: (row) => (
                                <DataTableText>
                                    {row.transfer_order.number}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.transfer_order.number,
                        },
                        {
                            id: 'from_location',
                            header: source.from,
                            width: 190,
                            cell: (row) => (
                                <DataTableText>
                                    {row.from_location.name}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.from_location.code,
                        },
                        {
                            id: 'to_location',
                            header: 'Ke',
                            width: 190,
                            cell: (row) => (
                                <DataTableText>
                                    {row.to_location.name}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.to_location.code,
                        },
                        {
                            id: 'amount',
                            header: 'Nilai',
                            width: 130,
                            align: 'right',
                            cell: (row) => (
                                <DataTableText>
                                    {money.format(Number(row.amount))}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 120,
                            cell: (row) => (
                                <Badge
                                    variant={
                                        row.status === 'diposting'
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {postedTransferStatusLabels[row.status]}
                                </Badge>
                            ),
                            sortValue: (row) => row.status,
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
                    <PageDialogContent title={title} defaultExpanded>
                        <PostedTransferCard
                            key={open.document.id}
                            kind={kind}
                            document={open.document}
                            canReverse={open.reverse}
                            orderLink
                            onReversed={() => list.reload()}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
        </>
    );
}
