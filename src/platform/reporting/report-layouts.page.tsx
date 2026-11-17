import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import {
    PageDialog,
    PageDialogContent,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { definePage, orpc } from '../shell/index.ts';
import { ReportLayoutCard, type ReportEntry } from './report-layout-card.tsx';

// Sys Admin › Layout cetak (Report Layout Selection dan Custom Report Layouts BC): setiap dokumen cetak beserta layout
// yang dipakai legal entity tempat kerja. Layout diganti dengan mengunggah berkas Word, bukan dengan mengubah kode.

function ReportLayoutsPage(): ReactNode {
    const listed = useQuery(
        orpc.reportLayoutCatalogue.queryOptions({
            select: (response) => response.body,
        }),
    );
    const [open, setOpen] = useState<string | null>(null);
    const rows = listed.data?.data ?? [];
    const selected = rows.find((row) => row.code === open);
    const text = (value: string) => <DataTableText>{value}</DataTableText>;
    const used = (row: ReportEntry) =>
        row.layouts.find((layout) => layout.is_default);
    return (
        <>
            <ListPageLayout
                header={<RecordActionBar title="Layout cetak" />}
                footer={
                    <p className="p-3 text-sm text-muted-foreground">
                        {rows.length} dokumen cetak
                    </p>
                }
            >
                <DataTable
                    data={rows}
                    getRowKey={(row) => row.code}
                    getRowLabel={(row) => row.name}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, row) => setOpen(row.code)}
                    onRowClick={(row) => setOpen(row.code)}
                    emptyMessage="Belum ada dokumen cetak yang bisa Anda atur."
                    columns={[
                        {
                            id: 'name',
                            header: 'Dokumen',
                            width: 220,
                            cell: (row) => text(row.name),
                        },
                        {
                            id: 'layout',
                            header: 'Layout yang dipakai',
                            width: 240,
                            cell: (row) => text(used(row)?.name ?? ''),
                        },
                        {
                            id: 'source',
                            header: 'Sumber',
                            width: 120,
                            cell: (row) =>
                                text(
                                    used(row)?.source === 'upload'
                                        ? 'Unggahan'
                                        : 'Bawaan',
                                ),
                        },
                        {
                            id: 'paper',
                            header: 'Kertas',
                            width: 140,
                            cell: (row) => {
                                const paper = used(row)?.paper;
                                return text(
                                    paper
                                        ? `${paper.widthMm} × ${paper.heightMm} mm`
                                        : '',
                                );
                            },
                        },
                    ]}
                />
            </ListPageLayout>
            {selected && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setOpen(null);
                    }}
                >
                    <PageDialogContent title="Layout cetak">
                        <ReportLayoutCard
                            report={selected}
                            canManage={listed.data?.can_manage ?? false}
                            onChanged={() => void listed.refetch()}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
        </>
    );
}

export const page = definePage({
    path: '/sysadmin/reporting/report-layouts',
    layout: 'app',
    title: 'Layout cetak',
    component: ReportLayoutsPage,
});
