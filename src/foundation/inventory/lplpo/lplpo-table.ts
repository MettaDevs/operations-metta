import type { ApiBody } from '../../../platform/shell/index.ts';
import { displayNumber } from '@operations-metta/ui/display-number';
import type { ReportColumn, ReportTable } from '../report-table.ts';

type Lplpo = ApiBody<'inventoryLplpo'>;
type Row = Lplpo['rows'][number];
type Entry = { column: ReportColumn; value: (row: Row) => string };

const text = (
    id: string,
    header: string,
    width: number,
    value: (row: Row) => string,
): Entry => ({ column: { id, header, numeric: false, width }, value });

// Kosong (stok optimum yang belum diatur) tampil kosong, di layar dan di CSV.
const quantity = (
    id: string,
    header: string,
    value: (row: Row) => string | null,
    description?: string,
): Entry => ({
    column: {
        id,
        header,
        numeric: true,
        width: 110,
        ...(description ? { description } : {}),
    },
    value: (row) => {
        const found = value(row);
        return found === null ? '' : displayNumber(found);
    },
});

// Kolom LPLPO dalam urutan formulir: stok awal, penerimaan beserta rinciannya per sumber dana dari master, persediaan,
// pemakaian, penyesuaian, sisa stok, stok optimum, permintaan, dan saran permintaan.
export function lplpoTable(report: Lplpo): ReportTable {
    const entries = [
        text('code', 'Kode', 110, (row) => row.item.code),
        text('name', 'Nama barang', 240, (row) => row.item.name),
        text('category', 'Kategori', 160, (row) => row.category?.name ?? ''),
        text('unit', 'Satuan', 80, (row) => row.item.unit),
        quantity('opening', 'Stok awal', (row) => row.opening),
        quantity('receipts', 'Penerimaan', (row) => row.receipts),
        ...report.funding_sources.map((source) =>
            quantity(
                `funding:${source.id}`,
                `Penerimaan ${source.name}`,
                (row) => row.receipts_by_funding[source.id] ?? '0',
                `Bagian penerimaan yang sumber dananya ${source.name}.`,
            ),
        ),
        quantity(
            'receipts_without_funding',
            'Penerimaan tanpa sumber dana',
            (row) => row.receipts_without_funding,
        ),
        quantity(
            'available',
            'Persediaan',
            (row) => row.available,
            'Stok awal ditambah penerimaan.',
        ),
        quantity(
            'usage',
            'Pemakaian',
            (row) => row.usage,
            'Barang yang dikeluarkan selama periode: diserahkan, dipakai unit, atau dikirim ke lokasi lain.',
        ),
        quantity(
            'adjustment',
            'Penyesuaian',
            (row) => row.adjustment,
            'Selisih opname, pemusnahan, kedaluwarsa, dan penyesuaian lain. Minus berarti stok berkurang.',
        ),
        quantity(
            'closing',
            'Sisa stok',
            (row) => row.closing,
            'Persediaan dikurangi pemakaian, ditambah penyesuaian. Sama dengan stok di kartu stok pada akhir periode.',
        ),
        quantity(
            'optimum',
            'Stok optimum',
            (row) => row.optimum,
            'Stok maksimum barang di lokasi ini, diatur di kartu barang. Kosong bila belum diatur.',
        ),
        quantity(
            'requested',
            'Permintaan',
            (row) => row.requested,
            'Jumlah yang diminta lewat amprah yang diajukan selama periode.',
        ),
        quantity(
            'suggested',
            'Saran permintaan',
            (row) => row.suggested,
            'Stok optimum dikurangi sisa stok, tidak kurang dari 0.',
        ),
    ];
    return {
        columns: entries.map((entry) => entry.column),
        rows: report.rows.map((row) => ({
            key: row.item.id,
            total: false,
            cells: entries.map((entry) => entry.value(row)),
        })),
    };
}
