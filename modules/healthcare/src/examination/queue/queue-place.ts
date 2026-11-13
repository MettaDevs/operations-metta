import { z } from 'zod';

// Poli dan ruangan terakhir di perangkat ini, dipakai Antrean poli dan halaman pemeriksaan. Ruangan diingat per
// perangkat karena komputer poli berada di satu ruangan. Hanya kenyamanan: bila penyimpanan peramban diblokir, petugas
// memilih ulang setiap kali membuka layar.
const placeKey = 'healthcare.examination.place';
const placeSchema = z.object({
    section: z.string().optional(),
    rooms: z.record(z.string(), z.string()).default({}),
});
export type Place = z.infer<typeof placeSchema>;

export function readPlace(): Place {
    try {
        const parsed = placeSchema.safeParse(
            JSON.parse(localStorage.getItem(placeKey) ?? '{}'),
        );
        return parsed.success ? parsed.data : { rooms: {} };
    } catch {
        return { rooms: {} };
    }
}

export function rememberPlace(place: Place): void {
    try {
        localStorage.setItem(placeKey, JSON.stringify(place));
    } catch {
        // Penyimpanan peramban diblokir: poli dan ruangan tidak diingat.
    }
}

// Ruangan pemanggil untuk section ini: yang terakhir dipilih di perangkat ini, atau satu-satunya ruangan section.
export function placeRoom(
    place: Place,
    sectionId: string | undefined,
    rooms: readonly { id: string }[],
): string | undefined {
    return (
        rooms.find((room) => room.id === place.rooms[sectionId ?? ''])?.id ??
        (rooms.length === 1 ? rooms[0]?.id : undefined)
    );
}
