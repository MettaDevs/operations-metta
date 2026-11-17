// Mesin cetak dan laporan Core, pola Report + Layout Business Central: pemilik data mendaftarkan dataset dan layout
// bawaannya, mesin ini mengisi layout Word, membuat PDF lewat renderer, dan menyajikannya ke satu komponen cetak di
// layar. Cara menambah dokumen ada di skill report-engine dan docs/dev/23-document-rendering.md.
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
    type DocumentReport,
    type Fields,
    type Language,
    type ReportRecord,
    type Values,
} from './report.ts';
export { reportingRoutes } from './reporting.routes.ts';
export { signatureBlocks, type SignatureParty } from './signers.ts';
