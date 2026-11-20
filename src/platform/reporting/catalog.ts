import { layoutTags } from './docx.ts';
import { fieldTags, templateView, type Locale } from './format.ts';
import { letterheadFields } from './letterhead.ts';
import { field, type Fields, type Report, type Values } from './report.ts';
import { signerFields } from './signers.ts';
import { workbookData, workbookShape, type WorkbookShape } from './workbook.ts';
import {
    cellFormats,
    excelWorkbook,
    fillWorkbook,
    inspectWorkbook,
} from './xlsx.ts';

export const printedFields = {
    at: field.datetime('Waktu cetak'),
    by: field.text('Dicetak oleh'),
};

function prefixed<T>(
    prefix: string,
    record: Readonly<Record<string, T>>,
): Record<string, T> {
    return Object.fromEntries(
        Object.entries(record).map(([key, value]) => [prefix + key, value]),
    );
}

export const engineFields: Fields = {
    ...prefixed('letterhead.', letterheadFields),
    ...prefixed('printed.', printedFields),
    ...signerFields,
};

export function engineValues(values: {
    letterhead: Values<typeof letterheadFields>;
    printed: Values<typeof printedFields>;
    signers: Values<typeof signerFields>;
}): Record<string, unknown> {
    return {
        ...prefixed('letterhead.', values.letterhead),
        ...prefixed('printed.', values.printed),
        ...values.signers,
    };
}

export const engineTags = ['letterhead', 'printed', ...fieldTags(engineFields)];
const engineRoots = new Set(
    Object.keys(engineFields).map((key) => key.split('.', 1)[0] ?? key),
);
const loopTags = new Set(['$first', '$last', '$no']);

// Tag yang tidak dikenal layout. Tag di dalam `{#…}` dicari seperti docxtemplater mencarinya: dari baris paling dalam
// keluar sampai akar, jadi `{patient_name}` di dalam `{#items}` sah bila `patient_name` ada di akar.
export function unknownTags(fields: Fields, layout: Uint8Array): string[] {
    const known = new Set([...fieldTags(fields), ...engineTags]);
    return layoutTags(layout).filter((tag) => {
        const segments = tag.split('.');
        for (let depth = 0; depth < segments.length; depth++) {
            if (depth > 0 && !known.has(segments.slice(0, depth).join('.')))
                break;
            const rest = segments.slice(depth);
            if (depth > 0 && rest.length === 1 && loopTags.has(rest[0] ?? ''))
                return false;
            for (let parent = depth; parent >= 0; parent--)
                if (
                    known.has([...segments.slice(0, parent), ...rest].join('.'))
                )
                    return false;
        }
        return true;
    });
}

export function reportShape(fields: Fields): WorkbookShape {
    return workbookShape({ ...fields, ...engineFields });
}

export type ReportCatalog = ReadonlyMap<string, Report>;

const bootLocale: Locale = {
    language: 'id',
    timeZone: 'Asia/Jakarta',
    amountDecimals: 2,
    unitAmountDecimals: 2,
};

function emptyValues(fields: Fields): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(fields).map(([key, spec]) => [
            key,
            spec.kind === 'lines' ? [] : spec.kind === 'flag' ? false : null,
        ]),
    );
}

function prefixErrors<T>(owner: string, work: () => T): T {
    try {
        return work();
    } catch (error) {
        throw new Error(
            `${owner}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

// Dirakit sekali di src/main.ts dari laporan yang di-export Core dan module, sama seperti router. Laporan yang salah
// bentuk menggagalkan proses saat mulai, dan karena test memuat src/main.ts, menggagalkan CI juga: kode ganda, izin di
// luar module pemiliknya, contoh data yang tidak sesuai field, kunci field yang tidak bisa menjadi nama Excel, atau
// layout bawaan dengan tag, nama, atau kolom yang tidak dikenal.
export function reportCatalog(reports: readonly Report[]): ReportCatalog {
    const catalog = new Map<string, Report>();
    for (const report of reports) {
        if (catalog.has(report.code))
            throw new Error(`Laporan ${report.code} didaftarkan dua kali.`);
        if (!report.code.startsWith(`${report.moduleId}.`))
            throw new Error(
                `Kode laporan ${report.code} harus diawali ${report.moduleId}.`,
            );
        const taken = Object.keys(report.fields).filter((key) =>
            engineRoots.has(key),
        );
        if (taken.length)
            throw new Error(
                `Field ${taken.join(', ')} laporan ${report.code} dipakai mesin cetak.`,
            );
        if (!report.permission.startsWith(`${report.moduleId}.`))
            throw new Error(
                `Izin laporan ${report.code} harus milik ${report.moduleId}.`,
            );
        templateView(report.fields, report.sample.values, bootLocale);
        const shape = prefixErrors(`Laporan ${report.code}`, () =>
            reportShape(report.fields),
        );
        const sample = workbookData(
            shape,
            { ...report.sample.values, ...emptyValues(engineFields) },
            bootLocale,
        );
        const keys = new Set<string>();
        for (const layout of report.layouts) {
            const name = `${report.code}/${layout.key}`;
            if (keys.has(layout.key))
                throw new Error(`Layout ${name} didaftarkan dua kali.`);
            keys.add(layout.key);
            switch (layout.format) {
                case 'docx': {
                    const unknown = unknownTags(
                        report.fields,
                        layout.document(),
                    );
                    if (unknown.length)
                        throw new Error(
                            `Layout bawaan ${name} memakai tag yang tidak dikenal: ${unknown.join(', ')}.`,
                        );
                    break;
                }
                case 'xlsx': {
                    const formats = cellFormats(bootLocale);
                    const bytes = prefixErrors(`Layout bawaan ${name}`, () =>
                        excelWorkbook(shape, formats, layout.workbook),
                    );
                    const refusal = inspectWorkbook(bytes, shape);
                    if (refusal)
                        throw new Error(
                            `Layout bawaan ${name} ditolak pemeriksaan Excel: ${JSON.stringify(refusal)}.`,
                        );
                    fillWorkbook(bytes, shape, sample, formats);
                    break;
                }
                default: {
                    const unknown: never = layout;
                    throw new Error(
                        `Format layout tidak dikenal: ${JSON.stringify(unknown)}`,
                    );
                }
            }
        }
        catalog.set(report.code, report);
    }
    return catalog;
}
