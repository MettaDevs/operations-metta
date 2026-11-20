import type { Workspace } from '../access/index.ts';
import type { Database } from '../database/index.ts';
import type { Context } from '../http/index.ts';
import type { ExcelWorkbook } from './xlsx.ts';

// Bahasa sebuah layout. Bahasa menentukan pemisah angka, nama bulan, dan terbilang; teks lain ditulis di layout-nya.
export const languages = ['id', 'en'] as const;
export type Language = (typeof languages)[number];

// Format berkas sebuah layout. Format milik layout, bukan milik laporan, sama dengan Report Layouts Business Central:
// satu dataset boleh punya layout Word dan layout Excel sekaligus, dan legal entity memilih yang dipakai.
export const layoutFormats = ['docx', 'xlsx'] as const;
export type LayoutFormat = (typeof layoutFormats)[number];

// Arti sebuah field, bukan rupanya. Rupanya milik mesin, per bahasa layout dan per legal entity dokumen.
export type ScalarKind =
    | 'text'
    | 'flag'
    | 'money'
    | 'unit-amount'
    | 'quantity'
    | 'date'
    | 'datetime';

export type ScalarField<K extends ScalarKind = ScalarKind> = {
    readonly kind: K;
    readonly label: string;
    // Uang yang juga ditulis dengan huruf: tag `<key>_words` ikut tersedia.
    readonly words: boolean;
};
export type LinesField = {
    readonly kind: 'lines';
    readonly label: string;
    readonly fields: Fields;
};
export type Field = ScalarField | LinesField;
export type Fields = Readonly<Record<string, Field>>;

function scalar<K extends ScalarKind>(kind: K) {
    return (label: string): ScalarField<K> => ({ kind, label, words: false });
}

// Satu-satunya cara menyatakan field dataset. Dari peta field yang sama mesin menurunkan tipe nilai yang dikembalikan
// dataset, pemeriksaan nilai itu saat masuk Core, rupa tiap nilai di kertas, dan daftar tag yang boleh dipakai layout.
export const field = {
    text: scalar('text'),
    flag: scalar('flag'),
    unitAmount: scalar('unit-amount'),
    quantity: scalar('quantity'),
    date: scalar('date'),
    datetime: scalar('datetime'),
    money: (
        label: string,
        options: { words?: boolean } = {},
    ): ScalarField<'money'> => ({
        kind: 'money',
        label,
        words: options.words ?? false,
    }),
    lines: <S extends Fields>(
        label: string,
        fields: S,
    ): {
        readonly kind: 'lines';
        readonly label: string;
        readonly fields: S;
    } => ({
        kind: 'lines',
        label,
        fields,
    }),
};

// Nilai mentah dari dataset, apa adanya dari SQL: teks desimal untuk uang dan jumlah, `YYYY-MM-DD` untuk tanggal, dan
// teks ISO UTC (isoSql) untuk waktu.
export type ValueOf<F extends Field> = F extends {
    readonly kind: 'lines';
    readonly fields: infer S extends Fields;
}
    ? Values<S>[]
    : F extends { readonly kind: 'flag' }
      ? boolean
      : string | null;
export type Values<S extends Fields> = { [K in keyof S]: ValueOf<S[K]> };

// Hasil dataset untuk satu record. Organisasinya datang dari record, bukan dari tempat kerja pengguna: kop, zona waktu,
// dan layout ikut legal entity dan unit yang menerbitkan dokumen itu.
export type ReportRecord<S extends Fields> = {
    legalEntityId: string;
    operatingUnitId: string | null;
    // Nama berkas tanpa ekstensi, misalnya "Kuitansi KSR-00000012".
    fileName: string;
    values: Values<S>;
};

// Layout bawaan ikut repo sebagai kode, jadi perubahannya terbaca di diff: dokumen Word ditulis wordDocument (docx.ts),
// workbook Excel dinyatakan sebagai sheet, sel, dan pivot yang ditulis mesin (xlsx.ts) dengan format angka tenant.
export type WordLayout = {
    format: 'docx';
    key: string;
    name: string;
    language: Language;
    document: () => Uint8Array;
};
export type ExcelLayout = {
    format: 'xlsx';
    key: string;
    name: string;
    // Bahasa terbilang (`<key>_words`). Angka, tanggal, dan ya/tidak ditulis sebagai nilai asli; Excel pembacanya yang
    // memformatnya menurut setelan bahasanya.
    language: Language;
    workbook: ExcelWorkbook;
};
export type BuiltinLayout = WordLayout | ExcelLayout;

export type Report<S extends Fields = Fields> = {
    // `<module>.<nama>`, misalnya `core.payment-receipt` atau `pharmacy.drug-label`.
    code: string;
    name: string;
    // Module pemilik dataset. Laporan module yang tidak terpasang untuk tenant tidak dikenal; `core` selalu ada.
    moduleId: string;
    // Izin baca record asalnya. Siapa yang boleh membuka record boleh mencetaknya; tidak ada izin cetak tersendiri.
    permission: string;
    // Tempat kerja pemilik dataset, dengan kebijakan datanya sendiri (module memakai policy code-nya).
    workspace: (context: Context) => Promise<Workspace>;
    fields: S;
    // Data sintetis untuk pratinjau layout dan test. Bertipe dari `fields`, jadi tidak bisa tertinggal.
    sample: ReportRecord<S>;
    // Layout pertama dipakai bila legal entity belum memilih. Word dan Excel boleh bercampur.
    layouts: readonly [BuiltinLayout, ...BuiltinLayout[]];
    // Dataset satu record. Dataset menyaring tenant dan memeriksa izin lewat service pemiliknya; null berarti tidak ada.
    // `parameters` adalah query cetak selain format dan layout, misalnya lokasi dan periode kartu stok satu barang
    // (request page BC). Dataset yang memakainya memeriksa isinya sendiri, sama dengan layarnya.
    load: (
        db: Database,
        workspace: Workspace,
        recordId: string,
        parameters: URLSearchParams,
    ) => Promise<ReportRecord<S> | null>;
};

export function defineReport<S extends Fields>(report: Report<S>): Report<S> {
    return report;
}
