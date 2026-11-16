# Layanan kesehatan, kasir, dan finance

> **Status di repo ini:** usulan desain, belum ada jurnal yang terbit dari layanan kesehatan atau kasir. Halaman ini mengunci batas tanggung jawab sebelum alur itu dibangun. Ia tidak menetapkan bagan akun, tarif, atau aturan pajak suatu klinik. Acuan perilaku: [halaman yang sama di CoreERP](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/17-healthcare-finance-subledger.md).

## Siapa memegang apa hari ini

| Bagian                                  | Pemilik                          | Tempat                                  |
| --------------------------------------- | -------------------------------- | --------------------------------------- |
| Fakta layanan pasien: kunjungan, tindakan, resep | Module layanan kesehatan  | `modules/healthcare/`                   |
| Penyerahan dan retur obat               | Module farmasi                   | `modules/pharmacy/`                     |
| Tagihan, pembayaran, piutang, nota kredit | Kasir di Core                  | `src/foundation/billing/`               |
| Posting ke aplikasi finance             | Feed posting finance di Core     | `src/foundation/finance-posting/`       |
| Jurnal resmi, buku besar, tutup periode | Aplikasi finance pelanggan       | Di luar runtime ini                     |

Kasir ada di Core dan layarnya tampil sebagai aplikasi sendiri di katalog. Ini keputusan pemilik produk pada 11 November 2026, tercatat di `AGENTS.md`, bagian **Layar**. Akibatnya fakta tagihan dan pembayaran bukan milik module layanan kesehatan. Layanan kesehatan mengirim biaya layanan ke kasir lewat event, misalnya `healthcare.examination.charges-replaced.v1`, dan kasir menerbitkan fakta pembayarannya sendiri, misalnya `billing.invoice.posted.v2` dan `billing.credit-memo.posted.v2`. Kontrak setiap event ada di `contracts/events/`.

Runtime ini tidak membukukan apa pun. Jurnal dibawa ke aplikasi finance pelanggan lewat [feed posting finance](34-feed-posting-finance.md). Hari ini event kasir belum punya penerima di sisi finance. Kontrak `billing.invoice.posted.v2` menuliskannya sebagai keadaan sebenarnya.

## Fakta bisnis yang tidak boleh disamakan

Pembayaran pasien tidak selalu berarti pengakuan pendapatan, dan hak jasa tenaga kesehatan tidak selalu berarti pembayaran jasa. Fakta berikut dimodelkan terpisah:

| Fakta                           | Contoh dampak akuntansi yang mungkin                                         |
| ------------------------------- | ---------------------------------------------------------------------------- |
| Layanan ditagihkan              | Piutang pasien atau penjamin, dan pendapatan layanan                          |
| Pembayaran diterima             | Kas atau bank, dan pelunasan piutang atau deposit                            |
| Deposit diterima atau dipakai   | Kas atau bank, kewajiban deposit, atau pelunasan tagihan                     |
| Refund                          | Pengembalian kas atau bank, dan pembalikan saldo terkait                     |
| Jasa tenaga kesehatan disetujui | Beban dan utang jasa, bila kebijakan akuntansi klinik menyatakannya kewajiban |
| Koreksi                         | Dokumen penyesuaian atau pembalikan baru yang merujuk dokumen asal           |

Contoh ini menjelaskan bentuk ekonominya, bukan menetapkan akun.

## Aturan yang mengikat alur posting nanti

- **Posting terbit hanya dari fakta final**, di dalam transaksi yang menyimpan faktanya. Dokumen yang batal tidak meninggalkan posting.
- **Fakta yang sudah terposting tidak diedit atau dihapus.** Perbaikan dibuat sebagai dokumen penyesuaian atau pembalikan baru yang merujuk `posting_id` asalnya.
- **`posting_id` stabil untuk satu fakta final** dan menjadi kunci idempotensi di Core maupun di aplikasi finance.
- **Tidak ada akun cadangan.** Pemetaan akun yang belum lengkap menahan posting, tidak pernah menjurnal ke akun lain. Aturannya di [feed posting finance](34-feed-posting-finance.md).
- **Variasi jurnal antar klinik datang dari konfigurasi**, bukan dari fork kode atau skrip jurnal per klinik. Konfigurasi itu bertanggal efektif supaya perubahan tidak mengubah jurnal yang sudah terbit.
- **Status `terposting` hanya dari ack aplikasi finance**, tidak pernah karena posting sudah dikirim.
- **Tidak ada foreign key, query, atau insert langsung ke database aplikasi finance.**

## Urutan implementasi

Alur pertama dibatasi pada satu jenis, misalnya tagihan rawat jalan dengan pembayaran tunai, lalu direkonsiliasi dengan voucher di aplikasi finance. Klaim penjamin, deposit, refund, pajak, dan jasa tenaga kesehatan menyusul setelah alur pertama terbukti dari ujung ke ujung.

Alur posting adalah alur uang, jadi ia dianggap pindah hanya setelah harness kesetaraan melaporkannya identik dengan CoreERP bila alurnya berasal dari CoreERP. Alur baru tanpa padanan CoreERP dibuktikan test berbasis database ditambah syarat beban dan kebenaran. Aturannya di `AGENTS.md`, bagian **Kapan sebuah alur dianggap pindah**.

## Referensi

- [Ledger, subledger, and subledger journal accounting entries overview](https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/ledger-subledger)
- [Subledger transfer to the general ledger](https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/subledger-transfer)
- [Recommended practices for posting profiles](https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/recommended-practices-pstg-prfles)
- [API, event, dan integrasi module](04-api-and-integration.md)
- [Feed posting finance](34-feed-posting-finance.md)
- `modules/healthcare/README.md` dan `modules/pharmacy/README.md`
