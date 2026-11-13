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

type Section = { id: string; practitioners: readonly { id: string }[] };

// Poli bawaan bila alamat tidak menyebutnya. Sistem lama memilih poli dan dokter saringan dari nakes yang login
// (poly/views/outpatient/datatable.php:126, 137); di sini poli tempat nakes milik pengguna berjadwal hari itu, dengan
// poli terakhir di perangkat ini didahulukan bila termasuk. Pengguna tanpa nakes berjadwal mendapat poli terakhir di
// perangkat ini, lalu poli pertama.
export function defaultSection<S extends Section>(
    sections: readonly S[],
    place: Place,
    practitionerIds: readonly string[],
): S | undefined {
    const own = sections.filter((section) =>
        section.practitioners.some((practitioner) =>
            practitionerIds.includes(practitioner.id),
        ),
    );
    const last = (candidates: readonly S[]) =>
        candidates.find((section) => section.id === place.section);
    return last(own) ?? own[0] ?? last(sections) ?? sections[0];
}

// Saringan nakes bawaan: nakes milik pengguna yang berjadwal di poli itu hari itu.
export function defaultPractitioner(
    section: Section | undefined,
    practitionerIds: readonly string[],
): string | undefined {
    return section?.practitioners.find((practitioner) =>
        practitionerIds.includes(practitioner.id),
    )?.id;
}
