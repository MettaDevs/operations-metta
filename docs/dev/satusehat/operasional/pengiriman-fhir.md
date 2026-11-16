# Mekanisme pengiriman FHIR di Operations Metta

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Encounter](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/encounter/) (disunting 2023-09-27) · [Endpoint Information](https://satusehat.kemkes.go.id/platform/docs/id/postman-workshop/endpoint-information/) (disunting 2024-11-08) · [Akses Token](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/authentication/apis/token/) (disunting 2023-09-27)

[Indeks SATUSEHAT](../README.md) · [Operasional pengiriman](README.md) · [Alur pengiriman rawat jalan](../alur/rawat-jalan.md)

## Mekanisme pengiriman yang diusulkan

Desain RJ-00 dan RJ-07 memakai NoReg sebagai korelasi kunjungan dan ID FHIR sebagai rujukan balikan. `publishEvent` menjalankan handler dan menyimpan baris outbox di dalam transaksi database. Jadwalkan panggilan jaringan setelah commit. Tetapkan pemilik pemetaan payload dan pencatatan hasil per fasyankes. [Kode event Metta](../../../../src/platform/events/index.ts) · [Backlog pengiriman](../pengujian/backlog-rawat-jalan-tanpa-resep.md#hasil-uji-rj-00-sampai-rj-05)

1. **Catat fakta di transaksi klinik.** Healthcare memegang kunjungan, pemeriksaan, dan resep. Farmasi memegang fakta penyerahan. Gunakan kontrak event yang sudah ada bila isinya cukup. Pembuatan, perubahan status, dan finalisasi Encounter perlu pemicu yang eksplisit. [Aturan API dan event](../../04-api-and-integration.md) · [Event resep](../../../../contracts/events/healthcare.prescription.issued.v1.yaml) · [Event penyerahan](../../../../contracts/events/pharmacy.prescription.dispensed.v1.yaml)
2. **Kirim setelah commit.** Handler event Operations berjalan di transaksi yang sama dengan fakta klinis. Pekerjaan pengiriman HTTP dijadwalkan setelah commit agar gangguan jaringan tidak membatalkan simpan klinis. Pertahankan sumber fakta dan catatan hasil di Operations.
3. **Validasi dan jaga urutan.** Ambil kredensial dan mapping untuk fasyankes yang benar. Periksa referensi, kode terminologi, field wajib, dan waktu. Tahan hanya pekerjaan yang belum punya dependensi. Contohnya, penyerahan obat menunggu ID resep dan resume menunggu ID resource yang dirujuk. Koreksi yang lebih baru tidak boleh tertimpa pengiriman ulang versi lama.
4. **Catat pekerjaan dan hasil per resource.** Identitas pekerjaan memuat lingkup tenant, fasyankes, lingkungan SATUSEHAT, jenis resource, ID sumber, dan versi sumber. Simpan identifier bisnis yang stabil, status, percobaan, waktu, correlation ID, kode hasil, serta ID FHIR yang dikembalikan. Gunakan ID itu untuk referensi dan pembaruan. Jika versi yang sama sudah diterima, pengulangan tidak membuat `POST` baru.
5. **Tangani hasil yang tidak pasti.** Timeout sesudah `POST` bisa berarti server sudah menyimpan data. Jika endpoint mendukung pencarian identifier, cari resource yang cocok dalam lingkup organisasi sebelum mengirim ulang. Jika hasilnya masih tidak pasti atau ganda, tandai untuk rekonsiliasi. Uji dukungan pencarian dan perilaku idempotensi per resource di Sandbox sebelum mengandalkannya.

| Hasil | Tindakan pengirim |
| --- | --- |
| `2xx` | Validasi hasil operasi, ambil ID resource dari body atau header yang didokumentasikan, dan simpan hasil. Jika bentuk kirimnya `Bundle` transaksi, periksa status hasil setiap entry. |
| `401` | Perbarui token dan ulangi sekali. Jika tetap ditolak, periksa status kredensial. |
| `400` atau `422` | Baca `OperationOutcome.issue` bila tersedia. Catat field dan sebab secara aman, perbaiki data atau pemetaan, lalu antrekan ulang versi yang benar. |
| `403` atau `404` | Periksa lingkup organisasi, hak akses, dan referensi yang dipakai. Di SSRME, `403` dengan `CONSENT_REQUIRED` berarti kembali ke alur persetujuan. |
| `409` | Rekonsiliasi konflik identifier atau versi sesuai respons dan resource terkait. |
| `429` atau `5xx` | Jadwalkan ulang dengan jeda bertambah, ikuti `Retry-After` bila tersedia, dan rekonsiliasi jika hasil `POST` tidak pasti. |

Untuk operasional, tampilkan antrean, status diterima, perlu perbaikan, dan hasil belum pasti kepada petugas berwenang. Log umum cukup memuat ID korelasi internal, jenis resource, status, dan kode error yang sudah disaring. NIK, payload pasien, isi `diagnostics` yang memuat data klinis, token, dan tautan SSRME bersifat sensitif. [Katalog Encounter dan respons API](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/encounter/)
