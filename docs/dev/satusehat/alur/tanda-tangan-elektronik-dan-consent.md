# Tanda tangan elektronik dan FHIR Consent

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Tanda Tangan Elektronik (TTE)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tanda-tangan-elektronik/) (v1.1, rilis 2026-10-19, disunting 2026-10-30) · [Task](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/task/) (disunting 2026-10-30) · [Provenance](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/provenance/) (disunting 2026-10-30)

[Indeks SATUSEHAT](../README.md) · [Alur layanan](README.md) · [Endpoint dan respons tanda tangan elektronik](../endpoint/tanda-tangan-elektronik.md) · [Payload tanda tangan elektronik dan FHIR Consent](../payload/tanda-tangan-elektronik-dan-consent.md)

Playbook TTE v1.1 (19 Oktober 2026) menerangkan penandatanganan dokumen melalui SATUSEHAT FHIR dan SATUSEHAT Mobile (SSM) menggunakan sertifikat X.509 dalam Infrastruktur Sertifikat Digital Kesehatan Nasional. Sumber menandai modul tersedia di Sandbox selama pengembangan. Dokumen sasaran mencakup resume, resep, hasil pemeriksaan, formulir persetujuan serta surat klinis atau penjaminan. [Playbook TTE](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tanda-tangan-elektronik/) · [Diagram SIMRS, FHIR dan SSM](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/_images/alur-teknis-tte-antar-simrs-ss-ssp.png)

## Prasyarat dan tanggung jawab

- Fasyankes punya akses OAuth Sandbox, Organization, Location, Practitioner, Patient dan Encounter sesuai skenario. Siapkan versi dokumen yang akan ditinjau penanda tangan. Kaitkan dokumen ke Patient dan Encounter sesuai profil klinis. [Onboarding FHIR](../endpoint/onboarding-fhir.md)
- SIM menyiapkan dokumen, Provenance awal, Task dan QR dari `Task/{id}`. SSM membaca Task dan dokumen target, lalu menjalankan persetujuan dan tanda tangan pada aplikasi. SATUSEHAT meneruskan Task dan mengirim webhook status ke SIM. Siapkan akun uji penanda tangan dan akses SSM yang dapat membuka Task yang dituju sebelum pengujian.
- Sumber Metta yang sudah tersedia meliputi kunjungan, identitas nakes/pasien, isi rekam medis, diagnosis, resep dan pemetaan draft resume. Pelacakan versi dokumen yang ditandatangani, pemetaan peran penanda tangan, ID Provenance dan Task, QR, callback dan bukti validasi signature masih perlu disimpan oleh integrasi. [Rekam medis Metta](../../../../modules/healthcare/README.md#rekam-medis-pemeriksaan) · [Matriks Composition](../payload/matriks-rawat-jalan.md#composition)

## Urutan penandatanganan

Siapkan dokumen yang akan ditandatangani dan identitas penandatangan. Ajukan proses penandatanganan sesuai jalur yang diaktifkan dan korelasikan status dokumen dengan hasil yang dikembalikan. Catat Provenance atau Consent hanya untuk fakta yang diwakilinya. Langkah per peran, endpoint dan respons tercatat di [kontrak TTE](../endpoint/tanda-tangan-elektronik.md#flow-endpoint-dan-respons).

## Error, keamanan, dan uji Sandbox

| Kondisi uji | Kriteria lulus |
| --- | --- |
| Resume ditandatangani | Dokumen, Provenance dan Task terhubung. Penanda tangan yang ditugaskan bisa mengakses QR dan melihat versi yang dimaksud. Task selesai dengan output `signed`; signature tersimpan pada Provenance dengan target yang sama. |
| Ditolak atau gagal | Status `rejected` atau `exception` tercermin pada layar dan audit; dokumen tidak ditampilkan sebagai sudah ditandatangani. Gunakan referensi Task untuk melihat status sebelum membuat pengajuan baru. |
| Bulk | Alur `electronic-sign-doc-out` dapat berjalan tanpa Encounter pada fixture yang sah; setiap Provenance tetap menunjuk target tertentu. |
| Error FHIR, timeout dan callback ulang | Uji signature atau referensi salah dan akun yang tak berhak. Simpan HTTP status dan `OperationOutcome.issue` yang tersedia. Rekonsiliasi ID sebelum retry, cocokkan callback duplikat dengan Task yang sama, dan cek bahwa status yang lebih lama tidak membatalkan hasil terbaru. |
| Persetujuan | Uji form aktif, penolakan dan perubahan status. Laporan audit menunjukkan pelaku, kebijakan, target dan versi. Akses SSRME tetap mengikuti persetujuan SSRME. |

Bukti yang boleh disimpan pada dokumen tim meliputi waktu uji, status, korelasi fixture dan kode error yang telah disamarkan. Jangan masukkan QR aktif, sertifikat privat, signature mentah, lokasi perangkat atau isi klinis ke log umum. Status HTTP dan Rule Number yang spesifik untuk modul akan dicatat setelah permintaan uji melalui akun terdaftar tersedia. TTE dan FHIR Consent belum punya bukti Sandbox Metta. [Validasi dan error](../validasi/respons-dan-error.md) · [Status bukti Sandbox](../pengujian/skenario-sandbox.md#status-bukti)
