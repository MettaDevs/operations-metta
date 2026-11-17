import { z } from 'zod';
import { Currency } from '../../foundation/currency/index.ts';
import type { Workspace } from '../access/index.ts';
import type { Database } from '../database/index.ts';
import { abort, coded, type Context } from '../http/index.ts';
import { localCurrencyCode } from '../money/index.ts';
import { printedFields, type ReportCatalog } from './catalog.ts';
import { fillDocx, paperOf, type Paper } from './docx.ts';
import { templateView, type Locale } from './format.ts';
import { letterhead, letterheadFields } from './letterhead.ts';
import { convertToPdf, RenderFailure } from './pdf.ts';
import type { BuiltinLayout, DocumentReport, Language } from './report.ts';

export const outputFormats = ['pdf', 'docx'] as const;
export type OutputFormat = (typeof outputFormats)[number];

const mimeTypes: Record<OutputFormat, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export type LayoutChoice = {
    ref: string;
    name: string;
    language: Language;
    paper: Paper | null;
    source: 'builtin';
    is_default: boolean;
};

const builtinRef = (layout: BuiltinLayout) => `builtin:${layout.key}`;

// Satu laporan yang sudah diperiksa: dikenal, module-nya terpasang untuk tenant, dan pengguna memegang izin baca
// record asalnya di tempat kerja pemilik dataset.
async function openReport(
    catalog: ReportCatalog,
    context: Context,
    code: string,
): Promise<{ report: DocumentReport; workspace: Workspace }> {
    const report = catalog.get(code);
    if (!report) abort(404, 'Laporan tidak ditemukan.');
    const workspace = await report.workspace(context);
    if (report.moduleId !== 'core') {
        const installed = await context.db.one(
            z.object({ installed: z.boolean() }),
            `select exists (select 1 from core_module_installations
                            where tenant_id = $1 and module_id = $2 and status = 'installed') as installed`,
            [workspace.tenantId, report.moduleId],
        );
        if (!installed?.installed) abort(404, 'Laporan tidak ditemukan.');
    }
    if (!workspace.permissions.has(report.permission))
        abort(403, 'Tidak diizinkan.');
    return { report, workspace };
}

function layoutChoices(report: DocumentReport): LayoutChoice[] {
    return report.layouts.map((layout, index) => ({
        ref: builtinRef(layout),
        name: layout.name,
        language: layout.language,
        paper: paperOf(layout.document()),
        source: 'builtin',
        is_default: index === 0,
    }));
}

function chosenLayout(report: DocumentReport, ref: string | null) {
    const layout = ref
        ? report.layouts.find((candidate) => builtinRef(candidate) === ref)
        : report.layouts[0];
    if (!layout)
        coded(422, 'layout_not_found', 'Layout cetak ini sudah tidak ada.');
    return {
        name: layout.name,
        language: layout.language,
        document: layout.document(),
    };
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

export class Printing {
    constructor(
        private readonly catalog: ReportCatalog,
        private readonly context: Context,
    ) {}

    async layouts(code: string): Promise<{ data: LayoutChoice[] }> {
        const { report } = await openReport(this.catalog, this.context, code);
        return { data: layoutChoices(report) };
    }

    // Satu panggilan sinkron: isi layout butuh beberapa milidetik dan konversi PDF sekitar 0,4 detik, jadi dokumen satu
    // record tidak lewat antrean. Renderer yang tidak ada atau tidak menjawab dijawab 503, dan layar menawarkan Word.
    async print(
        code: string,
        recordId: string,
        format: OutputFormat,
        layoutRef: string | null,
    ): Promise<File> {
        const { db } = this.context;
        const { report, workspace } = await openReport(
            this.catalog,
            this.context,
            code,
        );
        const record = await report.load(db, workspace, recordId);
        // Kebijakan data unit kerja dijaga dataset lewat service pemiliknya, sama seperti saat record dibuka di layar.
        // Di sini hanya dipastikan dokumen milik legal entity tempat kerja, supaya kop dan layout-nya benar.
        if (record?.legalEntityId !== workspace.legalEntityId)
            abort(404, 'Dokumen tidak ditemukan.');
        const layout = chosenLayout(report, layoutRef);
        const documentLocale = await locale(
            db,
            workspace.tenantId,
            record.legalEntityId,
            layout.language,
        );
        const view = {
            ...templateView(report.fields, record.values, documentLocale),
            letterhead: templateView(
                letterheadFields,
                await letterhead(
                    db,
                    workspace.tenantId,
                    record.legalEntityId,
                    record.operatingUnitId,
                ),
                documentLocale,
            ),
            printed: templateView(
                printedFields,
                {
                    at: new Date().toISOString(),
                    by: await printedBy(db, workspace.userId),
                },
                documentLocale,
            ),
        };
        const docx = fillDocx(layout.document, view);
        const bytes =
            format === 'docx' ? docx : await this.pdf(docx, record.fileName);
        return new File(
            [new Uint8Array(bytes)],
            `${record.fileName}.${format}`,
            {
                type: mimeTypes[format],
            },
        );
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
