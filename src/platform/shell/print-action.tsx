import { Button } from '@operations-metta/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@operations-metta/ui/dropdown-menu';
import { useQuery } from '@tanstack/react-query';
import {
    ChevronDown,
    FileSpreadsheet,
    FileText,
    LoaderCircle,
    Printer,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ApiError, errorText, orpc } from './api.ts';

type Format = 'pdf' | 'docx' | 'xlsx';

function fileUrl(
    report: string,
    recordId: string,
    parameters: Record<string, string>,
    format: Format | null,
    layout: string | null,
) {
    const query = new URLSearchParams(parameters);
    if (format) query.set('format', format);
    if (layout) query.set('layout', layout);
    return `/api/v1/reports/${encodeURIComponent(report)}/records/${encodeURIComponent(recordId)}?${query.toString()}`;
}

// Nama berkas datang dari server (Content-Disposition), jadi layar tidak menyusunnya sendiri.
export async function fetchFile(
    url: string,
): Promise<{ blob: Blob; name: string }> {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (response.ok) {
        const encoded = /filename\*=UTF-8''([^;]+)/.exec(
            response.headers.get('content-disposition') ?? '',
        )?.[1];
        return {
            blob: await response.blob(),
            name: encoded ? decodeURIComponent(encoded) : 'dokumen',
        };
    }
    const body: unknown = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body);
}

export function download({ blob, name }: { blob: Blob; name: string }) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}

// Tab dibuka sebelum menunggu server, supaya tidak ditahan pemblokir pop-up.
export async function openOrDownload(url: string): Promise<void> {
    const tab = window.open('', '_blank');
    try {
        const file = await fetchFile(url);
        if (file.blob.type !== 'application/pdf') {
            tab?.close();
            download(file);
            return;
        }
        const objectUrl = URL.createObjectURL(file.blob);
        if (tab) tab.location.href = objectUrl;
        else window.location.href = objectUrl;
    } catch (caught) {
        tab?.close();
        throw caught;
    }
}

// Satu-satunya tombol cetak di layar. Layar hanya menyebut laporan dan record-nya; isi, layout, kop, PDF, dan Excel milik
// mesin cetak di server (src/platform/reporting/). Klik memakai layout bawaan legal entity: layout Word dibuka sebagai
// PDF di tab baru, tempat penampil PDF peramban menyediakan Cetak dan Unduh, dan layout Excel diunduh. Menu di
// sebelahnya memilih layout lain atau mengunduh berkas Word.
export function PrintAction({
    report,
    recordId,
    parameters = {},
    label = 'Cetak',
}: {
    report: string;
    recordId: string;
    parameters?: Record<string, string>;
    label?: string;
}): ReactNode {
    const [pending, setPending] = useState(false);
    const layouts = useQuery({
        ...orpc.reportLayouts.queryOptions({
            input: { params: { code: report } },
            select: (response) => response.body.data,
        }),
        staleTime: 60_000,
    });
    const chosen = layouts.data?.find((layout) => layout.is_default);
    const url = (format: Format | null, layout: string | null) =>
        fileUrl(report, recordId, parameters, format, layout);

    async function run(work: () => Promise<void>, failure: string) {
        setPending(true);
        try {
            await work();
        } catch (caught) {
            const rendererDown =
                caught instanceof ApiError &&
                caught.errorCode === 'renderer_unavailable';
            toast.error(errorText(caught, failure), {
                action: rendererDown
                    ? {
                          label: 'Unduh Word',
                          onClick: () => void saveWord(null),
                      }
                    : undefined,
            });
        } finally {
            setPending(false);
        }
    }

    const printDefault = () =>
        run(async () => {
            if (chosen?.format === 'xlsx')
                download(await fetchFile(url(null, null)));
            else await openOrDownload(url(null, null));
        }, 'Laporan belum bisa dibuat.');
    const openPdf = (layout: string) =>
        run(
            () => openOrDownload(url('pdf', layout)),
            'Dokumen belum bisa dicetak.',
        );
    const saveExcel = (layout: string) =>
        run(
            async () => download(await fetchFile(url('xlsx', layout))),
            'Laporan belum bisa diunduh.',
        );
    const saveWord = (layout: string | null) =>
        run(
            async () => download(await fetchFile(url('docx', layout))),
            'Dokumen belum bisa diunduh.',
        );

    return (
        <div className="flex items-center">
            <Button
                type="button"
                variant="ghost"
                size="command"
                disabled={pending}
                onClick={() => void printDefault()}
            >
                {pending ? (
                    <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : chosen?.format === 'xlsx' ? (
                    <FileSpreadsheet aria-hidden="true" />
                ) : (
                    <Printer aria-hidden="true" />
                )}
                {label}
            </Button>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        variant="ghost"
                        size="command"
                        aria-label={`Pilihan ${label.toLowerCase()}`}
                        disabled={pending}
                    >
                        <ChevronDown aria-hidden="true" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-60">
                    <DropdownMenuLabel>Layout</DropdownMenuLabel>
                    {layouts.isPending && (
                        <DropdownMenuItem disabled>
                            Memuat layout…
                        </DropdownMenuItem>
                    )}
                    {layouts.isError && (
                        <DropdownMenuItem disabled>
                            {errorText(
                                layouts.error,
                                'Layout belum bisa dimuat.',
                            )}
                        </DropdownMenuItem>
                    )}
                    {layouts.data?.map((layout) =>
                        layout.format === 'xlsx' ? (
                            <DropdownMenuItem
                                key={layout.ref}
                                onSelect={() => void saveExcel(layout.ref)}
                            >
                                <FileSpreadsheet aria-hidden="true" />
                                {layout.name} · Excel
                            </DropdownMenuItem>
                        ) : (
                            <DropdownMenuItem
                                key={layout.ref}
                                onSelect={() => void openPdf(layout.ref)}
                            >
                                <Printer aria-hidden="true" />
                                {layout.name}
                                {layout.paper &&
                                    ` · ${layout.paper.widthMm}×${layout.paper.heightMm} mm`}
                            </DropdownMenuItem>
                        ),
                    )}
                    {chosen?.format !== 'xlsx' && (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                onSelect={() => void saveWord(null)}
                            >
                                <FileText aria-hidden="true" />
                                Unduh Word
                            </DropdownMenuItem>
                        </>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
