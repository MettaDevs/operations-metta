import { ActionButton } from '@operations-metta/ui/action-button';
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
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { api, definePage } from '../../../platform/shell/index.ts';
import {
    InventoryPeriodCard,
    type InventoryPeriod,
    type PeriodPermissions,
} from './inventory-period-card.tsx';

const route = getRouteApi('/_app/sysadmin/inventory/periods');
const searchSchema = z.object({ q: z.string().max(200).optional() });

type Open = { kind: 'record'; period: InventoryPeriod } | { kind: 'new' };

// Periode persediaan per legal entity, terbaru di atas (Inventory Periods di BC).
function InventoryPeriodsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [open, setOpen] = useState<Open | null>(null);
    const [can, setCan] = useState<PeriodPermissions>({
        manage: false,
        close: false,
        reopen: false,
    });
    const loader = useCallback<ListLoader<InventoryPeriod>>(
        async ({ query, cursor, signal }) => {
            const { body } = await api.inventoryPeriodList(
                { query: { q: query, ...(cursor ? { cursor } : {}) } },
                { signal },
            );
            setCan({
                manage: body.can_manage,
                close: body.can_close,
                reopen: body.can_reopen,
            });
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (period) => period.id,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Periode persediaan"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: { q: q || undefined },
                                    replace: true,
                                }),
                            label: 'Cari periode persediaan',
                            placeholder: 'Cari nama periode...',
                        }}
                    >
                        {can.manage && (
                            <ActionButton
                                action="create"
                                onClick={() => setOpen({ kind: 'new' })}
                            />
                        )}
                    </RecordActionBar>
                }
                footer={
                    <p className="p-3 text-sm text-muted-foreground">
                        {list.items.length} periode dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(period) => period.id}
                    getRowLabel={(period) => period.name}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, period) =>
                        setOpen({ kind: 'record', period })
                    }
                    onRowClick={(period) => setOpen({ kind: 'record', period })}
                    incremental={list}
                    emptyMessage={
                        can.manage
                            ? 'Belum ada periode persediaan. Pilih Baru untuk menambahkan.'
                            : 'Belum ada periode persediaan.'
                    }
                    columns={[
                        {
                            id: 'ending_date',
                            header: 'Tanggal akhir',
                            width: 140,
                            cell: (period) => (
                                <DataTableText>
                                    {displayDate(period.ending_date)}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 220,
                            cell: (period) => (
                                <DataTableText>{period.name}</DataTableText>
                            ),
                        },
                        {
                            id: 'closed',
                            header: 'Status',
                            width: 120,
                            cell: (period) => (
                                <DataTableText>
                                    {period.closed ? 'Ditutup' : 'Terbuka'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'closed_by',
                            header: 'Ditutup oleh',
                            width: 220,
                            cell: (period) => (
                                <DataTableText>
                                    {period.closed
                                        ? (period.closed_stamp?.user_name ?? '')
                                        : ''}
                                </DataTableText>
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
                    <PageDialogContent title="Periode persediaan">
                        <InventoryPeriodCard
                            key={
                                open.kind === 'new'
                                    ? 'new'
                                    : `${open.period.id}:${open.period.version}`
                            }
                            record={open.kind === 'record' ? open.period : null}
                            can={can}
                            onSaved={(period) => {
                                setOpen({ kind: 'record', period });
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
    path: '/sysadmin/inventory/periods',
    layout: 'app',
    title: 'Periode persediaan',
    validateSearch: searchSchema,
    component: InventoryPeriodsPage,
});
