---
name: report-engine
description: Add or change a printed document or a table report in operations-metta through the one Core report engine (`src/platform/reporting/`). Use when a screen needs a Cetak/Print or report download button, when adding a kuitansi, invoice, etiket, surat, struk, or any document that ends on paper or PDF, when adding a report that is read or worked on in Excel (nilai persediaan, a list with totals, a pivot), when a module must provide a dataset, when changing a built-in Word or Excel layout, letterhead (kop surat), terbilang, paper size, or the Sys Admin Layout cetak screen, and before writing any print view, print route, print CSS, export button, or hardcoded report.
---

# Report engine

Every printed document and every table report is a dataset plus replaceable layouts, rendered by one engine in Core. A layout is Word (`.docx`, printed as PDF) or Excel (`.xlsx`, downloaded); the format belongs to the layout, not to the report, so one dataset can have both. The owner's rule (13 November 2026): no print view, print route, print CSS, or print button that carries print logic on any screen, and no report with columns and query fixed in code. The design and its reasons are in [`docs/dev/23-document-rendering.md`](../../../docs/dev/23-document-rendering.md); read it before changing the engine itself.

## Where things live

| What                                                                                    | Where                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine: field types, catalog check, formatting, terbilang, Word fill, PDF, layouts, kop | `src/platform/reporting/` (public door `index.ts`)                                                                                                                                           |
| Excel: names and tables derived from fields, fill, upload checks, built-in writer       | `src/platform/reporting/workbook.ts` and `xlsx.ts`                                                                                                                                           |
| A dataset                                                                               | `<feature>.report.ts` in the data owner's feature folder, e.g. `src/foundation/billing/payment/payment-receipt.report.ts`, `modules/pharmacy/src/dispensing/dispensing/drug-label.report.ts` |
| Its built-in layouts                                                                    | `<feature>.layout.ts` beside it                                                                                                                                                              |
| The catalog                                                                             | `reports = reportCatalog([...])` in `src/main.ts`                                                                                                                                            |
| The print button                                                                        | `PrintAction` from `src/platform/shell/index.ts` (module screens: `@core/platform/shell/index.ts`)                                                                                           |
| Layout and kop screens                                                                  | Sys Admin › Cetak › Layout cetak and Kop surat (`src/platform/reporting/*.page.tsx`)                                                                                                         |

## Add a document

1. **Write the dataset next to the data.** `defineReport({ code, name, moduleId, permission, workspace, fields, sample, layouts, load })`.
    - `code` is `<moduleId>.<name>`; `permission` is the **read permission of the origin record** and must start with `<moduleId>.`. There is no separate print permission.
    - `workspace` is the owner's own workspace function: `coreWorkspace` for Core, the module's `moduleWorkspace` for a module.
    - `load(db, workspace, recordId, parameters)` reuses the service the screen already uses (`Dispensings.show`, a billing query with `workspace.guard`). It returns `{ legalEntityId, operatingUnitId, fileName, values }`, with values raw from SQL: decimal text for money and quantities (`trim_scale(x)::text`), `YYYY-MM-DD` for dates, `isoSql(...)` for instants. Return `null` for a record that does not exist. `parameters` holds the print query other than `format` and `layout` (a request page, e.g. location and period for `core.stock-card`); validate it like the screen does and pass it from the screen with `PrintAction parameters={...}`.
    - `fields` uses only `field.*`. Mark money that needs words with `field.money(label, { words: true })`; nest lines with `field.lines`.
    - `sample` is synthetic data typed by `fields`. It drives the layout preview and the boot check, so keep every field filled.
2. **Write the built-in layout** in `<feature>.layout.ts` with `wordDocument`, `paragraph`, `cell`, `when`, `letterheadBlocks`, and `signatureBlocks` from `@core/platform/reporting/index.ts`, as `{ format: 'docx', key, name, language, document }`. Paper size is the `paper` of the document. Never commit a binary `.docx`. For a report read in Excel, see the next section instead.
3. **Register it.** Export the report from the owner's `index.ts` and add it to `reportCatalog([...])` in `src/main.ts`. A wrong tag, a duplicate code, or a permission outside the module stops the process at start, and CI with it.
4. **Put the button on the origin screen**: `<PrintAction report="<code>" recordId={id} label="Kuitansi" />` in the record's action bar. The test `test/platform/reporting/catalog.test.ts` fails if the code is not in the catalog.
5. **Test it** in `<feature>.report.test.ts` under the owner's test folder: print `?format=docx` and read the text with the helper in `test/support/receipt-fixture.ts`, check the permission (403) and another tenant (404), and add a `test.skipIf(!process.env.RENDERER_URL)` case that reads the PDF with `unpdf` and checks the page size. The CI job `render` runs `*.report.test.ts` with Gotenberg.
6. **Prove it on screen** with `bun scripts/verify.ts journey print` or a recipe in the verify feature map; see the `verify-operations-metta` skill.

## Add a table report (Excel layout)

A table report is an ordinary report whose built-in layout is Excel; there is no second report kind. `src/foundation/inventory/item-ledger/inventory-value.report.ts` and its `.layout.ts` are the worked example.

1. **Write the dataset exactly as above.** Rows are a `field.lines`; the record and request-page parameters work the same as LPLPO (a location and a period). Send every column a layout author might group, filter, or total by, as raw values. Never pre-group, number, subtotal, or format.
2. **Write the built-in layout as data**, `{ format: 'xlsx', key, name, language, workbook }`, where `workbook` is an `ExcelWorkbook`: `sheets` (cells with `{ text }`, `{ name: '<root key, letterhead.name, printed.at>' }`, or `{ formula }`, an optional `pivot` with `rows`, `values`, and `grandTotalCaption`, column `widths`, `printTitleRows`) and `visibleTables` (report tables whose sheet is shown, with the sheet name; other tables get hidden sheets). The engine writes it per download with the tenant's number formats. Grouping and totals are the pivot's job, so a legal entity can change them in Excel.
3. **What a layout author sees in Excel**: `=Report.<key>` for root scalars and engine sections (`=Report.letterhead.name`, `=Report.printed.at`), `=Caption.<key>` for labels, one Excel table per `field.lines` named by its key (`lines[closing_value]`), nested tables carrying their parent's columns, and the hidden sheet "Keterangan laporan" that lists every name and column. The Sys Admin Layout cetak screen lists the same references.
4. **Register it and add the button** as for documents. `PrintAction` downloads the `.xlsx` when the legal entity's layout is Excel and opens a PDF when it is Word; the screen never chooses a format.
5. **Test it** by downloading without `format` and reading the workbook back with `readWorkbook` from `test/support/workbook-reader.ts`: `book.value('Report.location_name')`, `book.table('lines')` (header, typed cells, number formats). Compare the numbers with SQL over the source tables, and add a `test.skipIf(!process.env.RENDERER_URL)` case that converts the `.xlsx` with Gotenberg and reads the pivot totals from the PDF text. LibreOffice rebuilds the pivot on open and writes the grand total as "Total Result".

Uploaded Excel layouts are checked by `inspectWorkbook`: macros, embedded objects, external data or functions, unknown names or columns, formulas that read a report sheet by cell address, and extra columns or a Total Row on a report table are refused. Built-in Excel layouts pass the same check at start, after being written and filled with the sample. Downloads are synchronous and capped at 50,000 table rows (`report_too_large`); the `report_exports` queue is not built yet.

## Rules that are easy to break

- **Do not read another module's tables to fill a dataset.** A dataset that needs data from another module is two datasets, or an event that brings the fact into the owner's own tables first (the pharmacy prescription snapshot is that). Core never reads module tables for printing.
- **Do not format in the dataset.** No `toLocaleString`, no `Rp`, no month names, no time-zone math. Send raw values; the engine formats them per currency precision, layout language, and legal-entity time zone.
- **Do not add a print permission.** Printing follows the read permission of the record.
- **Do not hardcode a name, address, or license number in a layout.** Kop data comes from `letterhead.*` (Sys Admin › Kop surat) and the address book.
- **Signatures come from data.** The people who did the work (sender, receiver, counter) are dataset fields read from the users who posted the document. Officials who acknowledge it (kepala, apoteker penanggung jawab) are the engine tag `{#signers}{title} {name} {id_number}{/signers}`, filled from Sys Admin › Kop surat per legal entity or unit and optionally per report. `signatureBlocks(parties, captions)` writes both for a built-in layout. The engine owns the root keys `letterhead`, `printed`, and `signers`; a dataset field with one of those names stops the process at start.
- **Do not change the meaning of an existing field key.** Uploaded layouts of every legal entity use it. Add a new key instead; removing a key breaks uploaded layouts at their next upload, not silently.
- **A tag, name, or column that is not a field is refused on upload**, by design. When a template author asks for more data, add a field.
- **Every field key must be a valid Excel name**: letters, digits, and underscores, not readable as a cell address (`a1`, `r`, `c`, `r1c1`). Any legal entity may upload an Excel layout for any report, so the catalog checks every report at start.
- **Do not add a second report kind, an export button, or an export route for a table.** Give the report an Excel layout. A screen's own CSV download (Stok per lokasi) exports what the screen shows and is not a report.
- **Do not write pivot output, totals, or cached formula results into a layout.** The engine leaves pivots empty with `refreshOnLoad` and clears cached results, because Excel in Protected View and LibreOffice show cached results as they are.

## Running it locally

PDF needs Gotenberg. `bun scripts/verify.ts up` starts one per run. For tests or `bun run dev`:

```bash
docker run -d --name ops-renderer -p 127.0.0.1:3999:3000 gotenberg/gotenberg:8.36.0 \
    gotenberg --libreoffice-auto-start=true --chromium-disable-routes=true
export RENDERER_URL=http://127.0.0.1:3999
```

Without `RENDERER_URL`, printing answers 503 `renderer_unavailable` and the screen offers the Word file.
