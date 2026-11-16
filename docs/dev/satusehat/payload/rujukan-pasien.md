# Matriks resource dan data rujukan pasien

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Rujukan Pasien](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rujukan/) (v6.1, rilis 2026-08-21, disunting 2026-08-24)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Rujukan pasien](../alur/rujukan-pasien.md) · [Kontrak HTTP rujukan pasien](../endpoint/rujukan-pasien.md)

## Matriks resource dan data Metta

| Resource dan field | Pengisian | Kesiapan Metta |
| --- | --- | --- |
| ServiceRequest `identifier[]` | Pertahankan nomor PCare pada `http://sys-ids.kemkes.go.id/referral-number-pcare` jika berlaku. Identifier kepesertaan asuransi memakai `https://sys-ids.kemkes.go.id/insurance-subscriber/{organization-id-asuransi}` jika berlaku. Pisahkan identifier sumber dan setiap identifier yang dikembalikan SATUSEHAT. | Pemetaan penjamin, nomor PCP/PCare dan nomor rujukan nasional perlu ditelusuri dan diverifikasi per penyelenggara. |
| ServiceRequest `status`, `intent`, `category[]`, `code` | Permintaan memakai `active` dan `original-order`. Kategori umum rujukan `3457005` dari `http://snomed.info/sct`. Kode jenis rujukan di `code` mengikuti lampiran 1, antara lain `737492002` rawat jalan, `737481003` rawat inap, `385868005` darurat, `409014006` maternal, dan `408989004` neonatal. | Perlu pemilihan jenis layanan dan kategori rujukan yang terstruktur. |
| ServiceRequest `subject`, `encounter`, `requester`, `performer[]`, `performerType` | Patient dan konteks Encounter. Organization perujuk pada `requester`, Organization tujuan pada `performer[]`, jenis nakes pada `performerType` jika berlaku menurut kode Occupation SNOMED CT. | Identitas fixture tersedia. Perlu lookup tujuan dan pemetaan spesialisasi/peran tenaga kesehatan. |
| ServiceRequest `locationCode[]`, `reasonReference[]`, `supportingInfo[]`, `basedOn[]` | Jenis tujuan dan transportasi dari terminologi skenario. Nomor registrasi ambulans pada `locationCode.text` bila berlaku. Diagnosis dan kriteria klinis pada `reasonReference[]`; informasi pendukung pada `supportingInfo[]`; tautan CarePlan pada `basedOn[]` bila menggunakan rencana. | Diagnosis lokal perlu ID Condition; transportasi dan referensi dokumen perlu kontrak data. |
| CarePlan `identifier[]`, `author`, `contributor[]`, `category[]`, `status`, `intent` | Identifier organisasi dengan system `http://sys-ids.kemkes.go.id/careplan/authoring-organization`. Perujuk juga direferensikan sebagai Organization pada `contributor[]` di v6.1. Untuk `author` gunakan Reference petugas sesuai contoh profil karena tabel Juknis mencantumkan URI identifier pada baris petugas. Gunakan `active`, `plan`, kategori rencana sesuai lampiran 3 serta kategori rujukan `3457005`. | Perlu rencana tersimpan, penulis terotorisasi, konteks Patient dan Encounter. Verifikasi `author` dengan koleksi rujukan sebelum create. |
| CarePlan `addresses[]`, `supportingInfo[]`, `activity[].detail` | Condition untuk diagnosis dan kriteria. Kebutuhan layanan, kunjungan atau alat memakai `kind=ServiceRequest`, `Appointment` atau `DeviceRequest`, `status=not-started`, dan kode kebutuhan dari terminologi yang berlaku. Sertakan sedikitnya satu aktivitas sesuai ketentuan rencana. | Perlu katalog kebutuhan dan pemilik data rencana. |
| Task `code`, `status`, `intent`, `requester`, `owner`, `basedOn`, `input/output` | Ikuti tahap. Task calon memakai Organization perujuk pada `owner` sebagaimana alur kandidat. Task pengajuan persetujuan memakai Organization tujuan. Setiap input/output membawa `type` dan `value[x]`. | Perlu state machine, histori kandidat dan keputusan lintas organisasi dengan korelasi per tahap. |
| Encounter `basedOn[]` | Tujuan merujuk ServiceRequest yang mendorong kunjungan. Gunakan profil rawat jalan, IGD atau rawat inap sesuai layanan aktual. | ID order nasional diperlukan saat registrasi tujuan. |
