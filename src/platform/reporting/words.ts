import type { Language } from './report.ts';

const idUnits = [
    'Nol',
    'Satu',
    'Dua',
    'Tiga',
    'Empat',
    'Lima',
    'Enam',
    'Tujuh',
    'Delapan',
    'Sembilan',
];
const idScales = ['', 'Ribu', 'Juta', 'Miliar', 'Triliun', 'Kuadriliun'];

function idHundreds(value: number): string[] {
    const words: string[] = [];
    const hundreds = Math.floor(value / 100);
    const rest = value % 100;
    if (hundreds === 1) words.push('Seratus');
    else if (hundreds > 1) words.push(idUnits[hundreds] ?? '', 'Ratus');
    if (rest === 10) words.push('Sepuluh');
    else if (rest === 11) words.push('Sebelas');
    else if (rest > 11 && rest < 20)
        words.push(idUnits[rest - 10] ?? '', 'Belas');
    else if (rest >= 20) {
        words.push(idUnits[Math.floor(rest / 10)] ?? '', 'Puluh');
        if (rest % 10) words.push(idUnits[rest % 10] ?? '');
    } else if (rest > 0) words.push(idUnits[rest] ?? '');
    return words;
}

const enUnits = [
    'Zero',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen',
];
const enTens = [
    '',
    '',
    'Twenty',
    'Thirty',
    'Forty',
    'Fifty',
    'Sixty',
    'Seventy',
    'Eighty',
    'Ninety',
];
const enScales = [
    '',
    'Thousand',
    'Million',
    'Billion',
    'Trillion',
    'Quadrillion',
];

function enHundreds(value: number): string[] {
    const words: string[] = [];
    const hundreds = Math.floor(value / 100);
    const rest = value % 100;
    if (hundreds > 0) words.push(enUnits[hundreds] ?? '', 'Hundred');
    if (rest >= 20) {
        const tens = enTens[Math.floor(rest / 10)] ?? '';
        words.push(rest % 10 ? `${tens}-${enUnits[rest % 10] ?? ''}` : tens);
    } else if (rest > 0) words.push(enUnits[rest] ?? '');
    return words;
}

// Bilangan bulat tak bertanda dengan huruf, dalam kelompok tiga angka. "Seribu" hanya untuk tepat satu ribu; satu juta
// dan seterusnya tetap "Satu Juta", seperti kuitansi pada umumnya.
export function spellInteger(value: bigint, language: Language): string {
    if (value < 0n) throw new Error('Bilangan negatif tidak dieja.');
    if (value === 0n) return language === 'id' ? 'Nol' : 'Zero';
    const groups: number[] = [];
    for (let rest = value; rest > 0n; rest /= 1000n)
        groups.push(Number(rest % 1000n));
    const scales = language === 'id' ? idScales : enScales;
    if (groups.length > scales.length)
        throw new Error('Bilangan terlalu besar untuk dieja.');
    const words: string[] = [];
    for (let index = groups.length - 1; index >= 0; index--) {
        const group = groups[index] ?? 0;
        if (group === 0) continue;
        const scale = scales[index] ?? '';
        if (language === 'id' && index === 1 && group === 1) {
            words.push('Seribu');
            continue;
        }
        words.push(
            ...(language === 'id' ? idHundreds(group) : enHundreds(group)),
        );
        if (scale) words.push(scale);
    }
    return words.join(' ');
}

// Nilai uang yang sudah dibulatkan ke presisi mata uangnya, misalnya `1250000.50` dengan dua desimal. Pecahan yang
// bukan nol dieja sesudah "Koma"/"Point" sebagai bilangan bulat dari angka-angkanya (50 menjadi "Lima Puluh"). Nama
// mata uang tidak ikut; layout menuliskannya sendiri.
export function amountWords(rounded: string, language: Language): string {
    const negative = rounded.startsWith('-');
    const [whole = '0', fraction = ''] = (
        negative ? rounded.slice(1) : rounded
    ).split('.');
    const words = [spellInteger(BigInt(whole), language)];
    if (/[1-9]/.test(fraction))
        words.push(
            language === 'id' ? 'Koma' : 'Point',
            spellInteger(BigInt(fraction), language),
        );
    if (negative) words.unshift('Minus');
    return words.join(' ');
}
