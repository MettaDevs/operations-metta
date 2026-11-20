// Mesin cetak dan laporan Core, pola Report + Layout Business Central: pemilik data mendaftarkan dataset dan layout
// bawaannya, mesin ini mengisi layout Word (lalu PDF lewat renderer) atau layout Excel, dan menyajikannya ke satu
// komponen cetak di layar. Cara menambah laporan ada di skill report-engine dan docs/dev/23-document-rendering.md.
export { reportCatalog, type ReportCatalog } from './catalog.ts';
export {
    cell,
    paragraph,
    when,
    wordDocument,
    type Block,
    type Paragraph,
    type Row,
    type Table,
} from './docx.ts';
export { letterheadBlocks } from './letterhead.ts';
export type { PdfRenderer } from './pdf.ts';
export {
    defineReport,
    field,
    type BuiltinLayout,
    type ExcelLayout,
    type Fields,
    type Language,
    type Report,
    type ReportRecord,
    type Values,
    type WordLayout,
} from './report.ts';
export { reportingRoutes } from './reporting.routes.ts';
export { signatureBlocks, type SignatureParty } from './signers.ts';
export type {
    ExcelCell,
    ExcelSheet,
    ExcelWorkbook,
    PivotSpec,
} from './xlsx.ts';
