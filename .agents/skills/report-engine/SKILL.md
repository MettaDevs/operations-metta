---
name: report-engine
description: Add or change a printed document or report in operations-metta through the one Core print engine (`src/platform/reporting/`). Use when a screen needs a Cetak/Print button, when adding a kuitansi, invoice, etiket, surat, struk, or any document that ends on paper or PDF, when a module must provide a dataset for printing, when changing a built-in Word layout, letterhead (kop surat), terbilang, paper size, or the Sys Admin Layout cetak screen, and before writing any print view, print route, print CSS, or hardcoded report.
---

# Report engine

Every printed document is a dataset plus a replaceable Word layout, rendered by one engine in Core. The owner's rule (13 November 2026): no print view, print route, print CSS, or print button that carries print logic on any screen, and no report with columns and query fixed in code. The design and its reasons are in [`docs/dev/23-document-rendering.md`](../../../docs/dev/23-document-rendering.md); read it before changing the engine itself.

## Where things live

| What                                                                                    | Where                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine: field types, catalog check, formatting, terbilang, Word fill, PDF, layouts, kop | `src/platform/reporting/` (public door `index.ts`)                                                                                                                                           |
| A dataset                                                                               | `<feature>.report.ts` in the data owner's feature folder, e.g. `src/foundation/billing/payment/payment-receipt.report.ts`, `modules/pharmacy/src/dispensing/dispensing/drug-label.report.ts` |
| Its built-in layouts                                                                    | `<feature>.layout.ts` beside it                                                                                                                                                              |
| The catalog                                                                             | `reports = reportCatalog([...])` in `src/main.ts`                                                                                                                                            |
| The print button                                                                        | `PrintAction` from `src/platform/shell/index.ts` (module screens: `@core/platform/shell/index.ts`)                                                                                           |
| Layout and kop screens                                                                  | Sys Admin › Cetak › Layout cetak and Kop surat (`src/platform/reporting/*.page.tsx`)                                                                                                         |

## Add a document

1. **Write the dataset next to the data.** `defineReport({ code, name, moduleId, permission, workspace, fields, sample, layouts, load })`.
    - `code` is `<moduleId>.<name>`; `permission` is the **read permission of the origin record** and must start with `<moduleId>.`. There is no separate print permission.
    - `workspace` is the owner's own workspace function: `coreWorkspace` for Core, the module's `moduleWorkspace` for a module.
    - `load(db, workspace, recordId)` reuses the service the screen already uses (`Dispensings.show`, a billing query with `workspace.guard`). It returns `{ legalEntityId, operatingUnitId, fileName, values }`, with values raw from SQL: decimal text for money and quantities (`trim_scale(x)::text`), `YYYY-MM-DD` for dates, `isoSql(...)` for instants. Return `null` for a record that does not exist.
    - `fields` uses only `field.*`. Mark money that needs words with `field.money(label, { words: true })`; nest lines with `field.lines`.
    - `sample` is synthetic data typed by `fields`. It drives the layout preview and the boot check, so keep every field filled.
2. **Write the built-in layout** in `<feature>.layout.ts` with `wordDocument`, `paragraph`, `cell`, `when`, and `letterheadBlocks` from `@core/platform/reporting/index.ts`. Paper size is the `paper` of the document. Never commit a binary `.docx`.
3. **Register it.** Export the report from the owner's `index.ts` and add it to `reportCatalog([...])` in `src/main.ts`. A wrong tag, a duplicate code, or a permission outside the module stops the process at start, and CI with it.
4. **Put the button on the origin screen**: `<PrintAction report="<code>" recordId={id} label="Kuitansi" />` in the record's action bar. The test `test/platform/reporting/catalog.test.ts` fails if the code is not in the catalog.
5. **Test it** in `<feature>.report.test.ts` under the owner's test folder: print `?format=docx` and read the text with the helper in `test/support/receipt-fixture.ts`, check the permission (403) and another tenant (404), and add a `test.skipIf(!process.env.RENDERER_URL)` case that reads the PDF with `unpdf` and checks the page size. The CI job `render` runs `*.report.test.ts` with Gotenberg.
6. **Prove it on screen** with `bun scripts/verify.ts journey print` or a recipe in the verify feature map; see the `verify-operations-metta` skill.

## Rules that are easy to break

- **Do not read another module's tables to fill a dataset.** A dataset that needs data from another module is two datasets, or an event that brings the fact into the owner's own tables first (the pharmacy prescription snapshot is that). Core never reads module tables for printing.
- **Do not format in the dataset.** No `toLocaleString`, no `Rp`, no month names, no time-zone math. Send raw values; the engine formats them per currency precision, layout language, and legal-entity time zone.
- **Do not add a print permission.** Printing follows the read permission of the record.
- **Do not hardcode a name, address, or license number in a layout.** Kop data comes from `letterhead.*` (Sys Admin › Kop surat) and the address book.
- **Do not change the meaning of an existing field key.** Uploaded layouts of every legal entity use it. Add a new key instead; removing a key breaks uploaded layouts at their next upload, not silently.
- **A tag that is not a field is refused on upload**, by design. When a template author asks for more data, add a field.
- **Table reports (lists, XLSX, export queue) are a contract only**, described in the docs page. Build the first one there, not as a screen with fixed columns.

## Running it locally

PDF needs Gotenberg. `bun scripts/verify.ts up` starts one per run. For tests or `bun run dev`:

```bash
docker run -d --name ops-renderer -p 127.0.0.1:3999:3000 gotenberg/gotenberg:8.36.0 \
    gotenberg --libreoffice-auto-start=true --chromium-disable-routes=true
export RENDERER_URL=http://127.0.0.1:3999
```

Without `RENDERER_URL`, printing answers 503 `renderer_unavailable` and the screen offers the Word file.
