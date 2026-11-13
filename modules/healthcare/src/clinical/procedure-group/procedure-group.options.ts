// Kelompok Perawatan form Group Jasa sistem lama (Group_model::dropdown_static), dengan kode yang disimpan sistem lama
// dan label yang ditampilkannya. Kodenya disimpan apa adanya di sim_m_tindakan_kelompok, dan CHECK di database menjaga
// daftarnya, jadi menambah kode berarti migration baru.
export const treatmentGroups = {
    ALL: 'All',
    RJ: 'Rawat Jalan',
    RI: 'Rawat Inap',
} as const;
type TreatmentGroup = keyof typeof treatmentGroups;

export function isTreatmentGroup(value: string): value is TreatmentGroup {
    return Object.hasOwn(treatmentGroups, value);
}
