import { z } from 'zod';
import { Currency } from '../../foundation/currency/index.ts';
import { coreWorkspace, type Workspace } from '../access/index.ts';
import type { Database } from '../database/index.ts';
import { abort, coded, validation, type Context } from '../http/index.ts';
import { localCurrencyCode } from '../money/index.ts';
import {
    engineFields,
    engineValues,
    printedFields,
    reportShape,
    type ReportCatalog,
} from './catalog.ts';
import { fillDocx } from './docx.ts';
import { fieldCatalog, templateView, type Locale } from './format.ts';
import { letterhead, letterheadFields } from './letterhead.ts';
import {
    ReportLayouts,
    type LayoutChoice,
    type ResolvedLayout,
} from './layouts.service.ts';
import { convertToPdf, RenderFailure } from './pdf.ts';
import type { Language, Report, ReportRecord } from './report.ts';
import { signerFields, signers } from './signers.ts';
import {
    workbookData,
    workbookReferences,
    workbookRowCount,
} from './workbook.ts';
import { cellFormats, fillWorkbook, xlsxMimeType } from './xlsx.ts';

export const outputFormats = ['pdf', 'docx', 'xlsx'] as const;
export type OutputFormat = (typeof outputFormats)[number];

const mimeTypes: Record<OutputFormat, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: xlsxMimeType,
};

// Batas unduhan Excel langsung, jumlah baris semua tabel. Laporan yang melewatinya menunggu antrean report_exports,
// yang belum dibangun (keputusan pemilik produk, 20 November 2026).
const maxWorkbookRows = 50_000;

async function installed(db: Database, tenantId: string, moduleId: string) {
    if (moduleId === 'core') return true;
    const row = await db.one(
        z.object({ installed: z.boolean() }),
        `select exists (select 1 from core_module_installations
                        where tenant_id = $1 and module_id = $2 and status = 'installed') as installed`,
        [tenantId, moduleId],
    );
    return row?.installed ?? false;
}

async function locale(
    db: Database,
    tenantId: string,
    legalEntityId: string,
    language: Language,
): Promise<Locale> {
    const entity = await db.one(
        z.object({ timezone: z.string() }),
        `select timezone from legal_entities where tenant_id = $1 and organization_id = $2`,
        [tenantId, legalEntityId],
    );
    const precision = await new Currency(db, tenantId).precision(
        localCurrencyCode,
    );
    return {
        language,
        timeZone: entity?.timezone ?? 'Asia/Jakarta',
        amountDecimals: precision.amount_decimals,
        unitAmountDecimals: precision.unit_amount_decimals,
    };
}

async function printedBy(db: Database, userId: string) {
    const user = await db.one(
        z.object({ name: z.string() }),
        `select name from users where id = $1`,
        [userId],
    );
    return user?.name ?? '';
}

function attachment(bytes: Uint8Array, fileName: string, format: OutputFormat) {
    return new File([new Uint8Array(bytes)], `${fileName}.${format}`, {
        type: mimeTypes[format],
    });
}

// Keluaran untuk sebuah layout. Tanpa permintaan, format layout itu sendiri: Word menjadi PDF, Excel tetap Excel. PDF
// dari layout Excel tidak ditawarkan, karena pivot dan rumusnya dihitung Excel pembaca, bukan renderer.
function outputFor(
    layout: ResolvedLayout,
    requested: OutputFormat | null,
): OutputFormat {
    switch (layout.format) {
        case 'docx':
            if (requested === 'xlsx')
                validation({
                    format: 'Layout Word dicetak sebagai PDF atau Word.',
                });
            return requested ?? 'pdf';
        case 'xlsx':
            if (requested !== null && requested !== 'xlsx')
                validation({
                    format: 'Layout Excel hanya bisa diunduh sebagai Excel.',
                });
            return 'xlsx';
        default: {
            const unknown: never = layout;
            throw new Error(
                `Format layout tidak dikenal: ${JSON.stringify(unknown)}`,
            );
        }
    }
}

export class Printing {
    constructor(
        private readonly catalog: ReportCatalog,
        private readonly context: Context,
    ) {}

    private find(code: string): Report {
        const report = this.catalog.get(code);
        if (!report) abort(404, 'Laporan tidak ditemukan.');
        return report;
    }

    // Laporan untuk dicetak: module-nya terpasang untuk tenant, dan pengguna memegang izin baca record asalnya di
    // tempat kerja pemilik dataset.
    private async forPrinting(code: string) {
        const report = this.find(code);
        const workspace = await report.workspace(this.context);
        if (
            !(await installed(
                this.context.db,
                workspace.tenantId,
                report.moduleId,
            ))
        )
            abort(404, 'Laporan tidak ditemukan.');
        if (!workspace.permissions.has(report.permission))
            abort(403, 'Tidak diizinkan.');
        return { report, workspace };
    }

    // Laporan untuk dikelola layout-nya di Sys Admin: izin layout cetak, ditambah izin baca dokumen laporannya,
    // supaya pengelola satu module tidak mengganti dokumen module lain.
    private async forManaging(
        code: string,
        action: 'read' | 'update',
        body?: unknown,
    ) {
        const report = this.find(code);
        const workspace = await coreWorkspace(this.context, body);
        workspace.guard('report-layout', action);
        if (
            !(await installed(
                this.context.db,
                workspace.tenantId,
                report.moduleId,
            )) ||
            !(await workspace.holds(this.context.db, [report.permission])).size
        )
            abort(404, 'Laporan tidak ditemukan.');
        return {
            report,
            workspace,
            layouts: this.layoutsOf(report, workspace),
        };
    }

    private layoutsOf(report: Report, workspace: Workspace) {
        if (!workspace.legalEntityId)
            abort(422, 'Pilih legal entity di tempat kerja lebih dulu.');
        return new ReportLayouts(
            this.context.db,
            {
                tenantId: workspace.tenantId,
                legalEntityId: workspace.legalEntityId,
            },
            report,
        );
    }

    async layouts(code: string): Promise<{ data: LayoutChoice[] }> {
        const { report, workspace } = await this.forPrinting(code);
        return { data: await this.layoutsOf(report, workspace).list() };
    }

    // Satu panggilan sinkron: isi layout butuh beberapa milidetik dan konversi PDF sekitar 0,4 detik, jadi dokumen satu
    // record tidak lewat antrean. Renderer yang tidak ada atau tidak menjawab dijawab 503, dan layar menawarkan Word.
    // `format` kosong berarti format layout yang dipakai.
    async print(
        code: string,
        recordId: string,
        format: OutputFormat | null,
        layoutRef: string | null,
        parameters: URLSearchParams,
    ): Promise<File> {
        const { report, workspace } = await this.forPrinting(code);
        const record = await report.load(
            this.context.db,
            workspace,
            recordId,
            parameters,
        );
        // Kebijakan data unit kerja dijaga dataset lewat service pemiliknya, sama seperti saat record dibuka di layar.
        // Di sini hanya dipastikan dokumen milik legal entity tempat kerja, supaya kop dan layout-nya benar.
        if (record?.legalEntityId !== workspace.legalEntityId)
            abort(404, 'Dokumen tidak ditemukan.');
        return this.render(
            report,
            workspace,
            record,
            await this.layoutsOf(report, workspace).resolve(layoutRef),
            format,
        );
    }

    // Daftar laporan yang boleh dikelola pengguna ini, beserta field yang boleh dipakai penulis layout: tag untuk Word,
    // nama dan kolom tabel untuk Excel.
    async catalogue() {
        const workspace = await coreWorkspace(this.context);
        workspace.guard('report-layout', 'read');
        const reports = [...this.catalog.values()];
        const held = await workspace.holds(
            this.context.db,
            reports.map((report) => report.permission),
        );
        const visible: Report[] = [];
        for (const report of reports)
            if (
                held.has(report.permission) &&
                (await installed(
                    this.context.db,
                    workspace.tenantId,
                    report.moduleId,
                ))
            )
                visible.push(report);
        return {
            data: await Promise.all(
                visible.map(async (report) => ({
                    code: report.code,
                    name: report.name,
                    fields: [
                        ...fieldCatalog(report.fields),
                        ...fieldCatalog(engineFields),
                    ],
                    workbook: workbookReferences(
                        reportShape(report.fields),
                    ).map(({ reference, label }) => ({ reference, label })),
                    layouts: await this.layoutsOf(report, workspace).list(),
                })),
            ),
            can_manage: workspace.permissions.has('core.report-layout.update'),
        };
    }

    async upload(code: string, body: unknown) {
        const { workspace, layouts } = await this.forManaging(
            code,
            'update',
            body,
        );
        const form: unknown = body;
        const read = (key: string): unknown =>
            form !== null && typeof form === 'object'
                ? Reflect.get(form, key)
                : undefined;
        return {
            data: await layouts.upload({
                file: read('file'),
                name: read('name'),
                language: read('language'),
                userId: workspace.userId,
            }),
            message:
                'Layout diunggah. Jadikan bawaan supaya dipakai saat mencetak.',
        };
    }

    async choose(code: string, body: unknown) {
        const { layouts } = await this.forManaging(code, 'update', body);
        const ref: unknown =
            body !== null && typeof body === 'object'
                ? Reflect.get(body, 'layout')
                : undefined;
        return {
            data: await layouts.choose(ref),
            message: 'Layout bawaan untuk legal entity ini sudah diganti.',
        };
    }

    async remove(code: string, id: string, body: unknown) {
        const { layouts } = await this.forManaging(code, 'update', body);
        return {
            data: await layouts.remove(id),
            message: 'Layout dihapus.',
        };
    }

    // Berkas sebuah layout untuk diubah lalu diunggah lagi. Word: dokumen bertag apa adanya. Excel: layout yang diisi
    // data contoh laporan dan kop legal entity tempat kerja, supaya pivot dan rumusnya terlihat bekerja saat disunting;
    // isi sheet tabel dan Keterangan laporan diganti lagi saat laporan diunduh.
    async download(code: string, ref: string): Promise<File> {
        const { report, workspace, layouts } = await this.forManaging(
            code,
            'read',
        );
        const layout = await layouts.resolve(ref);
        const fileName = `${report.name} - ${layout.name}`;
        switch (layout.format) {
            case 'docx':
                return attachment(layout.document, fileName, 'docx');
            case 'xlsx':
                return this.render(
                    report,
                    workspace,
                    this.sample(report, workspace, fileName),
                    layout,
                    'xlsx',
                );
            default: {
                const unknown: never = layout;
                throw new Error(
                    `Format layout tidak dikenal: ${JSON.stringify(unknown)}`,
                );
            }
        }
    }

    // Pratinjau sebuah layout dengan data contoh laporan dan kop legal entity tempat kerja.
    async preview(
        code: string,
        ref: string,
        format: OutputFormat | null,
    ): Promise<File> {
        const { report, workspace, layouts } = await this.forManaging(
            code,
            'read',
        );
        return this.render(
            report,
            workspace,
            this.sample(
                report,
                workspace,
                `Pratinjau ${report.sample.fileName}`,
            ),
            await layouts.resolve(ref),
            format,
        );
    }

    private sample(
        report: Report,
        workspace: Workspace,
        fileName: string,
    ): ReportRecord<Report['fields']> {
        if (!workspace.legalEntityId)
            abort(422, 'Pilih legal entity di tempat kerja lebih dulu.');
        return {
            ...report.sample,
            legalEntityId: workspace.legalEntityId,
            operatingUnitId: null,
            fileName,
        };
    }

    private async render(
        report: Report,
        workspace: Workspace,
        record: ReportRecord<Report['fields']>,
        layout: ResolvedLayout,
        requested: OutputFormat | null,
    ): Promise<File> {
        const output = outputFor(layout, requested);
        const { db } = this.context;
        const documentLocale = await locale(
            db,
            workspace.tenantId,
            record.legalEntityId,
            layout.language,
        );
        const engine = {
            letterhead: await letterhead(
                db,
                workspace.tenantId,
                record.legalEntityId,
                record.operatingUnitId,
            ),
            printed: {
                at: new Date().toISOString(),
                by: await printedBy(db, workspace.userId),
            },
            signers: await signers(
                db,
                workspace.tenantId,
                report.code,
                record.legalEntityId,
                record.operatingUnitId,
            ),
        };
        switch (layout.format) {
            case 'docx': {
                const view = {
                    ...templateView(
                        report.fields,
                        record.values,
                        documentLocale,
                    ),
                    ...templateView(
                        signerFields,
                        engine.signers,
                        documentLocale,
                    ),
                    letterhead: templateView(
                        letterheadFields,
                        engine.letterhead,
                        documentLocale,
                    ),
                    printed: templateView(
                        printedFields,
                        engine.printed,
                        documentLocale,
                    ),
                };
                const docx = fillDocx(layout.document, view);
                return attachment(
                    output === 'docx'
                        ? docx
                        : await this.pdf(docx, record.fileName),
                    record.fileName,
                    output,
                );
            }
            case 'xlsx': {
                const shape = reportShape(report.fields);
                const values = { ...record.values, ...engineValues(engine) };
                if (workbookRowCount(shape, values) > maxWorkbookRows)
                    coded(
                        422,
                        'report_too_large',
                        'Data laporan ini lebih dari 50.000 baris dan terlalu besar untuk diunduh langsung. Persempit periode atau saringannya.',
                    );
                const formats = cellFormats(documentLocale);
                return attachment(
                    fillWorkbook(
                        layout.workbook(shape, formats),
                        shape,
                        workbookData(shape, values, documentLocale),
                        formats,
                    ),
                    record.fileName,
                    'xlsx',
                );
            }
            default: {
                const unknown: never = layout;
                throw new Error(
                    `Format layout tidak dikenal: ${JSON.stringify(unknown)}`,
                );
            }
        }
    }

    private async pdf(docx: Uint8Array, fileName: string) {
        try {
            return await convertToPdf(this.context.renderer, docx, fileName);
        } catch (error) {
            if (!(error instanceof RenderFailure)) throw error;
            process.stderr.write(
                JSON.stringify({
                    event: 'report-render-failed',
                    reason: error.reason,
                    message: error.message,
                }) + '\n',
            );
            if (error.reason === 'unavailable')
                coded(
                    503,
                    'renderer_unavailable',
                    'PDF belum bisa dibuat saat ini. Unduh versi Word untuk dicetak, atau coba lagi sebentar lagi.',
                );
            coded(
                422,
                'layout_unconvertible',
                'Layout ini tidak bisa diubah menjadi PDF. Periksa berkas layout-nya di Sys Admin › Layout cetak.',
            );
        }
    }
}
