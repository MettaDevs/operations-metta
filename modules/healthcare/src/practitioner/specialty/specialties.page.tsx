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
import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { api, definePage, orpc } from '@core/platform/shell/index.ts';
import { SpecialtyCard, type Specialty } from './specialty-card.tsx';

// Spesialis tenaga kesehatan dengan sub spesialisnya, layar Specialist sistem lama: kartu Nama dengan grid Sub Spesialis.
// Spesialis dipilih di kartu nakes.

const route = getRouteApi('/_app/healthcare/practitioner/specialties');
const searchSchema = z.object({ q: z.string().max(200).optional() });

function SpecialtiesPage(): ReactNode {
    const { data: metadata } = useSuspenseQuery(
        orpc.healthcareSpecialtyMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const { permissions } = metadata;
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const contentRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState<Specialty | 'new' | null>(null);
    const loader = useCallback<ListLoader<Specialty>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.healthcareSpecialtyList(
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
        getKey: (specialty) => specialty.id,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Spesialis"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: q ? { q } : {},
                                    replace: true,
                                }),
                            label: 'Cari spesialis',
                            placeholder: 'Cari nama...',
                        }}
                    >
                        {permissions.create && (
                            <ActionButton
                                action="create"
                                onClick={() => setOpen('new')}
                            />
                        )}
                    </RecordActionBar>
                }
                footer={
                    <p className="p-3 text-sm text-muted-foreground">
                        {list.items.length} spesialis dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(specialty) => specialty.id}
                    getRowLabel={(specialty) => specialty.name}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, specialty) => setOpen(specialty)}
                    onRowClick={(specialty) => setOpen(specialty)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        permissions.create
                            ? 'Belum ada spesialis yang cocok. Pilih Baru untuk menambahkan.'
                            : 'Belum ada spesialis yang cocok.'
                    }
                    columns={[
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 280,
                            cell: (specialty) => (
                                <DataTableText>{specialty.name}</DataTableText>
                            ),
                            sortValue: (specialty) => specialty.name,
                        },
                        {
                            id: 'subspecialties',
                            header: 'Sub Spesialis',
                            width: 420,
                            cell: (specialty) => (
                                <DataTableText>
                                    {specialty.subspecialties
                                        .map((line) => line.name)
                                        .join(', ') || '—'}
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
                    <PageDialogContent ref={contentRef} title="Spesialis">
                        <SpecialtyCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            specialty={open === 'new' ? null : open}
                            permissions={permissions}
                            portalContainer={contentRef}
                            onSaved={(specialty) => {
                                setOpen(specialty);
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
    path: '/healthcare/practitioner/specialties',
    layout: 'app',
    title: 'Spesialis',
    validateSearch: searchSchema,
    component: SpecialtiesPage,
});
