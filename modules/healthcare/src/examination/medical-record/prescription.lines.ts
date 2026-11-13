// Susunan baris grid E-Resep di layar. Kepala racikan dikenali dari tandanya sendiri, bukan dari obat yang kosong:
// komponen yang baru diberi nomor racikan juga belum punya obat.
type CompoundLine = {
    is_compound_header: boolean;
    compound: number | string | null;
};

export const isCompoundComponent = (line: CompoundLine) =>
    !line.is_compound_header && line.compound !== null;

export const compoundNumbers = (lines: readonly CompoundLine[]) =>
    lines
        .filter((line) => line.is_compound_header)
        .map((line) => Number(line.compound));

// Baris pindah ke bawah racikannya, seperti baris komponen yang menjorok di bawah "Racikan N" sistem lama, atau ke
// akhir resep bila bukan racikan.
export function placeLine<T extends CompoundLine>(
    lines: readonly T[],
    index: number,
    moved: T,
): T[] {
    const rest = lines.filter((_, at) => at !== index);
    if (moved.compound === null) return [...rest, moved];
    const last = rest.reduce(
        (found, row, at) =>
            Number(row.compound) === Number(moved.compound) ? at : found,
        -1,
    );
    return [...rest.slice(0, last + 1), moved, ...rest.slice(last + 1)];
}

// Racikan dihapus beserta komponennya, seperti "Hapus racikan ... beserta komponennya?".
export function removeLines<T extends CompoundLine>(
    lines: readonly T[],
    indexes: readonly number[],
): T[] {
    const removed = new Set(indexes);
    const gone = new Set(
        lines
            .filter((line, at) => removed.has(at) && line.is_compound_header)
            .map((line) => Number(line.compound)),
    );
    return lines.filter(
        (line, at) =>
            !removed.has(at) &&
            !(line.compound !== null && gone.has(Number(line.compound))),
    );
}
