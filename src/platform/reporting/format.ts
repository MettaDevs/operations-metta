import { Decimal } from '../money/index.ts';
import type { Fields, Language, ScalarField } from './report.ts';
import { amountWords } from './words.ts';

// Cara angka dan tanggal ditulis untuk satu dokumen: bahasa dari layout, zona waktu dari legal entity dokumen, dan
// presisi dari mata uang tenant (Sys Admin › Mata uang).
export type Locale = {
    language: Language;
    timeZone: string;
    amountDecimals: number;
    unitAmountDecimals: number;
};

// Yang dilihat layout: hanya teks, ya/tidak, dan daftar baris. Layout tidak pernah memformat sendiri.
export type TemplateView = {
    [key: string]: string | boolean | TemplateView | TemplateView[];
};

const separators = {
    id: { group: '.', decimal: ',' },
    en: { group: ',', decimal: '.' },
} as const;

const dateLocales = { id: 'id-ID', en: 'en-GB' } as const;

// Teks desimal yang sudah dibulatkan, dengan pemisah ribuan dan desimal bahasa layout. BigInt tidak dipakai lewat
// Number, supaya angka besar tidak bergeser.
export function formatDecimal(text: string, language: Language): string {
    const negative = text.startsWith('-');
    const [whole = '0', fraction = ''] = (
        negative ? text.slice(1) : text
    ).split('.');
    const { group, decimal } = separators[language];
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
    const sign = negative && /[1-9]/.test(whole + fraction) ? '-' : '';
    return `${sign}${grouped}${fraction ? decimal + fraction : ''}`;
}

const zoneLabels: Record<string, string> = {
    'Asia/Jakarta': 'WIB',
    'Asia/Pontianak': 'WIB',
    'Asia/Makassar': 'WITA',
    'Asia/Jayapura': 'WIT',
};

function zoneLabel(timeZone: string, instant: Date): string {
    const known = zoneLabels[timeZone];
    if (known) return known;
    return (
        new Intl.DateTimeFormat('en-GB', {
            timeZone,
            timeZoneName: 'shortOffset',
        })
            .formatToParts(instant)
            .find((part) => part.type === 'timeZoneName')?.value ?? timeZone
    );
}

function longDate(instant: Date, language: Language, timeZone: string) {
    return new Intl.DateTimeFormat(dateLocales[language], {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone,
    }).format(instant);
}

function clock(instant: Date, language: Language, timeZone: string) {
    return new Intl.DateTimeFormat(dateLocales[language], {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone,
    }).format(instant);
}

function invalid(path: string, expected: string): never {
    throw new Error(`Dataset laporan: ${path} harus ${expected}.`);
}

// Pemeriksaan nilai mentah per jenis field, dipakai Word (scalarView) dan Excel (cellOf), supaya kedua format punya satu
// aturan tentang nilai dataset yang sah.

function textValue(value: unknown, path: string): string {
    if (value !== null && typeof value !== 'string') invalid(path, 'teks');
    return value ?? '';
}

function flagValue(value: unknown, path: string): boolean {
    if (typeof value !== 'boolean') invalid(path, 'true atau false');
    return value;
}

function decimalText(value: unknown, path: string): string | null {
    if (value === null) return null;
    if (typeof value !== 'string') return invalid(path, 'teks desimal');
    try {
        Decimal.of(value);
    } catch {
        return invalid(path, 'teks desimal');
    }
    return value;
}

function roundedAmount(
    spec: ScalarField,
    value: unknown,
    path: string,
    locale: Locale,
): string | null {
    const text = decimalText(value, path);
    const decimals =
        spec.kind === 'money'
            ? locale.amountDecimals
            : locale.unitAmountDecimals;
    return text === null ? null : Decimal.of(text).fixed(decimals);
}

function dateValue(value: unknown, path: string): string | null {
    if (value === null) return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        invalid(path, 'tanggal YYYY-MM-DD');
    return value;
}

function instantValue(value: unknown, path: string): Date | null {
    if (value === null) return null;
    const instant = typeof value === 'string' ? new Date(value) : new Date(NaN);
    if (Number.isNaN(instant.getTime())) invalid(path, 'waktu ISO 8601');
    return instant;
}

// Satu baris dataset (objek) dan daftar baris, diperiksa sama ketatnya dengan nilai skalar.
export function recordValue(value: unknown, path: string): object {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return invalid(path || 'nilai', 'objek');
    return value;
}

export function linesValue(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value)) invalid(path, 'daftar baris');
    return value;
}

function scalarView(
    view: TemplateView,
    key: string,
    spec: ScalarField,
    value: unknown,
    path: string,
    locale: Locale,
): void {
    const { language, timeZone } = locale;
    switch (spec.kind) {
        case 'text':
            view[key] = textValue(value, path);
            return;
        case 'flag':
            view[key] = flagValue(value, path);
            return;
        case 'money':
        case 'unit-amount': {
            const rounded = roundedAmount(spec, value, path, locale);
            view[key] =
                rounded === null ? '' : formatDecimal(rounded, language);
            if (spec.words)
                view[`${key}_words`] =
                    rounded === null ? '' : amountWords(rounded, language);
            return;
        }
        case 'quantity': {
            const text = decimalText(value, path);
            view[key] =
                text === null
                    ? ''
                    : formatDecimal(Decimal.of(text).normalized(), language);
            return;
        }
        case 'date': {
            const date = dateValue(value, path);
            view[key] =
                date === null
                    ? ''
                    : longDate(new Date(`${date}T00:00:00Z`), language, 'UTC');
            return;
        }
        case 'datetime': {
            const instant = instantValue(value, path);
            if (instant === null) {
                view[key] = view[`${key}_date`] = view[`${key}_time`] = '';
                return;
            }
            const date = longDate(instant, language, timeZone);
            const time = `${clock(instant, language, timeZone)} ${zoneLabel(timeZone, instant)}`;
            view[key] = `${date} ${time}`;
            view[`${key}_date`] = date;
            view[`${key}_time`] = time;
            return;
        }
        default: {
            const unknown: never = spec.kind;
            throw new Error(`Jenis field tidak dikenal: ${String(unknown)}`);
        }
    }
}

// Nilai mentah dataset menjadi teks siap cetak. Fungsi ini sekaligus pemeriksaan batas: nilai yang tidak sesuai
// field-nya adalah cacat dataset dan menggagalkan cetak, bukan dicetak kosong.
export function templateView(
    fields: Fields,
    values: unknown,
    locale: Locale,
    path = '',
): TemplateView {
    const record = recordValue(values, path);
    const view: TemplateView = {};
    for (const [key, spec] of Object.entries(fields)) {
        const value: unknown = Reflect.get(record, key);
        const at = path ? `${path}.${key}` : key;
        if (spec.kind === 'lines')
            view[key] = linesValue(value, at).map((line, index) =>
                templateView(spec.fields, line, locale, `${at}[${index}]`),
            );
        else scalarView(view, key, spec, value, at, locale);
    }
    return view;
}

// Nilai satu sel Excel. Angka ditulis dari teks desimal yang sudah dibulatkan, tidak lewat bilangan JavaScript; teks
// selalu inline string, tidak pernah menjadi rumus.
export type NumberStyle = 'money' | 'unit-amount' | 'quantity';
export type Cell =
    | { readonly kind: 'empty' }
    | { readonly kind: 'text'; readonly text: string }
    | { readonly kind: 'flag'; readonly value: boolean }
    | {
          readonly kind: 'number';
          readonly decimal: string;
          readonly style: NumberStyle;
      }
    | { readonly kind: 'date'; readonly serial: number }
    | { readonly kind: 'datetime'; readonly serial: number };

const emptyCell: Cell = { kind: 'empty' };
const excelEpoch = Date.UTC(1899, 11, 30);
const dayMs = 86_400_000;

// Jam dinding di zona waktu legal entity, sebagai serial tanggal Excel. Excel tidak menyimpan zona, jadi yang ditulis
// adalah jam yang terbaca di klinik itu.
function wallClockSerial(instant: Date, timeZone: string): number {
    const parts = new Map(
        new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23',
        })
            .formatToParts(instant)
            .map((part) => [part.type, Number(part.value)]),
    );
    const at = (type: Intl.DateTimeFormatPartTypes) => parts.get(type) ?? 0;
    return (
        (Date.UTC(
            at('year'),
            at('month') - 1,
            at('day'),
            at('hour'),
            at('minute'),
            at('second'),
        ) -
            excelEpoch) /
        dayMs
    );
}

// Rupa Excel sebuah nilai dataset, padanan scalarView untuk Word. Uang dan harga satuan dibulatkan ke presisi mata
// uang tenant, tanggal menjadi serial tanpa geser zona, dan waktu menjadi serial jam dinding legal entity dokumen.
// `words` meminta terbilang uang itu, teks dalam bahasa layout.
export function cellOf(
    spec: ScalarField,
    value: unknown,
    path: string,
    locale: Locale,
    words = false,
): Cell {
    switch (spec.kind) {
        case 'text': {
            const text = textValue(value, path);
            return text === '' ? emptyCell : { kind: 'text', text };
        }
        case 'flag':
            return { kind: 'flag', value: flagValue(value, path) };
        case 'money':
        case 'unit-amount': {
            const rounded = roundedAmount(spec, value, path, locale);
            if (rounded === null) return emptyCell;
            return words
                ? { kind: 'text', text: amountWords(rounded, locale.language) }
                : { kind: 'number', decimal: rounded, style: spec.kind };
        }
        case 'quantity': {
            const text = decimalText(value, path);
            return text === null
                ? emptyCell
                : {
                      kind: 'number',
                      decimal: Decimal.of(text).normalized(),
                      style: 'quantity',
                  };
        }
        case 'date': {
            const date = dateValue(value, path);
            return date === null
                ? emptyCell
                : {
                      kind: 'date',
                      serial:
                          (Date.parse(`${date}T00:00:00Z`) - excelEpoch) /
                          dayMs,
                  };
        }
        case 'datetime': {
            const instant = instantValue(value, path);
            return instant === null
                ? emptyCell
                : {
                      kind: 'datetime',
                      serial: wallClockSerial(instant, locale.timeZone),
                  };
        }
        default: {
            const unknown: never = spec.kind;
            throw new Error(`Jenis field tidak dikenal: ${String(unknown)}`);
        }
    }
}

// Setiap tag yang boleh dipakai layout beserta artinya, dari field yang sama dengan templateView: `<key>`,
// `<key>_words` untuk uang dengan huruf, `<key>_date` dan `<key>_time` untuk waktu, dan daftar baris beserta isinya.
// Layar Layout cetak menampilkannya untuk penulis layout; pemeriksaan unggahan memakai tag-nya.
export function fieldCatalog(
    fields: Fields,
    prefix = '',
    parent = '',
): { tag: string; label: string }[] {
    return Object.entries(fields).flatMap(([key, spec]) => {
        const tag = prefix + key;
        const label = parent ? `${parent} › ${spec.label}` : spec.label;
        if (spec.kind === 'lines')
            return [
                { tag, label: `${label} (daftar baris)` },
                ...fieldCatalog(spec.fields, `${tag}.`, label),
            ];
        if (spec.kind === 'money' && spec.words)
            return [
                { tag, label },
                { tag: `${tag}_words`, label: `${label}, dengan huruf` },
            ];
        if (spec.kind === 'datetime')
            return [
                { tag, label },
                { tag: `${tag}_date`, label: `${label}, tanggal saja` },
                { tag: `${tag}_time`, label: `${label}, jam saja` },
            ];
        return [{ tag, label }];
    });
}

export function fieldTags(fields: Fields, prefix = ''): string[] {
    return fieldCatalog(fields, prefix).map((entry) => entry.tag);
}
