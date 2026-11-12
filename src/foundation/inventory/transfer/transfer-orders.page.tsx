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
import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
    api,
    definePage,
    errorText,
    type ApiBody,
} from '../../../platform/shell/index.ts';
import {
    TransferOrderCard,
    transferModeLabels,
    transferOrderStatusLabels,
    type TransferOrder,
    type TransferOrderPermissions,
} from './transfer-order-card.tsx';

// Amprah antar lokasi (Transfer Orders di BC): draf, diajukan, selesai, atau dibatalkan.

const route = getRouteApi('/_app/sysadmin/inventory/transfer-orders');
type Row = ApiBody<'inventoryTransferOrderList'>['data'][number];
const searchSchema = z.object({ q: z.string().max(200).optional() });
const noPermissions: TransferOrderPermissions = {
    update: false,
    ship: false,
    receive: false,
    reverse: false,
};

function TransferOrdersPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const contentRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState<TransferOrder | 'new' | null>(null);
    // Kartu dipasang ulang hanya saat dokumen lain dibuka; menyimpan atau memposting tetap di kartu yang sama.
    const [opened, setOpened] = useState(0);
    const openCard = (target: TransferOrder | 'new') => {
        setOpened((count) => count + 1);
        setOpen(target);
    };
    const [permissions, setPermissions] =
        useState<TransferOrderPermissions>(noPermissions);
    const loader = useCallback<ListLoader<Row>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.inventoryTransferOrderList(
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
    const show = async (row: Row) => {
        try {
            const { body } = await api.inventoryTransferOrderShow({
                params: { id: row.id },
            });
            setPermissions(body.permissions);
            openCard(body.data);
        } catch (caught) {
            toast.error(errorText(caught, 'Amprah belum bisa dibuka.'));
        }
    };

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Amprah"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: q ? { q } : {},
                                    replace: true,
                                }),
                            label: 'Cari amprah',
                            placeholder:
                                'Cari nomor, lokasi peminta, atau lokasi pemasok...',
                        }}
                    >
                        {permissions.update && (
                            <ActionButton
                                action="create"
                                onClick={() => openCard('new')}
                            />
                        )}
                    </RecordActionBar>
                }
                footer={
                    <p className="p-3 text-sm text-muted-foreground">
                        {list.items.length} amprah dimuat
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
                    emptyMessage={
                        permissions.update
                            ? 'Belum ada amprah. Pilih Baru untuk meminta barang dari lokasi lain.'
                            : 'Belum ada amprah.'
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
                            id: 'to_location',
                            header: 'Lokasi peminta',
                            width: 200,
                            cell: (row) => (
                                <DataTableText>
                                    {row.to_location.name}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.to_location.code,
                        },
                        {
                            id: 'from_location',
                            header: 'Lokasi pemasok',
                            width: 200,
                            cell: (row) => (
                                <DataTableText>
                                    {row.from_location.name}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.from_location.code,
                        },
                        {
                            id: 'transfer_mode',
                            header: 'Cara mutasi',
                            width: 150,
                            cell: (row) => (
                                <DataTableText>
                                    {transferModeLabels[row.transfer_mode]}
                                </DataTableText>
                            ),
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
                            width: 120,
                            cell: (row) => (
                                <Badge
                                    variant={
                                        row.status === 'diajukan'
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {transferOrderStatusLabels[row.status]}
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
                    <PageDialogContent
                        ref={contentRef}
                        title="Amprah"
                        defaultExpanded
                    >
                        <TransferOrderCard
                            key={opened}
                            order={open === 'new' ? null : open}
                            permissions={permissions}
                            portalContainer={contentRef}
                            onSaved={(order) => {
                                setOpen(order);
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
    path: '/sysadmin/inventory/transfer-orders',
    layout: 'app',
    title: 'Amprah',
    validateSearch: searchSchema,
    component: TransferOrdersPage,
});
