// Jumlah dan nilai dari API datang sebagai teks desimal (numeric PostgreSQL) yang sudah dibuang nol di belakang komanya.
// Pengelompokan ribuan id-ID dipasang pada bagian bulatnya lewat BigInt, supaya angka besar tidak bergeser seperti bila
// diubah ke Number lebih dulu.
export function displayNumber(value: string): string {
    const negative = value.startsWith('-');
    const [whole = '0', fraction = ''] = (
        negative ? value.slice(1) : value
    ).split('.');
    return `${negative ? '-' : ''}${BigInt(whole).toLocaleString('id-ID')}${fraction ? `,${fraction}` : ''}`;
}

const groupedPattern = /^(-?)([1-9]\d{0,2}(?:\.\d{3})+)(?:,(\d+))?$/;
const plainPattern = /^(-?)(\d+)(?:,(\d+))?$/;

// Kebalikan displayNumber untuk isian pengguna: titik memisahkan ribuan, koma memisahkan desimal. Titik yang tidak
// diikuti tepat tiga angka, misalnya 1.5 atau 12.50, bisa saja desimal cara Inggris, jadi ditolak (null) daripada
// dibaca seribu kali lebih besar atau lebih kecil. Hasilnya teks desimal API: 12.500 menjadi 12500, 1,5 menjadi 1.5.
export function parseDisplayNumber(text: string): string | null {
    const trimmed = text.trim();
    const match = groupedPattern.exec(trimmed) ?? plainPattern.exec(trimmed);
    if (!match) return null;
    const whole = BigInt((match[2] ?? '').replaceAll('.', '')).toString();
    const fraction = (match[3] ?? '').replace(/0+$/, '');
    const digits = fraction ? `${whole}.${fraction}` : whole;
    return match[1] && /[1-9]/.test(digits) ? `-${digits}` : digits;
}

// Uang dan harga satuan ditampilkan dengan presisi mata uangnya (AutoFormatType BC), tidak dengan jumlah desimal yang
// ditulis mati di layar: nilai dibulatkan setengah menjauhi nol ke `decimals` angka, lalu nol di belakang koma tetap
// ditulis, misalnya displayAmount('1234.5', 2) = '1.234,50'.
export function displayAmount(value: string, decimals: number): string {
    const negative = value.startsWith('-');
    const [whole = '0', fraction = ''] = (
        negative ? value.slice(1) : value
    ).split('.');
    const digits = BigInt(
        `${whole}${fraction.padEnd(decimals + 1, '0')}`.slice(
            0,
            whole.length + decimals + 1,
        ),
    );
    const rounded = (digits + 5n) / 10n;
    const text = rounded.toString().padStart(decimals + 1, '0');
    const integer = text.slice(0, text.length - decimals);
    const decimal = decimals ? text.slice(-decimals) : '';
    const sign = negative && /[1-9]/.test(text) ? '-' : '';
    return `${sign}${BigInt(integer).toLocaleString('id-ID')}${decimal ? `,${decimal}` : ''}`;
}
