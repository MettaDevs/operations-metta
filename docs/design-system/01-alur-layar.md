# Alur layar

Alur kerja pengguna dari layar sampai jawaban server, ditulis tanpa terikat framework. Setiap alur menyebut apa yang terjadi di layar dan apa yang diminta dari server; rincian server ada di bagian Alur permintaan dan Alur data.

## 1. Membuka daftar

1. Pengguna memilih item di submenu Shell. Item hanya tampil bila pengguna punya izinnya (lihat Alur permintaan §3).
2. Halaman daftar terpasang dengan filter bawaan; tabel meminta batch pertama: `q`, `sort`, `direction`, filter, tanpa `cursor`.
3. Server menjawab `{data, next_cursor}`. Tidak ada hitungan total.
4. Pengguna menggulir ke akhir → batch berikutnya dengan `cursor = next_cursor`, satu permintaan pada satu waktu, baris digabung per `id`.
5. `next_cursor` kosong → "Semua hasil sudah dimuat."
6. Mengubah pencarian, filter, atau urutan → hasil dikosongkan, permintaan lama dibatalkan, kembali ke langkah 2. Pencarian ketikan diberi jeda 250ms.

## 2. Membuat record dengan rincian

1. **Baru** di bar daftar → kartu bertumpuk terbuka di atas daftar. Semua bagian yang boleh diisi tersedia sejak awal; tanda aktif bawaannya *aktif*.
2. Bila penomorannya otomatis, layar menjelaskan bahwa nomor diisi saat disimpan.
3. Pengguna mengisi identitas, lalu rincian (alamat, kontak, baris dokumen, lampiran) sebagai **draft lokal** dengan kunci lokal.
4. **Simpan** → satu permintaan berisi header, semua rincian, dan berkas, dengan kunci idempoten (`Idempotency-Key`, UUID buatan klien). Kartu master menyimpan satu kunci untuk seluruh umur kartu, sehingga Simpan ulang setelah gagal tidak membuat record ganda.
5. Server memvalidasi semuanya, menerbitkan nomor, lalu menulis dalam satu transaksi (Alur data §1).
6. Berhasil (201) → kartu menampilkan record dari respons, termasuk kode, nama, status, dan rinciannya. Daftar di belakang memasukkan record itu sebelum menyegarkan diri.
7. Gagal → isian dan baris tetap; ringkasan error tampil di bawah toolbar dan setiap field/baris yang salah ditandai. Pengguna memperbaiki lalu Simpan lagi.
8. Batal → konfirmasi bila ada draft; tidak ada yang tersimpan.

Catatan keadaan sekarang: beberapa layar transaksi membuat kunci idempoten baru setiap klik, sehingga perlindungannya hanya berlaku untuk satu klik itu.

## 3. Melihat dan mengubah record

1. Klik dua kali baris (atau Enter pada baris) → kartu terbuka dalam mode baca dengan `version` record saat ini.
2. Pengguna mengklik nilai, ikon Ubah, atau Enter pada field baca saja → mode Ubah, fokus di field itu.
3. **Simpan** → `PATCH` dengan versi yang dibaca (`If-Match: W/"n"` atau field `version`).
4. Berhasil → record terbaru dan `ETag` baru; kartu kembali ke mode baca.
5. Versi sudah berubah (409 `stale_version`) → "Data sudah berubah sejak dibuka"; isian tetap ada untuk ditinjau. Versi tidak dikirim (428 `version_required`) adalah kesalahan pemanggil.
6. Data sebelumnya/berikutnya di kartu mengikuti urutan daftar yang sebenarnya dan melewati penjaga draft.

## 4. Delete (penghapusan lunak)

1. **Delete** di menu `⋯` baris atau di bar kartu, hanya bila izin record mengizinkan.
2. Konfirmasi menjelaskan apa yang diarsipkan.
3. Server mengisi `deleted_at` (dokumen hanya bila masih `draft`, dengan versi wajib) dan menjawab 204. Tidak ada baris yang dihapus fisik.
4. Master yang masih dipakai record aktif lain ditolak 409 `referenced_by_children`; layar menjelaskan record mana yang masih memakainya.
5. Record terarsip hilang dari daftar dan lookup; membukanya menjawab 404.

## 5. Memilih record lewat lookup

1. Field lookup difokuskan → batch pertama sumbernya dimuat langsung.
2. Mengetik → query sementara, jeda 250ms, permintaan lama dibatalkan.
3. Panah/Enter atau klik → record terpilih; field menampilkan label tampilannya.
4. Menghapus teks atau menutup popup → pilihan lama kembali.
5. Detail → kartu baca record sasaran ditumpuk di atas; kembali tidak mengubah pilihan.
6. Daftar lengkap → pemilih dengan kandidat sementara; Pilih mengisi, Batal mempertahankan.
7. Baru → kartu pembuat milik resource itu; setelah tersimpan, record dari respons langsung terpilih.
8. Label record terpilih yang belum ada di batch dimuat lewat `record_ids[]` (maksimal 100 per permintaan).

## 6. Bantuan field

1. Hover ±1 detik pada pemicu bantuan → bantuan sementara; kursor pergi → hilang.
2. Klik pemicu → bantuan menetap; klik lagi → tertutup.
3. Tab ke pemicu, Enter/Space → sama seperti klik.
4. Teks wajib, validasi, dan error tidak pernah dipindah ke bantuan.

## 7. Kegagalan

| Kejadian | Di layar |
| --- | --- |
| Validasi gagal (422) | Ringkasan "Periksa {n} isian…" + pesan di setiap field/baris (`details.{i}.{kolom}`) |
| Nomor gagal terbit (422 `number_sequence_failed`) | Ringkasan dengan pesan dari pengaturan penomoran; tidak ada record yang dibuat |
| Versi basi (409 `stale_version`) | "Data sudah berubah sejak dibuka" |
| Tanpa akses (403) atau di luar lingkup organisasi | "Kamu belum memiliki akses untuk tindakan ini" |
| Record tidak ditemukan atau terarsip (404) | Kartu menjelaskan record tidak tersedia; daftar disegarkan |
| Sesi berakhir (401; sekarang juga 419) | "Sesi login sudah berakhir"; isian tetap selama form terbuka |
| Gangguan sistem (5xx) | Ringkasan menetap + "Salin detail bantuan"; tidak menyimpulkan data tersimpan atau tidak |
| Pemuatan daftar gagal | Pesan di baris status tabel + "Coba lagi"; data lama tetap |

## 8. Ganti konteks kerja

1. Pengguna memilih tenant, perusahaan (legal entity), atau unit kerja di Shell.
2. Server memeriksa bahwa pilihan termasuk yang terjangkau (Alur permintaan §2) dan menyimpannya di sesi.
3. Mengganti tenant atau perusahaan mereset tanggal kerja.
4. Semua daftar dan lookup dimuat ulang karena scope berubah; hasil lama dibuang.
