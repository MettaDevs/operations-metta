import type { VisitCondition } from './visit.statuses.ts';

// Isian form pendaftaran kunjungan selama belum disimpan.

// Cara bayar kunjungan. `null` berarti mengikuti cara bayar utama pasien (atau tipe bawaan), sampai petugas
// mengubahnya.
export type Payer = {
    patientType: { id: string; name: string; behaviors: string[] } | null;
    guarantor: { id: string; name: string } | null;
    cardNumber: string;
};

export type Draft = {
    payer: Payer | null;
    height: string;
    weight: string;
    condition: VisitCondition;
    conditionIds: string[];
    signIds: string[];
    kind: string | null;
    sectionId: string | null;
    scheduleId: string | null;
    pregnant: boolean;
};

export const emptyDraft: Draft = {
    payer: null,
    height: '',
    weight: '',
    condition: 'sakit',
    conditionIds: [],
    signIds: [],
    kind: null,
    sectionId: null,
    scheduleId: null,
    pregnant: false,
};

// Isian berubah dari form kosong: petugas sudah mengisi atau memilih sesuatu. Centang yang dipilih lalu dilepas lagi
// tidak dihitung. Form seperti ini dijaga dari perpindahan layar.
export function isDraftDirty(draft: Draft): boolean {
    return (
        draft.payer !== null ||
        draft.height !== emptyDraft.height ||
        draft.weight !== emptyDraft.weight ||
        draft.condition !== emptyDraft.condition ||
        draft.conditionIds.length > 0 ||
        draft.signIds.length > 0 ||
        draft.kind !== emptyDraft.kind ||
        draft.sectionId !== emptyDraft.sectionId ||
        draft.scheduleId !== emptyDraft.scheduleId ||
        draft.pregnant !== emptyDraft.pregnant
    );
}
