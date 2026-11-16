# Jadwal praktik, Slot, dan janji temu

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Interoperabilitas](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/) (disunting 2024-10-03) · [Standar Terminologi SATUSEHAT](https://satusehat.kemkes.go.id/platform/docs/id/terminology/standar-terminologi/) (disunting 2026-11-06) · [Standar Terminologi SATUSEHAT](https://drive.google.com/file/d/1r_fHBmTYkqbaE3_g20RMcVztWHSsRHgP/preview) (v12.0, rilis 2026-10-31)

[Indeks SATUSEHAT](../README.md) · [Alur layanan](README.md) · [Endpoint penjadwalan dan janji temu](../endpoint/penjadwalan-dan-janji-temu.md) · [Payload penjadwalan dan janji temu](../payload/penjadwalan-dan-janji-temu.md)

Katalog publik menerbitkan operasi untuk HealthcareService, PractitionerRole, Slot, Appointment dan AppointmentResponse. Standar Terminologi v12.0 (31 Oktober 2026) menjelaskan coding penjadwalan termasuk Schedule. Kontrak ini memadukan metode HTTP Kemenkes, bentuk payload dasar FHIR R4, serta pemetaan ke Operations Metta. Uji akses endpoint dan perilaku reservasi SATUSEHAT belum tersedia untuk Metta. [Katalog Interoperabilitas](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/) · [Standar Terminologi](https://satusehat.kemkes.go.id/platform/docs/id/terminology/standar-terminologi/) · [Buku Standar Terminologi v12.0, bab 38–43](https://drive.google.com/file/d/1r_fHBmTYkqbaE3_g20RMcVztWHSsRHgP/preview)

## Sumber data dan prasyarat

| Data | Sumber Metta dan keputusan yang masih dibutuhkan |
| --- | --- |
| Organization, Location, Patient dan Practitioner | Siapkan IHS dan referensi lingkungan yang sama. Gunakan lokasi dari scope unit pelayanan dan nakes yang benar-benar memberikan layanan. [Identitas SATUSEHAT](../payload/matriks-identitas.md) |
| Layanan dan peran | `sim_m_section` dan keterkaitan ruangan menjadi sumber layanan/lokasi. `sim_m_nakes` dan profesinya menjadi sumber nakes. Hubungan nakes–section dalam alur Metta berasal dari jadwal yang berlaku. Perlu pemetaan kode layanan/poli, hak publikasi dan ID HealthcareService serta PractitionerRole per organisasi. [Jadwal praktik Metta](../../../../modules/healthcare/README.md#jadwal-praktik) |
| Sesi dan kapasitas | `sim_m_sesi_praktik`, `sim_m_jadwal_template`, dan `sim_tr_jadwal_praktik` menyimpan hari, jam, waktu lewat tengah malam, kapasitas, status dan nakes pengganti. Pendaftaran menambah `jumlah_terdaftar`, pembatalan menguranginya. Batas `NULL` berarti tanpa batas. Perlu aturan panjang slot, kapasitas publik, no-show, reservasi lintas kanal dan korelasi Schedule/Slot. |
| Janji, respons dan kunjungan | Metta mencatat registrasi, tujuan kunjungan, antrean, jadwal serta pembatalan. Perlu persetujuan atau respons tiap peserta, pemetaan status janji yang terpisah dari Encounter, identifier reservasi dan hubungan ke kunjungan aktual. [Pendaftaran Metta](../../../../modules/healthcare/README.md#pendaftaran-kunjungan) |

Konversi jam dari zona waktu legal entity, termasuk sesi lintas tengah malam. Rekam waktu janji sebagai instant dengan offset atau UTC. Pakai akhir sesi aktual saat membentuk interval. Pengadaan Schedule, izin menulis slot, dan scope publikasi layanan harus sesuai akses yang diberikan SATUSEHAT.

## Urutan kirim dan rekonsiliasi

1. Resolve Organization, Location, layanan, peran nakes, Schedule dan Slot dengan ID yang sah. Tetapkan sumber kebenaran kapasitas dan kepemilikan perubahan jadwal. Sebelum reservasi, verifikasi waktu, role, status dan kapasitas lokal.
2. Buat Appointment dengan kunci bisnis stabil. Simpan ID hasil. Catat respons setiap peserta melalui AppointmentResponse bila digunakan. Baca Appointment, Slot dan response untuk mengetahui transisi yang terjadi. Dukungan situs terhadap pemesanan atomik, callback atau sinkron otomatis dari response ke status Appointment masih perlu dibuktikan.
3. Saat pasien hadir dan layanan aktual dimulai, buat Encounter dari registrasi. Bila profil mengizinkan, isi `Encounter.appointment[]` dengan ID Appointment. Status datang, fulfilled, batal, perubahan slot dan no-show dicatat sesuai peristiwa. Reservasi yang dibatalkan atau tidak hadir mengikuti proses yang tidak membuat Encounter pelayanan. [FHIR Encounter](https://hl7.org/fhir/R4/encounter.html)
4. Saat waktu berganti atau jadwal dibatalkan, simpan histori. Cocokkan peran pengganti, kondisi Slot, janji terdampak dan perhitungan kapasitas. Gunakan event lokal untuk pengiriman idempoten. Simpan status pengiriman per operasi. Jika satu langkah berhasil dan berikutnya gagal, lakukan rekonsiliasi sebelum retry. Uji dukungan version-aware update atau transaksi jika dibutuhkan bersama peran program.

## Respons gagal, privasi dan uji

| Kondisi uji | Kriteria lulus |
| --- | --- |
| Create/read layanan dan peran | Query `specialty`, `practitioner` dan kombinasi Organization mengembalikan scope dan referensi yang benar. Uji layanan `public` dan `private` sesuai hak akses yang diberikan. |
| Slot dan janji | Slot memakai Schedule valid, interval cocok, satu reservasi tersimpan untuk satu kapasitas fixture, Appointment dari query `actor` dapat dibaca. Uji dua permintaan bersamaan dan sesi tanpa batas kapasitas. |
| Respons peserta dan Encounter | `GET /AppointmentResponse?appointment={id}` memuat respons yang benar. Cek peserta accepted/declined, perpindahan jadwal, pembatalan, no-show, dan hubungan `Encounter.appointment[]` yang diizinkan. |
| Error dan retry | Catat HTTP, `OperationOutcome.issue[]`, path dan Rule Number aktual pada `400`/`422`. Uji `401`/`403`, konflik kapasitas serta `404` untuk rujukan yang salah. Untuk timeout, `429` dan `5xx`, baca ulang menurut ID, korelasi lokal dan query yang tersedia sebelum retry terbatas. |
| Bukti dan privasi | Simpan waktu, status, kode dan korelasi fixture. Batasi akses identitas pasien, alasan janji, kontak, jadwal privat dan data klinis. Token dan header otorisasi tidak masuk log. |

Kepemilikan Schedule, pencarian Slot, format PATCH khusus, aturan reservasi dan bukti penerimaan masih terbuka. [Validasi dan error](../validasi/respons-dan-error.md) · [Bukti Sandbox](../pengujian/skenario-sandbox.md#status-bukti)
