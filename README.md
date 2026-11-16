# Operations Metta

## Tentang Operations Metta

Operations Metta adalah runtime ERP untuk operasional klinik yang berjalan di SaaS dan on-prem dengan Bun dan Elysia. Repo ini menangani transaksi klinik, persediaan, kasir, dan akses pengguna di dalam tenant. Onboarding, pengelolaan tenant dan lingkungan, serta distribusi rilis dikelola oleh [control-plane-metta](https://github.com/MettaDevs/control-plane-metta).

## Modul dan status

| Modul | Cakupan saat ini |
| --- | --- |
| Asset Management | Data aset tetap dan penerimaan aset. [Registrasi route](modules/asset-management/src/index.ts) |
| Healthcare | Data pasien dan nakes, jadwal praktik, pendaftaran, pemeriksaan rawat jalan, tindakan, dan resep. [Dokumentasi Healthcare](modules/healthcare/README.md) |
| Pharmacy | Antrean resep, penyerahan obat, retur pasien, dan penjualan obat bebas di loket. [Dokumentasi Pharmacy](modules/pharmacy/README.md) |
| Praktik Dokter | Direncanakan berjalan di runtime Operations Metta. |

## Mulai di laptop

Siapkan Bun sesuai versi CI, PostgreSQL dan Valkey. Gunakan [panduan setup lokal](docs/onboarding/setup.md) untuk membuat layanan pengembangan dan mengisi `.env` dari [contoh konfigurasi](.env.example). Jalankan perintah berikut dari akar repo.

```bash
bun install
bun run dev:setup
bun run dev
```

`dev:setup` menjalankan migrasi dan menyiapkan tenant demo. Gunakan URL lingkungan yang dicetak oleh perintah itu.

## Peta dokumentasi

| Dokumen | Isi |
| --- | --- |
| [Onboarding developer](docs/onboarding/index.md) | Cara memulai, peta kode, dan aturan kerja. |
| [Desain teknis](docs/dev/README.md) | Arsitektur runtime, pembagian tanggung jawab, dan integrasi antar modul. |
| [Kontrak API dan event](contracts/) | Kontrak yang dipakai pemanggil dan penerima event. |
| [Dokumentasi SATUSEHAT](https://github.com/MettaDevs/operations-metta/blob/main/docs/dev/satusehat/README.md) | Alur, endpoint, payload, terminologi, validasi, dan skenario Sandbox. |

## Status SATUSEHAT

Uji Sandbox pada 16 November 2026 membuktikan autentikasi, pemetaan empat referensi, serta pembuatan dan baca balik `Location` dan `Encounter` awal berstatus `arrived`. Pengiriman otomatis dari transaksi Operations, finalisasi `Encounter`, dan pengiriman `Composition` masih tercatat di backlog. [Bukti Sandbox dan pekerjaan terbuka](https://github.com/MettaDevs/operations-metta/blob/main/docs/dev/satusehat/pengujian/skenario-sandbox.md#status-bukti)

## Kontribusi dan pemeriksaan

Kerjakan perubahan di branch kerja, jalankan enam pemeriksaan berikut, lalu push branch dan buka PR ke `main`. Aktifkan squash auto-merge setelah PR dibuat. [Panduan kontribusi](docs/onboarding/kontribusi.md) · [Aturan alur kerja](AGENTS.md#alur-kerja)

```bash
bun run check:generated
bun run typecheck
bun run lint
bun test
bun run format:check
bun run check:boundaries
```

Panduan repo menjelaskan cara menjalankan tes dengan PostgreSQL dan Valkey serta kapan perlu menjalankan `bun run build`. [Pemeriksaan wajib](AGENTS.md#sebelum-menyatakan-hijau)
