# Standar dokumentasi SATUSEHAT

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](inventaris-sumber-resmi.md)

[Indeks SATUSEHAT](../README.md) · [Referensi dan pemeliharaan dokumen](README.md)

Gunakan nama file huruf kecil dengan tanda hubung, misalnya `penjadwalan-dan-janji-temu.md`. `README.md` menjadi indeks setiap folder. Gunakan nama layanan yang sama jika halaman alur, endpoint, dan payload membahas layanan yang sama. Istilah protokol dan nama resource mengikuti ejaan resmi.

## Struktur per jenis dokumen

| Jenis | Urutan isi yang dicari pembaca |
| --- | --- |
| Alur | Fungsi dan prasyarat, peran serta asal data, urutan transaksi serta dependensi, hasil yang diharapkan, lalu tautan endpoint, payload, dan uji. |
| Endpoint | Kegunaan, environment, autentikasi, metode dan path, header atau query, bentuk respons, lalu kesalahan dan tautan payload. |
| Payload | Profil atau resource, field wajib dan kondisional, kardinalitas, sumber Operations dan gap, terminologi, lalu contoh request atau potongan respons. |
| Validasi dan operasional | Kondisi pemicu, bukti pada respons atau log, tindakan, dan cara memeriksa pemulihan. |
| Pengujian | Prasyarat dan fixture sintetis, langkah, kriteria lulus, tanggal uji, hasil teramati, dan gap. |
| Referensi | Cakupan, tautan sumber, versi atau tanggal terbit, tanggal penyuntingan sumber, dan tanggal pemeriksaan. |

Setiap halaman memakai satu judul H1, blok tanggal di bawah judul, navigasi ke indeks, dan subjudul yang sesuai isinya. Gunakan tabel untuk field, metode, dan pemetaan. Gunakan blok berkode `json` atau `http` untuk contoh. Bedakan contoh sintetis dari respons yang benar-benar teramati.

## Memelihara tanggal dan versi

- **Revisi dokumen** adalah tanggal terakhir isi Markdown diperbarui. Gunakan `YYYY-MM-DD` dalam WITA.
- **Sumber diperiksa** adalah tanggal referensi yang mendasari dokumen terakhir ditinjau. Saat hanya mengubah tata letak atau tautan internal, perbarui tanggal revisi dan pakai tanggal pemeriksaan sumber yang sudah tercatat.
- **Terakhir disunting** mengikuti metadata halaman Kemenkes. Catat **versi dan tanggal rilis** bila penerbit mencantumkannya. Jika tanggal tidak ada, catat versi bila tersedia dan tandai tanggal sebagai tidak tercantum.
- Saat ada rilis atau perubahan kontrak, cocokkan versi dan tanggal di [inventaris sumber resmi](inventaris-sumber-resmi.md). Perbarui halaman terdampak, tanggal pemeriksaan, dan [riwayat perubahan](riwayat-perubahan.md). Untuk perubahan wire, cek contoh JSON, operasi, matriks field, serta skenario Sandbox terkait.
- Gunakan Kemenkes dan standar resmi untuk kontrak eksternal. Gunakan kode, skema, atau event Operations untuk klaim tentang perilaku lokal. Kaitkan status bukti dengan hasil yang dapat ditelusuri.
