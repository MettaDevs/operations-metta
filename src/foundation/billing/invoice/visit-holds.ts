import { useQuery } from '@tanstack/react-query';
import { orpc } from '../../../platform/shell/index.ts';

// Hal yang masih ditunggu kunjungan belum bayar dalam rentang tanggal, misalnya resep yang belum disiapkan farmasi.
// Dibaca ulang setiap 15 detik selama layar terlihat dan setiap layar kembali difokus, supaya kasir melihat kunjungan
// yang sudah bisa dibayar tanpa memuat ulang halaman. undefined selama jawaban pertama belum datang.
export function useVisitHolds(range: {
    from: string;
    to: string;
}): Map<string, string[]> | undefined {
    const { data } = useQuery({
        ...orpc.billingVisitHolds.queryOptions({
            input: { query: range },
            select: (response) =>
                new Map(
                    response.body.data.map((row) => [row.visit_id, row.holds]),
                ),
        }),
        enabled: Boolean(range.from && range.to),
        refetchInterval: 15_000,
    });
    return data;
}
