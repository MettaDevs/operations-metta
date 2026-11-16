# Reporting, read replica, dan event projection

> **Status di repo ini:** mesin laporan dan analitik Core belum dipindah. Laporan yang sudah ada ditulis per fitur, misalnya laporan persediaan di `src/foundation/inventory/`. Read replica dan projection belum ada. Acuan perilaku: [halaman yang sama di CoreERP](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/07-reporting-and-replicas.md) dan [analitik CoreERP](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/35-analitik.md).

Halaman ini menetapkan dari mana sebuah laporan membaca datanya.

## Siapa boleh menyusun laporan gabungan

- **Module tidak membaca tabel module lain**, jadi module tidak menyusun laporan yang menggabungkan module lain. Laporan module hanya membaca tabelnya sendiri dan data Core yang ia terima lewat `index.ts`.
- **Core boleh membaca tabel module secara langsung**, termasuk menggabungkan beberapa module yang terpasang untuk tenant itu. Ini keputusan pemilik produk pada 3 Oktober 2026. Syaratnya ada di [ownership dan data](02-module-standard.md#ownership-dan-data): nama tabel dan kolom dari pendaftaran module, tenant dan kebijakan data diterapkan, semua module yang digabung terpasang, dan hanya membaca.

Jadi laporan gabungan beberapa module adalah pekerjaan Core. Mesinnya kelak hidup di Core, dan module menyumbang definisi datanya, sama dengan CoreERP.

## Sumber baca

| Kebutuhan                                    | Sumber baca                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| Data operasional yang harus terbaru          | Database lingkungan, lewat route fitur pemiliknya                        |
| Laporan operasional yang berat               | Database lingkungan dulu; read replica bila beban membuktikan perlu       |
| Laporan gabungan beberapa module             | Core, membaca tabel module dengan empat syarat di atas                   |
| Analitik berat atau historis                 | Projection dari event atau salinan terpisah, bila beban membuktikan perlu |

Satu lingkungan memakai satu database, jadi tabel semua module yang terpasang ada di database yang sama. Laporan gabungan tidak butuh join antar database. Replica dan projection adalah pilihan untuk beban berat, bukan syarat untuk setiap laporan gabungan.

## Konsistensi

Replica dan projection tertinggal dari database utama. Laporan yang membacanya menyebut seberapa baru datanya, misalnya `data_as_of` atau keterangan sinkronisasi.

Keputusan bisnis yang butuh data terbaru membaca database utama lewat fitur pemiliknya, bukan laporan. Contohnya kasir yang memeriksa status pembayaran sebelum membatalkannya.

## Aturan keandalan untuk projection

Aturan ini berlaku saat projection pertama dibangun:

1. Penerbit menulis data bisnis dan `outbox_events` dalam satu transaksi. Ini sudah berjalan lewat `publishEvent`.
2. Pengirim ke luar runtime mengirim event hanya setelah commit. Pengirim itu belum ada.
3. Projection menyimpan id event yang sudah diproses, supaya event yang terkirim ulang tidak dihitung dua kali.
4. Urutan dijamin per agregat bila diperlukan, bukan urutan global seluruh event.
5. Kegagalan projection punya jalur ulang dan pemantauan ketertinggalan per tenant dan module.
6. Projection bisa dibangun ulang dari riwayat event atau salinan sumber. Backup projection tidak menggantikan backup database lingkungan.

## Per bentuk penempatan

| Bentuk            | Strategi bawaan                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| SaaS              | Database lingkungan; replica atau projection bila beban laporan membuktikan perlu                                 |
| On-prem perpetual | Database lingkungan untuk laporan ringan. Tidak ada data pemakaian atau kesehatan yang wajib dikirim ke control plane |

Penerbit event tidak tahu siapa penerimanya, apakah projection, finance, atau module lain. Ia hanya menerbitkan kontrak event yang stabil, sesuai [API, event, dan integrasi module](04-api-and-integration.md).

## Lihat juga

- [Ownership dan data](02-module-standard.md#ownership-dan-data)
- [API, event, dan integrasi module](04-api-and-integration.md)
- [Muatan halaman dan paginasi](33-muatan-halaman-dan-paginasi.md)
