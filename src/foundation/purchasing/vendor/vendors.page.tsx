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
import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { api, definePage } from '../../../platform/shell/index.ts';
import { VendorCard, type Vendor } from './vendor-card.tsx';

// Vendor (Vendors di BC): pihak luar tempat barang dibeli, per legal entity.

const route = getRouteApi('/_app/sysadmin/purchasing/vendors');
const searchSchema = z.object({ q: z.string().max(200).optional() });

function VendorsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const contentRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState<Vendor | 'new' | null>(null);
    const [canManage, setCanManage] = useState(false);
    const loader = useCallback<ListLoader<Vendor>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.purchasingVendorList(
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
        getKey: (vendor) => vendor.id,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Vendor"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: q ? { q } : {},
                                    replace: true,
                                }),
                            label: 'Cari vendor',
                            placeholder: 'Cari nomor, nama, atau NPWP...',
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
                        {list.items.length} vendor dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(vendor) => vendor.id}
                    getRowLabel={(vendor) => vendor.name}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, vendor) => setOpen(vendor)}
                    onRowClick={(vendor) => setOpen(vendor)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        canManage
                            ? 'Belum ada vendor. Pilih Baru untuk menambahkan.'
                            : 'Belum ada vendor.'
                    }
                    columns={[
                        {
                            id: 'number',
                            header: 'Nomor',
                            width: 140,
                            cell: (vendor) => (
                                <DataTableText>{vendor.number}</DataTableText>
                            ),
                            sortValue: (vendor) => vendor.number,
                        },
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 280,
                            cell: (vendor) => (
                                <DataTableText>{vendor.name}</DataTableText>
                            ),
                            sortValue: (vendor) => vendor.name,
                        },
                        {
                            id: 'tax_number',
                            header: 'NPWP',
                            width: 200,
                            cell: (vendor) => (
                                <DataTableText>
                                    {vendor.tax_number ?? ''}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 110,
                            cell: (vendor) => (
                                <Badge
                                    variant={
                                        vendor.status === 'active'
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {vendor.status === 'active'
                                        ? 'Aktif'
                                        : 'Nonaktif'}
                                </Badge>
                            ),
                            sortValue: (vendor) => vendor.status,
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
                    <PageDialogContent ref={contentRef} title="Vendor">
                        <VendorCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            vendor={open === 'new' ? null : open}
                            canManage={canManage}
                            portalContainer={contentRef}
                            onSaved={(vendor) => {
                                setOpen(vendor);
                                list.reload();
                            }}
                            onClose={() => setOpen(null)}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
        </>
    );
}

export const page = definePage({
    path: '/sysadmin/purchasing/vendors',
    layout: 'app',
    title: 'Vendor',
    validateSearch: searchSchema,
    component: VendorsPage,
});
