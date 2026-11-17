import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { Button } from '@operations-metta/ui/button';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { displayDate } from '@operations-metta/ui/date-picker';
import { displayNumber } from '@operations-metta/ui/display-number';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import {
    PageDialog,
    PageDialogContent,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { getRouteApi } from '@tanstack/react-router';
import { ClipboardCheck } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
    api,
    ApiError,
    definePage,
    errorText,
    type ApiBody,
} from '../../../platform/shell/index.ts';
import { today, unitText } from '../purchase-lines.tsx';
import {
    RequisitionCard,
    type Requisition,
    type RequisitionPermissions,
} from './requisition-card.tsx';

// Permintaan pembelian (Requisition Worksheet di BC): baris yang belum dipesan, dan baris yang sudah menjadi purchase
// order. Buat purchase order memproses semua baris yang disetujui.

const route = getRouteApi('/_app/sysadmin/purchasing/requisitions');
type Row = ApiBody<'purchasingRequisitionList'>['data'][number];
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    status: z.enum(['terbuka', 'diproses']).optional(),
});
const noPermissions: RequisitionPermissions = {
    update: false,
    process: false,
};

function RequisitionsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const status = search.status ?? 'terbuka';
    const contentRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState<Requisition | 'new' | null>(null);
    const [opened, setOpened] = useState(0);
    const [busy, setBusy] = useState(false);
    const { confirm, confirmation } = useConfirmation();
    const openCard = (target: Requisition | 'new') => {
        setOpened((count) => count + 1);
        setOpen(target);
    };
    const [permissions, setPermissions] =
        useState<RequisitionPermissions>(noPermissions);
    const loader = useCallback<ListLoader<Row>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.purchasingRequisitionList(
                {
                    query: {
                        q: query,
                        status,
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
        [status],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (row) => row.id,
    });
    const show = async (row: Row) => {
        try {
            const { body } = await api.purchasingRequisitionShow({
                params: { id: row.id },
            });
            setPermissions(body.permissions);
            openCard(body.data);
        } catch (caught) {
            toast.error(errorText(caught, 'Permintaan belum bisa dibuka.'));
        }
    };
    const accepted = list.items.filter((row) => row.accepted).length;

    const carryOut = async () => {
        if (
            !(await confirm({
                title: 'Buat purchase order?',
                description: `Semua permintaan yang disetujui dibuatkan purchase order terbuka, satu order per vendor dan lokasi. Order bisa diperiksa dan diubah sebelum dirilis.`,
                confirmLabel: 'Buat purchase order',
            }))
        )
            return;
        setBusy(true);
        try {
            const { body } = await api.purchasingRequisitionCarryOut({
                body: { order_date: today() },
            });
            toast.success(
                `Purchase order dibuat: ${body.data.map((order) => order.number).join(', ')}. Buka Purchase order untuk memeriksa dan merilisnya.`,
            );
            list.reload();
        } catch (caught) {
            toast.error(
                caught instanceof ApiError && caught.status === 422
                    ? Object.values(caught.errors).flat().join(' ')
                    : errorText(caught, 'Purchase order belum dibuat.'),
            );
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Permintaan pembelian"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: (current) => ({
                                        ...current,
                                        q: q || undefined,
                                    }),
                                    replace: true,
                                }),
                            label: 'Cari permintaan',
                            placeholder: 'Cari barang, lokasi, atau vendor...',
                        }}
                    >
                        {permissions.update && status === 'terbuka' && (
                            <ActionButton
                                action="create"
                                onClick={() => openCard('new')}
                            />
                        )}
                        {permissions.process && status === 'terbuka' && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="command"
                                disabled={busy || accepted === 0}
                                title="Buat purchase order dari semua permintaan yang disetujui."
                                onClick={() => void carryOut()}
                            >
                                <ClipboardCheck aria-hidden="true" />
                                Buat purchase order
                            </Button>
                        )}
                        <Button
                            type="button"
                            variant="ghost"
                            size="command"
                            onClick={() =>
                                void navigate({
                                    search: (current) => ({
                                        ...current,
                                        status:
                                            status === 'terbuka'
                                                ? 'diproses'
                                                : undefined,
                                    }),
                                })
                            }
                        >
                            {status === 'terbuka'
                                ? 'Lihat yang sudah dipesan'
                                : 'Lihat yang belum dipesan'}
                        </Button>
                    </RecordActionBar>
                }
                footer={
                    <p className="p-3 text-sm text-muted-foreground">
                        {list.items.length} permintaan dimuat
                        {status === 'terbuka' && `, ${accepted} disetujui`}
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(row) => row.id}
                    getRowLabel={(row) =>
                        `${row.item.name} untuk ${row.location.name}`
                    }
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
                        status === 'diproses'
                            ? 'Belum ada permintaan yang sudah dipesan.'
                            : permissions.update
                              ? 'Belum ada permintaan. Pilih Baru untuk mengajukan barang yang dibutuhkan.'
                              : 'Belum ada permintaan.'
                    }
                    columns={[
                        {
                            id: 'due_date',
                            header: 'Dibutuhkan',
                            width: 120,
                            cell: (row) => (
                                <DataTableText>
                                    {displayDate(row.due_date)}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.due_date,
                        },
                        {
                            id: 'location',
                            header: 'Untuk lokasi',
                            width: 160,
                            cell: (row) => (
                                <DataTableText>
                                    {row.location.name}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.location.code,
                        },
                        {
                            id: 'item',
                            header: 'Barang',
                            width: 240,
                            cell: (row) => (
                                <DataTableText>{`${row.item.code} - ${row.item.name}`}</DataTableText>
                            ),
                            sortValue: (row) => row.item.name,
                        },
                        {
                            id: 'quantity',
                            header: 'Jumlah',
                            width: 140,
                            align: 'right',
                            cell: (row) => (
                                <DataTableText>
                                    {`${displayNumber(row.quantity)} ${unitText(
                                        {
                                            ...row.unit,
                                            quantity_per_unit:
                                                row.quantity_per_unit,
                                        },
                                        row.item.base_unit,
                                    )}`}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'vendor',
                            header: 'Vendor',
                            width: 200,
                            cell: (row) => (
                                <DataTableText>
                                    {row.vendor?.name ?? ''}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.vendor?.name ?? '',
                        },
                        {
                            id: 'requested_by',
                            header: 'Diminta oleh',
                            width: 160,
                            cell: (row) => (
                                <DataTableText>
                                    {row.requested_by ?? ''}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'order',
                            header:
                                status === 'diproses'
                                    ? 'Purchase order'
                                    : 'Status',
                            width: 140,
                            cell: (row) =>
                                row.order ? (
                                    <DataTableText>
                                        {row.order.number}
                                    </DataTableText>
                                ) : (
                                    <Badge
                                        variant={
                                            row.accepted
                                                ? 'secondary'
                                                : 'outline'
                                        }
                                    >
                                        {row.accepted
                                            ? 'Disetujui'
                                            : 'Diajukan'}
                                    </Badge>
                                ),
                        },
                    ]}
                />
            </ListPageLayout>
            {confirmation}
            {open && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setOpen(null);
                    }}
                >
                    <PageDialogContent
                        ref={contentRef}
                        title="Permintaan pembelian"
                    >
                        <RequisitionCard
                            key={opened}
                            requisition={open === 'new' ? null : open}
                            permissions={permissions}
                            portalContainer={contentRef}
                            onSaved={(requisition) => {
                                setOpen(requisition);
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
    path: '/sysadmin/purchasing/requisitions',
    layout: 'app',
    title: 'Permintaan pembelian',
    validateSearch: searchSchema,
    component: RequisitionsPage,
});
