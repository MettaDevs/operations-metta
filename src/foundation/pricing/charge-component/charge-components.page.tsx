import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
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
    ChargeComponentCard,
    type ChargeComponent,
} from './charge-component-card.tsx';

// Komponen biaya (Komponen jasa di Setup Jasa sistem lama): bagian yang menyusun satu tarif, misalnya jasa sarana dan
// jasa pelayanan puskesmas. Tarif sama dengan jumlah nilai komponennya.

const route = getRouteApi('/_app/sysadmin/pricing/charge-components');
const searchSchema = z.object({ q: z.string().max(200).optional() });

function ChargeComponentsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [open, setOpen] = useState<ChargeComponent | 'new' | null>(null);
    const [canManage, setCanManage] = useState(false);
    const loader = useCallback<ListLoader<ChargeComponent>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.pricingChargeComponentList(
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
            setCanManage(body.can_manage);
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (component) => component.id,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Komponen biaya"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: { q: q || undefined },
                                    replace: true,
                                }),
                            label: 'Cari komponen biaya',
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
                        {list.items.length} komponen biaya dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(component) => component.id}
                    getRowLabel={(component) =>
                        `${component.code} ${component.name}`
                    }
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, component) => setOpen(component)}
                    onRowClick={(component) => setOpen(component)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        canManage
                            ? 'Belum ada komponen biaya yang cocok. Pilih Baru untuk menambahkan.'
                            : 'Belum ada komponen biaya yang cocok.'
                    }
                    columns={[
                        {
                            id: 'sort_order',
                            header: 'Urutan',
                            width: 90,
                            cell: (component) => (
                                <DataTableText>
                                    {component.sort_order}
                                </DataTableText>
                            ),
                            sortValue: (component) => component.sort_order,
                        },
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 140,
                            cell: (component) => (
                                <DataTableText>{component.code}</DataTableText>
                            ),
                            sortValue: (component) => component.code,
                        },
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 280,
                            cell: (component) => (
                                <DataTableText>{component.name}</DataTableText>
                            ),
                            sortValue: (component) => component.name,
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 110,
                            cell: (component) => (
                                <Badge
                                    variant={
                                        component.is_active
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {component.is_active ? 'Aktif' : 'Nonaktif'}
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
                    <PageDialogContent title="Komponen biaya">
                        <ChargeComponentCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            record={open === 'new' ? null : open}
                            canManage={canManage}
                            onSaved={(component) => {
                                setOpen(component);
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
    path: '/sysadmin/pricing/charge-components',
    layout: 'app',
    title: 'Komponen biaya',
    validateSearch: searchSchema,
    component: ChargeComponentsPage,
});
