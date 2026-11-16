# Antrean dan pemeriksaan di poli

Dokter atau perawat poli membuka antrean, memulai pemeriksaan pasien, mengisi anamnesa, periksa fisik, dan tindakan, menyimpan, lalu menutupnya dengan Selesai periksa. Sesudah selesai, kunjungan muncul di kasir dengan tindakan sebagai rincian biaya. Pasien juga bisa dirujuk ke poli lain di kunjungan yang sama.

## Sub-features

- `periksa-antrean` menampilkan pasien poli dengan status dan nomor antrean.
- `periksa-mulai` memulai pemeriksaan dari menu baris atau dari halaman pemeriksaan.
- `periksa-isi` menyimpan dokter, keluhan, periksa fisik wajib, dan tindakan.
- `periksa-selesai` menutup pemeriksaan dan menerbitkan tagihan kunjungan.
- `periksa-rujuk-internal` membuat tujuan baru di poli lain dengan antrean sendiri.

## How to get to it (user POV)

- Menu Layanan kesehatan › Pemeriksaan › Antrean poli (`/healthcare/examination/queue`), lalu tombol `Tindakan untuk <antrean> <nama>` di baris pasien, menu `Mulai periksa` atau `Periksa`.
- Tombol `Panggil berikutnya` di antrean poli.
- Langsung ke `/healthcare/examination/queue/<NoReg>/<kode section>`, mis. `/healthcare/examination/queue/KCS-01-REG-00000004/UMUM`. Halaman ini menampilkan tombol `Mulai periksa` bila pemeriksaan belum dimulai.

## Driving it with verify.ts

Prasyarat:

- Registrasi dari [pendaftaran kunjungan](./pendaftaran-kunjungan.md) dengan NoReg dan nomor antrean yang diketahui, di tempat kerja `PT Klinik Contoh Sehat · Klinik Sehat Pusat`.
- Nilai periksa fisik diambil dari `sample.clinic.visits[0].physical` di `dev/tenants.json`.

- **Buka antrean.** Jalankan `bun scripts/verify.ts go healthcare/examination/queue`. Combobox `Poli` dan `Ruangan saya` terisi, dan baris pasien Anda berstatus `Menunggu`.
- **Mulai periksa.** Jalankan `bun scripts/verify.ts click button "Tindakan untuk A-004 Budi Contoh" --exact` lalu `click menuitem "Mulai periksa" --exact`. URL menjadi `/healthcare/examination/queue/<NoReg>/UMUM`, judul `Pemeriksaan A-004`, dan tombol `Selesai periksa` tampil.
- **Isi anamnesa.** Jalankan `bun scripts/verify.ts fill combobox "Dokter / Tenaga medis" --exact "dr. Contoh Sehat"`, `click option "dr. Contoh Sehat"`, dan `fill textbox "Keluhan utama" --exact "Demam tiga hari"`.
- **Isi periksa fisik wajib.** Jalankan `bun scripts/verify.ts click combobox Kesadaran --within "Periksa fisik"`, `click option "COMPOS MENTIS" --exact`, lalu `fill textbox <nama> <nilai> --within "Periksa fisik"` untuk `Sistole`, `Diastole`, `"Tinggi badan (cm)"`, `"Berat badan (kg)"`, `"Lingkar perut"`, `"Detak nadi"`, dan `Nafas`.
- **Tambah tindakan.** Jalankan `bun scripts/verify.ts click button Tambah --within "Biaya Tindakan" --exact`, `fill combobox "Nama Tindakan, baris 1" "Konsultasi dokter umum"`, dan `click option "Konsultasi dokter umum"`. Baris menampilkan tarif `50.000`, dokter terisi, dan kolom User & Jam `Belum disimpan`.
- **Simpan.** Jalankan `bun scripts/verify.ts click button Simpan --exact`. Teks `Belum disimpan` hilang dan tidak ada ringkasan `Periksa N isian yang perlu diperbaiki`. `sql "select count(*) from sim_tr_pemeriksaan_tindakan"` bertambah satu.
- **Selesai periksa.** Jalankan `bun scripts/verify.ts click button "Selesai periksa" --exact`. Tombol `Selesai periksa` hilang dari toolbar.
- **Bukti selesai.** Jalankan `bun scripts/verify.ts sql "select t.status, t.selesai_periksa_pada, r.status from sim_tr_registrasi_tujuan t join sim_tr_registrasi r on r.id = t.registrasi_id where r.no_reg = '<NoReg>'" --save selesai` dan `sql "select t.jenis, t.status, d.sumber_module, d.jenis_biaya_nama, d.status from tagihan_kasir t join tagihan_kasir_detail d on d.tagihan_sumber_dokumen_id = t.sumber_dokumen_id where t.sumber_nomor = '<NoReg>'" --save tagihan`. Tujuan dan registrasi `selesai`, satu `tagihan_kasir` berjenis `kunjungan`, dan rincian `healthcare` berstatus `terbuka`.
- **Rujuk internal.** Pada pemeriksaan lain yang sudah dimulai dan periksa fisik wajibnya terisi, jalankan `bun scripts/verify.ts click radio "Rujuk Internal"`, `click button Tambah --exact --nth 0`, `click combobox "Poli / Ruangan" --within "Tambah rujuk internal"`, `click option Pusling`, dan `click button Rujuk --exact --within "Tambah rujuk internal"`. Toast `Pasien dirujuk ke Pusling dengan antrean P-...` muncul, dan `sim_tr_registrasi_tujuan` untuk NoReg itu punya baris `urutan` 2 di Pusling berstatus `menunggu`.

## Gotchas

- Poli Umum mewajibkan delapan isian periksa fisik: Kesadaran, Sistole, Diastole, Tinggi badan, Berat badan, Lingkar perut, Detak nadi, dan Nafas. Simpan, Selesai periksa, dan Rujuk ditolak dengan `Periksa 8 isian yang perlu diperbaiki` bila salah satunya kosong. Rujuk menulis `Rekam medis belum disimpan` di dialognya.
- Halaman pemeriksaan yang dibuka langsung lewat URL sebelum dimulai hanya menampilkan `Mulai periksa`. Radio Status pasien nonaktif sampai tombol itu diklik.
- Halaman pemeriksaan punya enam tombol `Tambah` (alergi, anatomi, diagnosa, tindakan, resep, rujuk). Selalu pakai `--within` dengan nama region (`Biaya Tindakan`, `E-Resep`). Tombol Tambah rujuk internal ada di kartu Status Pasien yang tidak punya region; di commit ini ia `Tambah` pertama (`--nth 0`) sesudah radio Rujuk Internal dipilih.
- Data contoh tidak membuat jadwal praktik hari ini, jadi isian `Nakes` di header pemeriksaan kosong dan rujukan berjalan tanpa dokter. Pilih dokter di Anamnesa.
- Tagihan kunjungan baru lahir saat Selesai periksa. Sebelum itu kasir tidak menampilkan kunjungan, walau tindakan sudah tersimpan.
- `tagihan_kasir.status` sudah `selesai` sejak pemeriksaan selesai, juga sebelum dibayar. Status bayar dibaca dari rincian (`tagihan_kasir_detail.status`, `kasir_id`), dan layar kasir menulisnya `Belum Bayar`.
- Baris contoh A-001 dan A-002 sudah berstatus Diperiksa. Pakai nama tombol baris lengkap dengan nomor antrean milik Anda dan `--exact`.
