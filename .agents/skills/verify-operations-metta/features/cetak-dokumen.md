# Cetak dokumen dan layout cetak

Kuitansi dicetak dari layar Pembayaran dan etiket obat dari kartu penyerahan farmasi, lewat tombol cetak yang sama. Klik tombol membuka PDF di tab baru; panah di sebelahnya memilih layout lain atau mengunduh Word. Admin mengganti layout per legal entity di Sys Admin › Cetak › Layout cetak dengan mengunggah berkas Word, lalu memilih Pakai layout ini; cetak berikutnya memakai layout itu sampai Kembali ke bawaan. Kop surat diatur di Sys Admin › Cetak › Kop surat.

## Sub-features

- `cetak-kuitansi` membuka PDF kuitansi A4 dari pembayaran yang sudah diposting.
- `cetak-menu` menampilkan layout bawaan dan unggahan beserta ukuran kertasnya, dan Unduh Word.
- `cetak-etiket` membuka PDF etiket 96 × 200 mm dari resep yang sudah disiapkan.
- `layout-unggah` mengunggah berkas Word untuk kuitansi dan memakainya untuk legal entity tempat kerja.
- `layout-dipakai` mencetak kuitansi dengan layout unggahan itu, termasuk ukuran kertasnya.
- `layout-bawaan` mengembalikan kuitansi ke layout bawaan.
- `kop-surat` mengubah nama di kop, baris induk, dan catatan kaki per legal entity atau unit kerja.

## How to get to it (user POV)

- Kasir › Pembayaran, buka pembayaran yang sudah dibayar: tombol `Kuitansi` dan panah `Pilihan kuitansi` di bar aksi.
- Farmasi › Pelayanan resep › Antrean resep, buka resep yang sudah Disiapkan: tombol `Etiket` dan panah `Pilihan etiket` di toolbar kartu.
- Sys Admin › Cetak › Layout cetak (`/sysadmin/reporting/report-layouts`): menu `Tindakan untuk Kuitansi pembayaran`, lalu `Buka`.
- Sys Admin › Cetak › Kop surat (`/sysadmin/reporting/letterheads`).

## Driving it with verify.ts

Prasyarat:

- `bun scripts/verify.ts up` dari worktree yang diuji; run ini menyalakan Gotenberg sendiri, jadi PDF tersedia.
- `bun scripts/verify.ts journey outpatient --prepare-cashier` sudah lulus di run yang sama, sehingga ada pembayaran yang diposting dan resep yang disiapkan.

- **Seluruh perjalanan.** Jalankan `bun scripts/verify.ts journey print`. Setiap langkah mencetak `OK`, dan folder `print-<waktu>/` berisi `kuitansi-bawaan.pdf` (A4), `etiket.pdf` (96 × 200 mm), `kuitansi-a5.docx`, `kuitansi-layout-baru.pdf` (A5, judul `KUITANSI LAYOUT UNGGAHAN`), `kuitansi-kembali.pdf` (A4 lagi), screenshot dan snapshot per langkah, `database.txt` berisi baris `report_layouts` dan `report_layout_defaults`, dan `journey.json`.
- **Menu layout.** Di layar pembayaran, `click button "Pilihan kuitansi"`, lalu `wait menuitem "Struk 76 mm"`. Menu berisi `Kuitansi A4 · 210×297 mm`, `Receipt A4 (English) · 210×297 mm`, `Struk 76 mm · 76×200 mm`, layout unggahan, dan `Unduh Word`.
- **Kop surat.** `go sysadmin/reporting/letterheads`, `click button "Tindakan untuk PT Klinik Contoh Sehat"`, `click menuitem Buka --exact`, isi `textbox "Nama di kop"`, lalu `click button Simpan --exact`. Toast `Kop surat disimpan.` muncul, dan kuitansi berikutnya memakai nama itu.

## Gotchas

- PDF dibuka sebagai URL blob di tab baru. `journey print` mengambil berkas itu dari halaman yang membukanya; `shot` tidak bisa memotret penampil PDF headless.
- Baris daftar Layout cetak dan Kop surat dibuka dengan klik ganda atau menu tindakan, bukan klik tunggal.
- Tombol `Unggah layout` punya nama yang sama dengan judul bagiannya; pakai `--nth 1`.
- Kop memakai identitas unit kerja yang menerbitkan dokumen, lalu legal entity-nya, lalu nama legal entity. Data contoh belum mengisi kop, jadi kuitansi menulis `PT Klinik Contoh Sehat`.
- Run lama yang dinyalakan sebelum renderer ditambahkan tidak punya Gotenberg: `down` lalu `up` lagi.
