import { layoutTags } from './docx.ts';
import { fieldTags, templateView } from './format.ts';
import { letterheadFields } from './letterhead.ts';
import { field, type DocumentReport, type Fields } from './report.ts';
import { signerFields } from './signers.ts';

export const printedFields = {
    at: field.datetime('Waktu cetak'),
    by: field.text('Dicetak oleh'),
};

// Tag yang diisi mesin untuk setiap laporan, di luar dataset.
export const engineTags = [
    'letterhead',
    ...fieldTags(letterheadFields, 'letterhead.'),
    'printed',
    ...fieldTags(printedFields, 'printed.'),
    ...fieldTags(signerFields),
];
const engineRoots = new Set([
    'letterhead',
    'printed',
    ...Object.keys(signerFields),
]);
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

export type ReportCatalog = ReadonlyMap<string, DocumentReport>;

// Dirakit sekali di src/main.ts dari laporan yang di-export Core dan module, sama seperti router. Laporan yang salah
// bentuk menggagalkan proses saat mulai, dan karena test memuat src/main.ts, menggagalkan CI juga: kode ganda, izin di
// luar module pemiliknya, contoh data yang tidak sesuai field, atau layout bawaan dengan tag yang tidak dikenal.
export function reportCatalog(
    reports: readonly DocumentReport[],
): ReportCatalog {
    const catalog = new Map<string, DocumentReport>();
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
        templateView(report.fields, report.sample.values, {
            language: 'id',
            timeZone: 'Asia/Jakarta',
            amountDecimals: 2,
            unitAmountDecimals: 2,
        });
        const keys = new Set<string>();
        for (const layout of report.layouts) {
            if (keys.has(layout.key))
                throw new Error(
                    `Layout ${report.code}/${layout.key} didaftarkan dua kali.`,
                );
            keys.add(layout.key);
            const unknown = unknownTags(report.fields, layout.document());
            if (unknown.length)
                throw new Error(
                    `Layout bawaan ${report.code}/${layout.key} memakai tag yang tidak dikenal: ${unknown.join(', ')}.`,
                );
        }
        catalog.set(report.code, report);
    }
    return catalog;
}
