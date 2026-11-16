# Feed posting finance

Feed posting finance adalah jalur di Core yang membawa jurnal dari module ke aplikasi finance milik pelanggan. Satu baris `finance_postings` adalah **satu posting**: satu dokumen sumber, misalnya satu penerimaan aset, beserta jurnalnya yang sudah seimbang, dengan akun aplikasi finance pelanggan dan dimensi keuangan di setiap baris. Runtime ini tidak membukukan apa pun. Module menerbitkan posting, Core memeriksa dan menyimpannya, lalu aplikasi finance, di halaman ini disebut **pembaca**, mengambilnya lewat pull atau menerimanya lewat push, membukukannya, dan melapor balik lewat ack.

> **Status di repo ini:** sebagian. Yang sudah dipindah: penerbitan dan pemeriksaannya di `src/foundation/finance-posting/index.ts`, dipakai penerimaan aset untuk jenis `asset.acquisition`. Kesetaraannya dengan CoreERP dibandingkan harness di `parity/` lewat `compare_posting.py`. Yang belum dipindah: pull, push, ack, klien integrasi, layar pantau, validasi ulang, tandai manual, penilaian ulang cutover, dan jenis posting lain. Tidak ada kontrak di `contracts/integration/` dan tidak ada route yang menyajikan posting ke pembaca. Acuan perilaku: [halaman yang sama di CoreERP](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/34-feed-posting-finance.md) beserta [PRD-nya](https://github.com/MettaDevs/coreERP/blob/main/docs/todo/feed-posting-finance/README.md), yang dirujuk sebagai K-01, K-02, dan seterusnya.

```text
module                              Core                                   pembaca
──────                              ────                                   ───────
simpan dokumen ──┐
                 └─▶ FinancePostings ─▶ finance_postings ─── pull ──────▶ aplikasi finance
                     (transaksi          held · pending ·    atau push      (belum dipindah)
                      dokumen itu)       manual
                                         posted · rejected ◀──── ack ────
```

Tabelnya milik Core, bukan module (K-02). Kasir dan layanan kesehatan belum menerbitkan posting. Batasnya ada di [layanan kesehatan, kasir, dan finance](17-healthcare-finance-subledger.md).

## Konsep yang mudah tertukar

| Yang sering dikira sama           | Bedanya                                                                                                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `posting_id` dan `id`             | `posting_id` dipilih module, tetap untuk satu dokumen sumber, unik per tenant, dan menjadi kunci idempotensi di Core maupun di pembaca. `id` adalah uuid baris.                                                     |
| `payload` dan `input`             | `payload` adalah bentuk yang kelak disajikan ke pembaca. `input` adalah permintaan asli module, disimpan supaya posting yang tertahan dapat dibentuk ulang dari sumber yang sama.                                     |
| Kegagalan dan `held`              | Jurnal yang tidak mungkin benar adalah bug penerbit: penerbitan gagal dan dokumennya batal. Pemetaan yang belum lengkap bukan bug: posting tetap terbit sebagai `held` dan dokumennya tetap tersimpan.               |
| `held`, `manual`, `rejected`      | Ketiganya tidak disajikan ke pembaca, tetapi yang memutuskan berbeda. `held` diputuskan Core karena pemetaan. `manual` diputuskan Core karena cutover atau feed mati, atau diputuskan pengguna. `rejected` diputuskan pembaca. |
| Disajikan dan di-ack              | Pembaca yang melakukan pull belum tentu membukukan. Yang mengakhiri posting hanya ack.                                                                                                                              |

## Status

| Status     | Artinya                                                                                                                       | Disajikan ke pembaca |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `held`     | Ditahan Core karena pemetaan bermasalah. Masalahnya per baris ada di `hold_reasons`.                                          | Tidak                |
| `pending`  | Siap dibukukan                                                                                                                | Ya, sampai di-ack    |
| `posted`   | Pembaca sudah membukukan. `external_reference` berisi nomor vouchernya. Status akhir.                                         | Tidak                |
| `rejected` | Pembaca menolak dengan `reason_code` dan `reason`. Tidak pernah diberi tanggal ulang; kesalahannya diperbaiki dengan posting koreksi (K-17). | Tidak      |
| `manual`   | Tidak akan dikirim. `manual_reason` menyebut siapa yang memutuskan: `before_cutover` atau `feed_disabled` dari Core, atau `user` dari pengguna. | Tidak |

Yang sudah ditulis kode hari ini hanya status awal: `pending`, `held`, atau `manual` dengan alasan dari Core. Perpindahan status sesudahnya belum dipindah.

## Data yang disimpan

Tabelnya ada di baseline Core, `database/migrations/0001_coreerp_baseline.sql`, dan id-nya diubah ke uuid oleh `0002_ids_to_uuid.sql`.

| Tabel                        | Tanggung jawab                                                                                                                       | Ditulis hari ini |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `finance_postings`           | Satu posting: status, `payload`, `input`, `input_hash`, masalah penahanan, dan kelak hasil ack                                        | Ya               |
| `finance_posting_lines`      | Baris jurnal sebagai kolom, dengan kode business unit dan department di sampingnya, supaya laporan per unit tidak membongkar JSON (K-07) | Ya             |
| `finance_posting_events`     | Riwayat untuk layar pantau beserta pelakunya                                                                                         | Ya, peristiwa `published` |
| `finance_posting_deliveries` | Jejak kiriman mode push                                                                                                              | Belum            |

Tabel lain yang dibaca penerbit, antara lain `organizations` dan `legal_entities` untuk legal entity dan `company_code`-nya, `finance_reference_accounts` untuk akun, `operating_units` dan hierarki organisasi untuk dimensi, `vendors` dan `parties` untuk vendor, dan `finance_posting_settings` untuk feed aktif dan tanggal cutover. Presisi uang datang dari `Currency` di `src/foundation/currency/`. Belum ada layar di repo ini untuk mengisi setelan feed atau daftar akun.

Sebagian aturan dijaga database, bukan hanya kode, supaya jalur yang tidak lewat penerbit tetap tidak dapat menuliskannya. Contohnya `(tenant_id, posting_id)` unik, total debit sama dengan total kredit, setiap baris tepat satu sisi, dan feed aktif wajib punya cutover. Daftar lengkapnya adalah constraint tabel-tabel itu di baseline.

## Penerbit dan urutan pemeriksaannya

Module menerbitkan lewat `FinancePostings` dari `@core/foundation/finance-posting/index.ts`, di dalam proses yang sama, tanpa HTTP. Contohnya `modules/asset-management/src/fixed-asset/asset-receipt/asset-receipt.posting.ts`.

- `new FinancePostings(db, tenantId, currency, failure)` menerima pesan kegagalan milik module, yang ditampilkan bila penerbitan gagal.
- `evaluate(input, ignoreMissingVendor)` memeriksa tanpa menyimpan, dipakai untuk pratinjau sebelum konfirmasi.
- `publish(input)` memeriksa dengan cara yang sama lalu menyimpan. Pratinjau dan posting yang benar-benar terbit tidak pernah diperiksa dengan cara berbeda.
- `status(postingId)` membaca status posting untuk layar module.
- `mode(legalEntityId, date)` membaca mode settlement yang berlaku dari `finance_settlement_modes`. Module mengirim hasilnya sebagai `settlement_mode`.

`publish` dipanggil di dalam transaksi dokumen sumbernya. Ia membuka `db.transaction` sendiri, yang menjadi SAVEPOINT di dalam transaksi dokumen. Dokumen yang batal membawa postingnya ikut batal, dan bentrokan `posting_id` dengan request lain tidak membatalkan transaksi dokumen pemanggil.

Pemeriksaannya berlapis, dan urutannya disengaja:

| Lapis       | Gagal berarti                                           | Akibatnya                                                            |
| ----------- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| 1. Bentuk   | Jurnal yang tidak mungkin benar, apa pun pemetaannya    | 500 `posting_failed` dengan pesan module. Dokumen sumber ikut batal. |
| 2. Cutover  | Posting ini tidak boleh dikirim                         | Terbit sebagai `manual`                                              |
| 3. Pemetaan | Akun atau dimensi belum dapat dibentuk                  | Terbit sebagai `held`, dengan masalah per baris                      |

### Lapis 1: bentuk

Contoh yang diperiksa `evaluate`:

- `legal_entity_id` adalah legal entity milik tenant itu.
- Vendor, bila diisi, milik legal entity yang sama. `requires_vendor` tanpa vendor ditolak.
- Jumlah baris dalam batas yang ditulis di kode.
- Setiap baris berisi tepat satu sisi yang tidak nol dan tidak negatif. Arah jurnal dibawa sisinya.
- Nilai tidak lebih halus dari presisi mata uang. Nilai yang lebih kasar dilengkapi nolnya.
- Jurnal seimbang, dihitung dengan `Decimal` dari `src/platform/money/`, bukan float.

**Kenapa gagal, bukan `held`.** Jurnal yang tidak seimbang adalah bug penerbit (K-22). Menyerahkannya ke pengguna berarti menyuruh orang mencari selisih yang dibuat kode. Kegagalannya sampai ke [pelaporan kesalahan](28-pelaporan-kesalahan.md).

**Kenapa nilai yang terlalu halus ditolak, bukan dibulatkan.** Nilai dibulatkan di sumber, per baris, lewat fungsi pembulatan seperti `roundAmount` dari `src/foundation/currency/`, lalu jurnal disusun dari nilai yang sudah bulat sehingga seimbang dengan sendirinya (K-20). Membulatkan diam-diam di Core menyembunyikan selisih yang sama dengan yang membuat sistem lama tidak pernah seimbang.

### Lapis 2: cutover

1. Legal entity tanpa setelan, atau feed-nya tidak aktif: `manual` dengan `feed_disabled`.
2. `posting_date` sebelum tanggal cutover: `manual` dengan `before_cutover`.
3. Ada masalah pemetaan: `held`.
4. Selain itu: `pending`.

Cutover diperiksa sebelum pemetaan. Cutover ada supaya riwayat yang sudah dijurnal manual di aplikasi finance tidak terkirim ulang (K-16), dan posting yang memang tidak akan dikirim tidak perlu ditahan karena pemetaannya.

### Lapis 3: pemetaan

Setiap baris diperiksa dan semua masalahnya dikumpulkan, karena satu baris boleh punya lebih dari satu. Masalah berbentuk `{line_no, code, message, object, fix}`, dengan kode seperti `ACCOUNT_NOT_MAPPED`, `ACCOUNT_INACTIVE`, `BUSINESS_UNIT_UNRESOLVED`, dan `DEPARTMENT_REQUIRED`. Daftar kodenya ada di `src/foundation/finance-posting/index.ts`.

**Kenapa ditahan, bukan gagal.** Kesalahan pemetaan tidak boleh menghalangi pekerjaan operasional: dokumen tetap tersimpan dan postingnya menunggu pemetaan diperbaiki. **Tidak ada akun cadangan** (K-18). Pemetaan yang kosong berarti ditahan, tidak pernah dijurnal ke akun lain.

Aturan dimensinya:

- Jenis akun menentukan dimensinya (K-09). Akun neraca membawa `BUSINESS_UNIT`. Akun laba rugi membawa `BUSINESS_UNIT` dan `DEPARTMENT`.
- `BUSINESS_UNIT` diturunkan dari unit baris lewat hierarki bertujuan `management` pada versi yang berlaku di `posting_date`, bukan hari ini. Jurnal bulan lalu tetap masuk ke klinik yang benar walaupun hierarkinya diubah minggu ini. Dua jawaban berbeda tidak ditebak; hasilnya `BUSINESS_UNIT_UNRESOLVED`. Padanannya derived dimensions F&O (K-07).
- `DEPARTMENT` adalah unit baris itu sendiri, wajib bertipe department dan bernomor.

Nomor dan nama akun, unit, vendor, serta kode legal entity disalin ke `payload` saat terbit. Mengganti nama sesudahnya tidak mengubah posting yang sudah terbit.

## Idempotensi

Kuncinya `(tenant_id, posting_id)`:

- Belum ada: posting baru.
- Sudah ada dengan `input_hash` yang sama: posting yang ada dikembalikan apa adanya.
- Sudah ada dengan `input_hash` berbeda: penerbitan gagal. Dokumen yang sudah terbit dikoreksi lewat posting koreksi, bukan diterbitkan ulang dengan isi lain.

Dua request yang menyimpan `posting_id` yang sama bersamaan diselesaikan indeks unik. Yang kalah menangkap SQLSTATE 23505, membaca posting pemenang, lalu membandingkan hash-nya.

`input_hash` hanya menangkap **isi akuntansi**: jenis, legal entity, mata uang, tanggal posting, tanggal dokumen, mode, vendor, dan untuk setiap baris akun, debit, kredit, serta unitnya. Deskripsi, `source_document`, `mapping`, dan `details` tidak ikut. Teks penjelas yang berubah tidak boleh menghasilkan jurnal kedua. Masukan untuk `posting_id` yang sudah ada dinormalkan dengan presisi posting itu sendiri, bukan presisi mata uang hari ini.

Pembalikan dan koreksi yang merujuk posting lain belum didukung penerbit di repo ini.

## Yang belum dipindah

Aturannya tetap kanonik dan ditulis lengkap di halaman CoreERP. Ringkasnya:

- **Pull** menyajikan hanya `pending`, berulang pada setiap pull sampai di-ack, tanpa cursor, karena cursor "id terakhir" dapat melewatkan baris yang commit-nya terlambat (K-03).
- **Push** mengirim ke URL `https://` klien dengan signature HMAC dan jadwal ulang. Jawaban 2xx tanpa ack berarti terkirim, bukan dibukukan.
- **Ack** dari pull maupun push melewati satu jalur dengan aturan idempotensi yang sama. Ack yang sama diulang dijawab 200 tanpa perubahan. Ack yang bertentangan dijawab 409.
- **Klien integrasi** memegang token, scope yang terpisah untuk membaca dan ack, dan prefix jenis posting. Posting milik tenant lain atau di luar prefix klien dijawab 404.
- **Layar pantau** dengan duty lihat dan duty tindak lanjut yang terpisah, **validasi ulang** untuk `held`, **tandai manual** dengan alasan wajib, dan **penilaian ulang cutover** saat setelan feed berubah, yang tidak pernah menyentuh posting yang sudah sampai ke pembaca.
- **Salinan sandbox** tidak menyajikan dan tidak mengirim posting.

Bagian ini menyentuh uang, jadi setiap bagiannya dianggap pindah hanya setelah harness kesetaraan melaporkannya identik dengan CoreERP, sesuai `AGENTS.md`, bagian **Kapan sebuah alur dianggap pindah**. Kontraknya ditulis tangan di `contracts/integration/finance/` bersama endpoint pertamanya.

## Menambah jenis posting

1. Namai jenisnya `<module>.<peristiwa>`, misalnya `asset.acquisition`.
2. Susun `PostingInput` di berkas `.posting.ts` milik fitur module. Akun per baris datang dari setelan module, misalnya posting group, dan `mapping.label` menjelaskan asal akunnya untuk pesan penahanan.
3. Panggil `publish` di dalam transaksi dokumen, dan `evaluate` untuk pratinjau sebelum konfirmasi.
4. Buktikan kesetaraannya lewat `parity/` bila alurnya berasal dari CoreERP, atau lewat test berbasis database bila alurnya baru.
5. Perbarui status di awal halaman ini.

## Lihat juga

- [Layanan kesehatan, kasir, dan finance](17-healthcare-finance-subledger.md)
- [API, event, dan integrasi module](04-api-and-integration.md)
- [Integrasi sistem eksternal](12-external-module-integration.md)
- `parity/README.md`
