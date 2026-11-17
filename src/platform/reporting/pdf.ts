// PDF dibuat LibreOffice di dalam Gotenberg, proses terpisah dari runtime. Image runtime tetap Bun slim; LibreOffice
// (sekitar 2,4 GB image) hidup di container sendiri yang tidak punya jalan keluar ke internet, sehingga layout unggahan
// tidak bisa membuat LibreOffice mengambil apa pun.

export type PdfRenderer = { url: string; timeoutMs: number };

// Penyebab yang dibedakan layar: renderer tidak ada atau tidak menjawab (cetak Word masih bisa), atau layout ini
// sendiri tidak bisa diubah LibreOffice.
export class RenderFailure extends Error {
    constructor(
        readonly reason: 'unavailable' | 'rejected',
        message: string,
    ) {
        super(message);
    }
}

export async function convertToPdf(
    renderer: PdfRenderer | null,
    docx: Uint8Array,
    fileName: string,
): Promise<Uint8Array> {
    if (!renderer)
        throw new RenderFailure('unavailable', 'RENDERER_URL belum diisi.');
    const form = new FormData();
    form.append(
        'files',
        new Blob([new Uint8Array(docx)], {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
        `${fileName}.docx`,
    );
    let response: Response;
    try {
        response = await fetch(
            `${renderer.url.replace(/\/$/, '')}/forms/libreoffice/convert`,
            {
                method: 'POST',
                body: form,
                signal: AbortSignal.timeout(renderer.timeoutMs),
            },
        );
    } catch (error) {
        throw new RenderFailure(
            'unavailable',
            error instanceof Error ? error.message : 'Renderer tidak menjawab.',
        );
    }
    if (response.status >= 500 || response.status === 429)
        throw new RenderFailure('unavailable', `Renderer ${response.status}.`);
    if (!response.ok)
        throw new RenderFailure(
            'rejected',
            `Renderer ${response.status}: ${await response.text()}`,
        );
    return new Uint8Array(await response.arrayBuffer());
}
