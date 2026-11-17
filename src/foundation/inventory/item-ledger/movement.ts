import type { EntryKind } from './item-ledger.posting.ts';

type Direction = { in: string; out: string };

const kinds: Record<EntryKind, Direction> = {
    penerimaan: { in: 'Terima dari vendor', out: 'Retur ke vendor' },
    penyerahan: { in: 'Retur dari pasien', out: 'Keluar ke pasien' },
    penyesuaian_tambah: {
        in: 'Penyesuaian tambah',
        out: 'Penyesuaian tambah',
    },
    penyesuaian_kurang: {
        in: 'Penyesuaian kurang',
        out: 'Penyesuaian kurang',
    },
    transfer: { in: 'Mutasi masuk', out: 'Mutasi keluar' },
    pemakaian: { in: 'Koreksi pemakaian', out: 'Pemakaian' },
};
const sources: Record<string, Direction> = {
    opname: { in: 'Selisih opname (lebih)', out: 'Selisih opname (kurang)' },
};

export function movementLabel(entry: {
    kind: EntryKind;
    sourceType: string;
    inbound: boolean;
    reversal: boolean;
}): string {
    const labels = sources[entry.sourceType] ?? kinds[entry.kind];
    const original = entry.inbound !== entry.reversal ? labels.in : labels.out;
    return entry.reversal
        ? `Batal ${original.charAt(0).toLowerCase()}${original.slice(1)}`
        : original;
}
