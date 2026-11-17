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
            if (value !== null && typeof value !== 'string')
                invalid(path, 'teks');
            view[key] = value ?? '';
            return;
        case 'flag':
            if (typeof value !== 'boolean') invalid(path, 'true atau false');
            view[key] = value;
            return;
        case 'money':
        case 'unit-amount': {
            const text = decimalText(value, path);
            const decimals =
                spec.kind === 'money'
                    ? locale.amountDecimals
                    : locale.unitAmountDecimals;
            const rounded =
                text === null ? null : Decimal.of(text).fixed(decimals);
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
            if (value === null) {
                view[key] = '';
                return;
            }
            if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
                invalid(path, 'tanggal YYYY-MM-DD');
            view[key] = longDate(
                new Date(`${value}T00:00:00Z`),
                language,
                'UTC',
            );
            return;
        }
        case 'datetime': {
            if (value === null) {
                view[key] = view[`${key}_date`] = view[`${key}_time`] = '';
                return;
            }
            const instant =
                typeof value === 'string' ? new Date(value) : new Date(NaN);
            if (Number.isNaN(instant.getTime()))
                invalid(path, 'waktu ISO 8601');
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
    if (values === null || typeof values !== 'object' || Array.isArray(values))
        return invalid(path || 'nilai', 'objek');
    const view: TemplateView = {};
    for (const [key, spec] of Object.entries(fields)) {
        const value: unknown = Reflect.get(values, key);
        const at = path ? `${path}.${key}` : key;
        if (spec.kind === 'lines') {
            if (!Array.isArray(value)) invalid(at, 'daftar baris');
            view[key] = value.map((line: unknown, index) =>
                templateView(spec.fields, line, locale, `${at}[${index}]`),
            );
        } else scalarView(view, key, spec, value, at, locale);
    }
    return view;
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
