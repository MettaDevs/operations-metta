import { Badge } from '@operations-metta/ui/badge';
import { Button } from '@operations-metta/ui/button';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { displayNumber } from '@operations-metta/ui/display-number';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import {
    PageDialog,
    PageDialogBody,
    PageDialogContent,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { CircleDot } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import {
    api,
    definePage,
    errorText,
    orpc,
    type ApiBody,
} from '../../../platform/shell/index.ts';
import { ClerkResult, dateTime } from './clerk-result.tsx';

// Daftar Clerk sistem lama: semua clerk di legal entity aktif, terbaru dulu. Selama clerk berjalan jumlahnya masih nol,
// karena jumlah sistem baru dihitung saat Clerk End.

type ClerkRow = ApiBody<'billingClerkList'>['data'][number];

const route = getRouteApi('/_app/billing/clerks');
const searchSchema = z.object({ q: z.string().max(200).optional() });

function ClerkDialog({
    id,
    onClose,
}: {
    id: string;
    onClose: () => void;
}): ReactNode {
    const clerk = useQuery(
        orpc.billingClerkShow.queryOptions({
            input: { params: { id } },
            select: (response) => response.body.data,
        }),
    );
    return (
        <PageDialog
            open
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
        >
            <PageDialogContent title="Lihat Clerk">
                <PageDialogBody className="py-3">
                    {clerk.data ? (
                        <ClerkResult clerk={clerk.data} />
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            {clerk.isError
                                ? errorText(clerk.error, 'Clerk belum dimuat.')
                                : 'Memuat clerk…'}
                        </p>
                    )}
                </PageDialogBody>
            </PageDialogContent>
        </PageDialog>
    );
}

function ClerksPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [open, setOpen] = useState<string | null>(null);
    const loader = useCallback<ListLoader<ClerkRow>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.billingClerkList(
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
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (clerk) => clerk.id,
    });
    const amount = (value: string) => (
        <DataTableText>{displayNumber(value)}</DataTableText>
    );

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Daftar Clerk"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: { q: q || undefined },
                                    replace: true,
                                }),
                            label: 'Cari clerk',
                            placeholder: 'Cari kode atau kasir...',
                        }}
                    >
                        <Button variant="ghost" size="command" asChild>
                            <Link to="/billing/clerk">
                                <CircleDot aria-hidden="true" />
                                Clerk Start / End
                            </Link>
                        </Button>
                    </RecordActionBar>
                }
                footer={
                    <p className="p-3 text-sm text-muted-foreground">
                        {list.items.length} clerk dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(clerk) => clerk.id}
                    getRowLabel={(clerk) => clerk.code}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Lihat' }]}
                    onRowAction={(_, clerk) => setOpen(clerk.id)}
                    onRowClick={(clerk) => setOpen(clerk.id)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage="Belum ada clerk di legal entity ini."
                    columns={[
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 170,
                            cell: (clerk) => (
                                <DataTableText>{clerk.code}</DataTableText>
                            ),
                            sortValue: (clerk) => clerk.code,
                        },
                        {
                            id: 'started_at',
                            header: 'Tanggal',
                            width: 260,
                            cell: (clerk) => (
                                <DataTableText>
                                    {`${dateTime(clerk.started_at)}${clerk.ended_at ? ` s/d ${dateTime(clerk.ended_at)}` : ''}`}
                                </DataTableText>
                            ),
                            sortValue: (clerk) => clerk.started_at,
                        },
                        {
                            id: 'user_name',
                            header: 'Nama',
                            width: 180,
                            cell: (clerk) => (
                                <DataTableText>{clerk.user_name}</DataTableText>
                            ),
                            sortValue: (clerk) => clerk.user_name,
                        },
                        {
                            id: 'transactions',
                            header: 'Jumlah Penjualan',
                            width: 140,
                            align: 'right',
                            cell: (clerk) => amount(String(clerk.transactions)),
                        },
                        {
                            id: 'opening_total',
                            header: 'Uang Awal',
                            width: 140,
                            align: 'right',
                            cell: (clerk) => amount(clerk.opening_total),
                        },
                        {
                            id: 'system_total',
                            header: 'Jumlah Sistem',
                            width: 140,
                            align: 'right',
                            cell: (clerk) => amount(clerk.system_total),
                        },
                        {
                            id: 'clerk_total',
                            header: 'Jumlah Clerk',
                            width: 140,
                            align: 'right',
                            cell: (clerk) => amount(clerk.clerk_total),
                        },
                        {
                            id: 'difference_total',
                            header: 'Jumlah Selisih',
                            width: 140,
                            align: 'right',
                            cell: (clerk) => amount(clerk.difference_total),
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 100,
                            cell: (clerk) => (
                                <Badge
                                    variant={
                                        clerk.status === 'start'
                                            ? 'outline'
                                            : 'secondary'
                                    }
                                >
                                    {clerk.status === 'start' ? 'Start' : 'End'}
                                </Badge>
                            ),
                        },
                    ]}
                />
            </ListPageLayout>
            {open && <ClerkDialog id={open} onClose={() => setOpen(null)} />}
        </>
    );
}

export const page = definePage({
    path: '/billing/clerks',
    layout: 'app',
    title: 'Daftar Clerk',
    validateSearch: searchSchema,
    component: ClerksPage,
});
