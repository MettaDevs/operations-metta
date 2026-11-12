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
