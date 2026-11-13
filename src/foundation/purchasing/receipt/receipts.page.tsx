import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { displayDate } from '@operations-metta/ui/date-picker';
import { displayAmount } from '@operations-metta/ui/display-number';
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
    ReceiptCard,
    type Receipt,
    type ReceiptPermissions,
} from './receipt-card.tsx';

// Penerimaan barang dari vendor (Purchase Receipts di BC). Draf, diposting, atau dibatalkan postingnya.

const route = getRouteApi('/_app/sysadmin/purchasing/receipts');
type Row = ApiBody<'purchasingReceiptList'>['data'][number];
const searchSchema = z.object({ q: z.string().max(200).optional() });
const noPermissions: ReceiptPermissions = {
    update: false,
    post: false,
    reverse: false,
    create_vendor: false,
    create_funding_source: false,
    create_procurement_program: false,
};
const statusLabels: Record<Row['status'], string> = {
    draf: 'Draf',
    diposting: 'Diposting',
    dibatalkan: 'Dibatalkan',
};

function ReceiptsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const contentRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState<Receipt | 'new' | null>(null);
    // Kartu dipasang ulang hanya saat dokumen lain dibuka; menyimpan atau memposting tetap di kartu yang sama.
    const [opened, setOpened] = useState(0);
    const openCard = (target: Receipt | 'new') => {
        setOpened((count) => count + 1);
        setOpen(target);
    };
    const [permissions, setPermissions] =
        useState<ReceiptPermissions>(noPermissions);
    // Presisi jumlah mata uang lokal untuk nilai di daftar dan kartu.
    const [amountDecimals, setAmountDecimals] = useState(0);
    const loader = useCallback<ListLoader<Row>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.purchasingReceiptList(
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
            setAmountDecimals(body.amount_decimals);
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
            const { body } = await api.purchasingReceiptShow({
                params: { id: row.id },
            });
            setPermissions(body.permissions);
            setAmountDecimals(body.amount_decimals);
            openCard(body.data);
        } catch (caught) {
            toast.error(errorText(caught, 'Penerimaan belum bisa dibuka.'));
        }
    };

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Penerimaan barang"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: q ? { q } : {},
                                    replace: true,
                                }),
                            label: 'Cari penerimaan',
                            placeholder:
                                'Cari nomor, vendor, lokasi, atau dokumen vendor...',
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
                        {list.items.length} penerimaan dimuat
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
                            ? 'Belum ada penerimaan. Pilih Baru untuk mencatat barang yang datang.'
                            : 'Belum ada penerimaan.'
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
                            id: 'vendor',
                            header: 'Vendor',
                            width: 240,
                            cell: (row) => (
                                <DataTableText>{row.vendor.name}</DataTableText>
                            ),
                            sortValue: (row) => row.vendor.name,
                        },
                        {
                            id: 'location',
                            header: 'Lokasi tujuan',
                            width: 180,
                            cell: (row) => (
                                <DataTableText>
                                    {row.location.name}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.location.code,
                        },
                        {
                            id: 'vendor_document_number',
                            header: 'Dokumen vendor',
                            width: 160,
                            cell: (row) => (
                                <DataTableText>
                                    {row.vendor_document_number ?? ''}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'amount',
                            header: 'Nilai',
                            width: 140,
                            align: 'right',
                            cell: (row) => (
                                <DataTableText>
                                    {displayAmount(row.amount, amountDecimals)}
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
                                    {statusLabels[row.status]}
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
                        title="Penerimaan barang"
                        defaultExpanded
                    >
                        <ReceiptCard
                            key={opened}
                            receipt={open === 'new' ? null : open}
                            permissions={permissions}
                            amountDecimals={amountDecimals}
                            portalContainer={contentRef}
                            onSaved={(receipt) => {
                                setOpen(receipt);
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
    path: '/sysadmin/purchasing/receipts',
    layout: 'app',
    title: 'Penerimaan barang',
    validateSearch: searchSchema,
    component: ReceiptsPage,
});
