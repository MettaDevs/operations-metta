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
