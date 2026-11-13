import type { ClerkSales } from './clerk.close.ts';

// Penjualan kasir selama sesi, dibaca dari pembayaran yang membawa clerk itu. Tabel pembayaran (kasir dan kasir_detail)
// lahir bersama Simpan pembayaran, jadi sampai saat itu tidak ada pembayaran yang bisa tercatat dan setiap sesi berisi
// nol. Simpan pembayaran mengganti isi fungsi ini dengan query atas pembayarannya.
export function clerkSales(): ClerkSales {
    return { transactions: 0, total: '0', byMethod: new Map() };
}
