import { z } from 'zod';
import { recordPageKeys } from './record-pages.generated.ts';

// Aksi yang menyertai penolakan, pola ErrorInfo Business Central. `open` setara AddNavigationAction (Show-it): tombol
// di kotak error yang membuka record penyebab penolakan di atas layar sekarang. Halaman tujuan disebut lewat kuncinya
// di registri halaman record (`defineRecordPage`), bukan URL. Kunci sekaligus securable-nya: membuka `core.payment`
// butuh `core.payment.read`. Fix-it (AddAction) kelak menjadi anggota union berikutnya dan tidak pernah dipakai untuk
// tindakan yang memindahkan uang. Berkas ini dipakai server dan peramban, jadi hanya meng-import zod.
export type RecordPageKey = (typeof recordPageKeys)[number];

export const errorActionSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('open'),
        label: z.string().min(1),
        page: z.enum(recordPageKeys),
        recordId: z.string().min(1),
    }),
]);

export type ErrorAction = z.infer<typeof errorActionSchema>;

export function readPermission(page: RecordPageKey): string {
    return `${page}.read`;
}

export { recordPageKeys };
