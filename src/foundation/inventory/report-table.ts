// Tabel laporan persediaan sebagai teks yang tampil di layar. Layar menggambar baris ini apa adanya dan unduhan CSV
// menulis baris yang sama, jadi isi CSV selalu sama dengan yang dilihat pengguna. Berkas ini tidak menyentuh server.

export type ReportColumn = {
    id: string;
    header: string;
    numeric: boolean;
    width: number;
    description?: string;
};
// total menandai baris jumlah, yang ditebalkan di layar.
export type ReportRow = { key: string; total: boolean; cells: string[] };
export type ReportTable = { columns: ReportColumn[]; rows: ReportRow[] };

// Teks yang diawali = + - @ dibaca Excel sebagai rumus, jadi kolom teks diberi tanda kutip tunggal di depannya. Kolom
// angka tidak, karena -7 memang angka.
function csvCell(text: string, numeric: boolean): string {
    const safe = !numeric && /^[=+\-@]/.test(text) ? `'${text}` : text;
    return /[";\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

// Titik koma sebagai pemisah dan BOM UTF-8, supaya Excel berbahasa Indonesia membuka setiap kolom dan membaca angka
// seperti 12.500 atau 1,5 sama dengan di layar.
export function reportCsv(table: ReportTable): string {
    const lines = [
        table.columns.map((column) => csvCell(column.header, false)),
        ...table.rows.map((row) =>
            row.cells.map((cell, index) =>
                csvCell(cell, table.columns[index]?.numeric ?? false),
            ),
        ),
    ];
    return `﻿${lines.map((line) => line.join(';')).join('\r\n')}\r\n`;
}

export function downloadCsv(fileName: string, table: ReportTable): void {
    const url = URL.createObjectURL(
        new Blob([reportCsv(table)], { type: 'text/csv;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
}
