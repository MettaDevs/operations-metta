import { Badge } from '@operations-metta/ui/badge';
import { Button } from '@operations-metta/ui/button';
import {
    CollapsibleSection,
    CollapsibleSectionGroup,
} from '@operations-metta/ui/collapsible-section';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialogBody,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { Select } from '@operations-metta/ui/select';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    download,
    errorText,
    fetchFile,
    FormErrorHeader,
    openOrDownload,
    type ApiBody,
} from '../shell/index.ts';

export type ReportEntry = ApiBody<'reportLayoutCatalogue'>['data'][number];
type Layout = ReportEntry['layouts'][number];

const languageItems = [
    { value: 'id', label: 'Indonesia' },
    { value: 'en', label: 'Inggris' },
];
const languageLabel = (language: string) =>
    languageItems.find((item) => item.value === language)?.label ?? language;

const formatLabels = { docx: 'Word', xlsx: 'Excel' } as const;

const layoutPath = (code: string, ref: string, suffix: string) =>
    `/api/v1/reports/${encodeURIComponent(code)}/layouts/${encodeURIComponent(ref)}/${suffix}`;

// Kartu layout satu laporan: layout bawaan dan unggahan legal entity tempat kerja, unggah layout baru, pratinjau dengan
// data contoh, dan field yang boleh dipakai penulis layout di Word dan di Excel.
export function ReportLayoutCard({
    report,
    canManage,
    onChanged,
}: {
    report: ReportEntry;
    canManage: boolean;
    onChanged: () => void;
}): ReactNode {
    usePageDialogRecord({ recordTitle: report.name, editing: false });
    const { confirm, confirmation } = useConfirmation();
    const [file, setFile] = useState<File | null>(null);
    const [name, setName] = useState('');
    const [language, setLanguage] = useState('id');
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const portalContainer = useRef<HTMLDivElement>(null);
    const builtin = report.layouts.find(
        (layout) => layout.source === 'builtin',
    );
    const used = report.layouts.find((layout) => layout.is_default);

    async function run(work: () => Promise<{ message: string }>) {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            toast.success((await work()).message);
            onChanged();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Layout belum disimpan.'));
        } finally {
            setBusy(false);
        }
    }

    const upload = async () => {
        if (!file) {
            setErrors({
                file: [
                    'Pilih berkas Word (.docx) atau Excel (.xlsx) lebih dulu.',
                ],
            });
            return;
        }
        await run(async () => {
            const { body } = await api.reportLayoutUpload({
                params: { code: report.code },
                body: {
                    file,
                    name: name || file.name.replace(/\.(docx|xlsx)$/i, ''),
                    language: language === 'en' ? 'en' : 'id',
                },
            });
            setFile(null);
            setName('');
            if (fileInput.current) fileInput.current.value = '';
            return body;
        });
    };

    const choose = (layout: Layout) =>
        run(
            async () =>
                (
                    await api.reportLayoutChoose({
                        params: { code: report.code },
                        body: { layout: layout.ref },
                    })
                ).body,
        );

    const remove = async (layout: Layout) => {
        if (
            !(await confirm({
                title: `Hapus layout ${layout.name}?`,
                description: layout.is_default
                    ? 'Layout ini sedang dipakai. Sesudah dihapus, dokumen dicetak dengan layout bawaan.'
                    : 'Layout ini tidak bisa dipilih lagi sesudah dihapus.',
                confirmLabel: 'Hapus',
                destructive: true,
            }))
        )
            return;
        await run(
            async () =>
                (
                    await api.reportLayoutRemove({
                        params: { code: report.code, ref: layout.ref },
                        body: {},
                    })
                ).body,
        );
    };

    const preview = async (layout: Layout) => {
        try {
            await openOrDownload(
                layoutPath(report.code, layout.ref, 'preview'),
            );
        } catch (caught) {
            toast.error(errorText(caught, 'Pratinjau belum bisa dibuat.'));
        }
    };

    const saveFile = async (layout: Layout) => {
        try {
            download(
                await fetchFile(layoutPath(report.code, layout.ref, 'file')),
            );
        } catch (caught) {
            toast.error(errorText(caught, 'Layout belum bisa diunduh.'));
        }
    };

    const text = (value: string) => <DataTableText>{value}</DataTableText>;
    return (
        <div ref={portalContainer} className="flex min-h-0 flex-1 flex-col">
            <PageDialogToolbar>
                {canManage && used?.source === 'upload' && builtin && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="command"
                        disabled={busy}
                        onClick={() => void choose(builtin)}
                    >
                        Kembali ke bawaan
                    </Button>
                )}
            </PageDialogToolbar>
            <FormErrorHeader
                errors={errors}
                message={message}
                operation="Layout belum disimpan"
            />
            <PageDialogBody className="py-3">
                <CollapsibleSectionGroup defaultValue={['layouts', 'upload']}>
                    <CollapsibleSection value="layouts" title="Layout">
                        <DataTable
                            data={report.layouts}
                            getRowKey={(row) => row.ref}
                            getRowLabel={(row) => row.name}
                            columns={[
                                {
                                    id: 'name',
                                    header: 'Nama',
                                    width: 220,
                                    cell: (row) => (
                                        <span className="flex items-center gap-2">
                                            <DataTableText>
                                                {row.name}
                                            </DataTableText>
                                            {row.is_default && (
                                                <Badge variant="secondary">
                                                    Dipakai
                                                </Badge>
                                            )}
                                        </span>
                                    ),
                                },
                                {
                                    id: 'source',
                                    header: 'Sumber',
                                    width: 100,
                                    cell: (row) =>
                                        text(
                                            row.source === 'upload'
                                                ? 'Unggahan'
                                                : 'Bawaan',
                                        ),
                                },
                                {
                                    id: 'format',
                                    header: 'Jenis',
                                    width: 80,
                                    cell: (row) =>
                                        text(formatLabels[row.format]),
                                },
                                {
                                    id: 'language',
                                    header: 'Bahasa',
                                    width: 100,
                                    cell: (row) =>
                                        text(languageLabel(row.language)),
                                },
                                {
                                    id: 'paper',
                                    header: 'Kertas',
                                    width: 120,
                                    cell: (row) =>
                                        text(
                                            row.paper
                                                ? `${row.paper.widthMm} × ${row.paper.heightMm} mm`
                                                : '',
                                        ),
                                },
                                {
                                    id: 'uploaded',
                                    header: 'Diunggah',
                                    width: 150,
                                    cell: (row) => text(row.uploaded_by ?? ''),
                                },
                                {
                                    id: 'actions',
                                    header: 'Aksi',
                                    width: 300,
                                    cell: (row) => (
                                        <span className="flex flex-wrap gap-1">
                                            {row.format === 'docx' && (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="xs"
                                                    onClick={() =>
                                                        void preview(row)
                                                    }
                                                >
                                                    Pratinjau
                                                </Button>
                                            )}
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="xs"
                                                onClick={() =>
                                                    void saveFile(row)
                                                }
                                            >
                                                Unduh {formatLabels[row.format]}
                                            </Button>
                                            {canManage && !row.is_default && (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="xs"
                                                    disabled={busy}
                                                    onClick={() =>
                                                        void choose(row)
                                                    }
                                                >
                                                    Pakai layout ini
                                                </Button>
                                            )}
                                            {canManage &&
                                                row.source === 'upload' && (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="xs"
                                                        disabled={busy}
                                                        onClick={() =>
                                                            void remove(row)
                                                        }
                                                    >
                                                        Hapus
                                                    </Button>
                                                )}
                                        </span>
                                    ),
                                },
                            ]}
                        />
                    </CollapsibleSection>
                    {canManage && (
                        <CollapsibleSection
                            value="upload"
                            title="Unggah layout"
                        >
                            <p className="mb-3 text-sm text-muted-foreground">
                                Unduh layout yang ada, ubah rupanya di Word atau
                                Excel, lalu unggah di sini. Ukuran kertas ikut
                                setelan halaman dokumen Word. Layout Excel
                                diunduh berisi data contoh, supaya pivot dan
                                rumusnya terlihat bekerja. Layout baru dipakai
                                sesudah dipilih Pakai layout ini.
                            </p>
                            <FormGrid>
                                <FormControl error={errors.file?.[0]}>
                                    <Input
                                        ref={fileInput}
                                        type="file"
                                        label="Berkas Word (.docx) atau Excel (.xlsx)"
                                        accept=".docx,.xlsx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                                        data-error-field="file"
                                        onChange={(event) =>
                                            setFile(
                                                event.target.files?.[0] ?? null,
                                            )
                                        }
                                    />
                                </FormControl>
                                <FormControl error={errors.name?.[0]}>
                                    <Input
                                        label="Nama layout"
                                        maxLength={120}
                                        data-error-field="name"
                                        value={name}
                                        onChange={(event) =>
                                            setName(event.target.value)
                                        }
                                    />
                                </FormControl>
                                <FormControl
                                    error={errors.language?.[0]}
                                    hint="Bahasa menentukan nama bulan, pemisah angka, dan terbilang di Word. Di Excel bahasa hanya menentukan terbilang; angka dan tanggal mengikuti setelan Excel pembacanya."
                                >
                                    <Select
                                        label="Bahasa"
                                        required
                                        items={languageItems}
                                        value={language}
                                        onValueChange={(next) => {
                                            if (next !== null)
                                                setLanguage(next);
                                        }}
                                        searchPlaceholder="Cari bahasa"
                                        emptyMessage="Bahasa tidak ditemukan."
                                        portalContainer={portalContainer}
                                    />
                                </FormControl>
                            </FormGrid>
                            <Button
                                type="button"
                                className="mt-3"
                                disabled={busy}
                                onClick={() => void upload()}
                            >
                                <Upload aria-hidden="true" />
                                Unggah layout
                            </Button>
                        </CollapsibleSection>
                    )}
                    <CollapsibleSection value="fields" title="Field untuk Word">
                        <p className="mb-3 text-sm text-muted-foreground">
                            Tulis tag di Word persis seperti di kolom Tag. Baris
                            yang berulang ditulis{' '}
                            <code>{'{#nama}…{/nama}'}</code> di satu baris
                            tabel; bagian yang hanya tampil bila ada isinya
                            ditulis dengan cara yang sama.
                        </p>
                        <DataTable
                            data={report.fields}
                            getRowKey={(row) => row.tag}
                            getRowLabel={(row) => row.tag}
                            columns={[
                                {
                                    id: 'tag',
                                    header: 'Tag',
                                    width: 260,
                                    cell: (row) => text(`{${row.tag}}`),
                                },
                                {
                                    id: 'label',
                                    header: 'Isi',
                                    width: 360,
                                    cell: (row) => text(row.label),
                                },
                            ]}
                        />
                    </CollapsibleSection>
                    <CollapsibleSection
                        value="workbook"
                        title="Field untuk Excel"
                    >
                        <p className="mb-3 text-sm text-muted-foreground">
                            Tulis nama di rumus, misalnya{' '}
                            <code>=Report.letterhead.name</code> untuk nama di
                            kop surat. Setiap daftar baris adalah tabel Excel
                            dengan nama yang sama, untuk pivot atau rumus
                            seperti <code>=SUM(tabel[kolom])</code>. Judul
                            setiap field tersedia sebagai <code>Caption.</code>{' '}
                            diikuti namanya. Sheet tabel dan sheet Keterangan
                            laporan diisi ulang setiap kali laporan diunduh,
                            jadi buat rupa laporan di sheet lain.
                        </p>
                        <DataTable
                            data={report.workbook}
                            getRowKey={(row) => row.reference}
                            getRowLabel={(row) => row.reference}
                            columns={[
                                {
                                    id: 'reference',
                                    header: 'Di Excel',
                                    width: 260,
                                    cell: (row) => text(row.reference),
                                },
                                {
                                    id: 'label',
                                    header: 'Isi',
                                    width: 360,
                                    cell: (row) => text(row.label),
                                },
                            ]}
                        />
                    </CollapsibleSection>
                </CollapsibleSectionGroup>
            </PageDialogBody>
            {confirmation}
        </div>
    );
}
