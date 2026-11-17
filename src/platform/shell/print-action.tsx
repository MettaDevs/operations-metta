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
import { ChevronDown, FileText, LoaderCircle, Printer } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ApiError, errorText, orpc } from './api.ts';

type Format = 'pdf' | 'docx';

function fileUrl(
    report: string,
    recordId: string,
    parameters: Record<string, string>,
    format: Format,
    layout: string | null,
) {
    const query = new URLSearchParams({ ...parameters, format });
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

// Berkas dari server dibuka di tab baru. Tab dibuka sebelum menunggu server, supaya tidak ditahan pemblokir pop-up;
// gagal menutup tab itu lagi dan melempar ApiError ke pemanggil.
export async function openInTab(url: string): Promise<void> {
    const tab = window.open('', '_blank');
    try {
        const { blob } = await fetchFile(url);
        const objectUrl = URL.createObjectURL(blob);
        if (tab) tab.location.href = objectUrl;
        else window.location.href = objectUrl;
    } catch (caught) {
        tab?.close();
        throw caught;
    }
}

// Satu-satunya tombol cetak di layar. Layar hanya menyebut laporan dan record-nya; isi, layout, kop, dan PDF milik mesin
// cetak di server (src/platform/reporting/). Klik membuka PDF layout bawaan legal entity di tab baru, tempat penampil
// PDF peramban menyediakan Cetak dan Unduh. Menu di sebelahnya memilih layout lain atau mengunduh berkas Word.
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
    const [menuOpen, setMenuOpen] = useState(false);
    const [pending, setPending] = useState(false);
    const layouts = useQuery({
        ...orpc.reportLayouts.queryOptions({
            input: { params: { code: report } },
            select: (response) => response.body.data,
        }),
        enabled: menuOpen,
        staleTime: 60_000,
    });

    async function openPdf(layout: string | null) {
        setPending(true);
        try {
            await openInTab(
                fileUrl(report, recordId, parameters, 'pdf', layout),
            );
        } catch (caught) {
            const rendererDown =
                caught instanceof ApiError &&
                caught.errorCode === 'renderer_unavailable';
            toast.error(errorText(caught, 'Dokumen belum bisa dicetak.'), {
                action: rendererDown
                    ? {
                          label: 'Unduh Word',
                          onClick: () => void saveWord(layout),
                      }
                    : undefined,
            });
        } finally {
            setPending(false);
        }
    }

    async function saveWord(layout: string | null) {
        setPending(true);
        try {
            download(
                await fetchFile(
                    fileUrl(report, recordId, parameters, 'docx', layout),
                ),
            );
        } catch (caught) {
            toast.error(errorText(caught, 'Dokumen belum bisa diunduh.'));
        } finally {
            setPending(false);
        }
    }

    return (
        <div className="flex items-center">
            <Button
                type="button"
                variant="ghost"
                size="command"
                disabled={pending}
                onClick={() => void openPdf(null)}
            >
                {pending ? (
                    <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : (
                    <Printer aria-hidden="true" />
                )}
                {label}
            </Button>
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
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
                    {layouts.data?.map((layout) => (
                        <DropdownMenuItem
                            key={layout.ref}
                            onSelect={() => void openPdf(layout.ref)}
                        >
                            <Printer aria-hidden="true" />
                            {layout.name}
                            {layout.paper &&
                                ` · ${layout.paper.widthMm}×${layout.paper.heightMm} mm`}
                        </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void saveWord(null)}>
                        <FileText aria-hidden="true" />
                        Unduh Word
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
