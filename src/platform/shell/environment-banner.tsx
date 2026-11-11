const copy: Record<string, { label: string; sentence: string }> = {
    demo: {
        label: 'Demo',
        sentence:
            'Ini tempat peragaan. Angkanya bukan angka sungguhan Anda, dan tidak ada email, webhook, maupun laporan terjadwal yang dikirim dari sini.',
    },
    sandbox: {
        label: 'Sandbox',
        sentence:
            'Ini salinan untuk mencoba-coba. Perubahan di sini tidak pernah sampai ke tempat kerja Anda yang sebenarnya, dan tidak ada email, webhook, maupun laporan terjadwal yang dikirim dari sini.',
    },
};

/**
 * Memberi tahu pengguna bahwa ia sedang tidak berada di tempat kerja yang sebenarnya, dipindah dari environment-banner
 * CoreERP. Permanen dan tidak dapat ditutup: pengguna yang tidak tahu ia di sandbox akan memperlakukan angka sandbox
 * sebagai angka sungguhan. Lingkungan dibaca server dari alamat; produksi juga dikirim, dan tidak diberi spanduk.
 */
export function EnvironmentBanner({
    environment,
}: {
    environment: { kind: string; name: string } | null;
}) {
    if (!environment || environment.kind === 'production') return null;
    const text = copy[environment.kind] ?? {
        label: environment.kind,
        sentence:
            'Ini bukan tempat kerja Anda yang sebenarnya. Tidak ada email, webhook, maupun laporan terjadwal yang dikirim dari sini.',
    };

    return (
        <div
            role="status"
            className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-950"
        >
            <span className="rounded bg-amber-300 px-1.5 py-0.5 text-xs font-semibold tracking-wide uppercase">
                {text.label}
            </span>
            <span className="font-medium">{environment.name}</span>
            <span className="text-amber-900">{text.sentence}</span>
        </div>
    );
}
