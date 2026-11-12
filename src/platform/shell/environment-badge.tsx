const copy: Record<string, { label: string; sentence: string }> = {
    demo: {
        label: 'Demo',
        sentence:
            'Tempat peragaan: angkanya bukan angka sungguhan, dan tidak ada email, webhook, maupun laporan terjadwal yang dikirim.',
    },
    sandbox: {
        label: 'Sandbox',
        sentence:
            'Salinan untuk mencoba-coba: perubahan tidak sampai ke tempat kerja sebenarnya, dan tidak ada email, webhook, maupun laporan terjadwal yang dikirim.',
    },
};

/**
 * Penanda kuning di header bahwa pengguna tidak berada di tempat kerja yang sebenarnya. Pemilik produk (12 November
 * 2026) meminta spanduk lebar di bawah header diganti satu label pendek di sebelah pencarian; penjelasannya tetap ada
 * sebagai keterangan saat label disorot. Lingkungan dibaca server dari alamat; produksi tidak diberi label.
 */
export function EnvironmentBadge({
    environment,
}: {
    environment: { kind: string; name: string } | null;
}) {
    if (!environment || environment.kind === 'production') return null;
    const text = copy[environment.kind] ?? {
        label: environment.kind,
        sentence:
            'Bukan tempat kerja yang sebenarnya: tidak ada email, webhook, maupun laporan terjadwal yang dikirim.',
    };

    return (
        <span
            role="status"
            title={text.sentence}
            aria-label={`${text.label}. ${text.sentence}`}
            className="shrink-0 rounded bg-amber-300 px-2 py-0.5 text-xs font-semibold tracking-wide text-amber-950 uppercase"
        >
            {text.label}
        </span>
    );
}
