import { z } from 'zod';
import { Currency } from '../../foundation/currency/index.ts';
import { coreWorkspace, type Workspace } from '../access/index.ts';
import type { Database } from '../database/index.ts';
import { abort, coded, type Context } from '../http/index.ts';
import { localCurrencyCode } from '../money/index.ts';
import { printedFields, type ReportCatalog } from './catalog.ts';
import { fillDocx } from './docx.ts';
import { fieldCatalog, templateView, type Locale } from './format.ts';
import { letterhead, letterheadFields } from './letterhead.ts';
import {
    ReportLayouts,
    type LayoutChoice,
    type ResolvedLayout,
} from './layouts.service.ts';
import { convertToPdf, RenderFailure } from './pdf.ts';
import type { DocumentReport, Language, ReportRecord } from './report.ts';
import { signerFields, signers } from './signers.ts';

export const outputFormats = ['pdf', 'docx'] as const;
export type OutputFormat = (typeof outputFormats)[number];

const mimeTypes: Record<OutputFormat, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

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

export class Printing {
    constructor(
        private readonly catalog: ReportCatalog,
        private readonly context: Context,
    ) {}

    private find(code: string): DocumentReport {
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

    private layoutsOf(report: DocumentReport, workspace: Workspace) {
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
    async print(
        code: string,
        recordId: string,
        format: OutputFormat,
        layoutRef: string | null,
    ): Promise<File> {
        const { report, workspace } = await this.forPrinting(code);
        const record = await report.load(this.context.db, workspace, recordId);
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

    // Daftar laporan yang boleh dikelola pengguna ini, beserta field yang boleh dipakai penulis layout.
    async catalogue() {
        const workspace = await coreWorkspace(this.context);
        workspace.guard('report-layout', 'read');
        const reports = [...this.catalog.values()];
        const held = await workspace.holds(
            this.context.db,
            reports.map((report) => report.permission),
        );
        const visible: DocumentReport[] = [];
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
                        ...fieldCatalog(letterheadFields, 'letterhead.'),
                        ...fieldCatalog(printedFields, 'printed.'),
                        ...fieldCatalog(signerFields),
                    ],
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

    // Berkas Word sebuah layout, untuk diubah di Word lalu diunggah lagi.
    async download(code: string, ref: string): Promise<File> {
        const { report, layouts } = await this.forManaging(code, 'read');
        const layout = await layouts.resolve(ref);
        return attachment(
            layout.document,
            `${report.name} - ${layout.name}`,
            'docx',
        );
    }

    // Pratinjau sebuah layout dengan data contoh laporan dan kop legal entity tempat kerja.
    async preview(
        code: string,
        ref: string,
        format: OutputFormat,
    ): Promise<File> {
        const { report, workspace, layouts } = await this.forManaging(
            code,
            'read',
        );
        if (!workspace.legalEntityId)
            abort(422, 'Pilih legal entity di tempat kerja lebih dulu.');
        return this.render(
            report,
            workspace,
            {
                ...report.sample,
                legalEntityId: workspace.legalEntityId,
                operatingUnitId: null,
                fileName: `Pratinjau ${report.sample.fileName}`,
            },
            await layouts.resolve(ref),
            format,
        );
    }

    private async render(
        report: DocumentReport,
        workspace: Workspace,
        record: ReportRecord<DocumentReport['fields']>,
        layout: ResolvedLayout,
        format: OutputFormat,
    ): Promise<File> {
        const { db } = this.context;
        const documentLocale = await locale(
            db,
            workspace.tenantId,
            record.legalEntityId,
            layout.language,
        );
        const view = {
            ...templateView(report.fields, record.values, documentLocale),
            ...templateView(
                signerFields,
                await signers(
                    db,
                    workspace.tenantId,
                    report.code,
                    record.legalEntityId,
                    record.operatingUnitId,
                ),
                documentLocale,
            ),
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
        return attachment(
            format === 'docx' ? docx : await this.pdf(docx, record.fileName),
            record.fileName,
            format,
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
