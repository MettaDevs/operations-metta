# Skrining Hipotiroid Kongenital dan tes konfirmasi

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Skrining Hipotiroid Kongenital (SHK)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/) (v2.1, rilis 2024-06-12, disunting 2025-12-02) · [Observation](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/observation/) (disunting 2023-09-27) · [DiagnosticReport](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/diagnostic-report/) (disunting 2023-09-27)

[Indeks SATUSEHAT](../README.md) · [Alur layanan](README.md) · [Pencarian dan korelasi hasil skrining hipotiroid kongenital](../endpoint/skrining-hipotiroid-kongenital.md) · [Field dan terminologi skrining hipotiroid kongenital](../payload/skrining-hipotiroid-kongenital.md)

Playbook SHK v2.1 (12 Juni 2024) mencakup pengambilan dan rujukan spesimen, pemeriksaan TSH pada dried blood spot (DBS), hasil skrining, dan tes konfirmasi. Gunakan kontrak ini bersama [Rujukan Spesimen](laboratorium-rujukan-spesimen.md) dan [Episode Neonatus](program-kehamilan-persalinan-dan-neonatus.md). Belum ada bukti flow SHK di Sandbox Metta. [Playbook SHK](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/shk/)

## Prasyarat dan sumber Metta

| Data | Pemakaian |
| --- | --- |
| Bayi dan ibu | Jika belum ber-NIK, lakukan alur registrasi bayi [MPI](../endpoint/master-data-pasien.md) dan simpan IHS bayi. Rekam relasi bayi–ibu serta urutan lahir sesuai data. |
| Perujuk dan penerima | Siapkan Organization, Location, petugas pengambil, petugas laboratorium dan akses yang sah pada dua fasyankes. |
| Kunjungan dan hasil | Metta memiliki pasien, identitas, kunjungan, aktivitas pemeriksaan, diagnosis dan catatan klinis umum. Pemetaan order SHK, barcode, accession, kondisi transportasi, waktu penerimaan, referensi LIS, hasil per metode dan tindakan follow-up perlu dipastikan. [Pemeriksaan Metta](../../../../modules/healthcare/README.md#rekam-medis-pemeriksaan) |
| Terminologi dan metode lab | Gunakan kode yang sesuai jenis spesimen, metode, dan limit deteksi alat. Simpan satuan asli alat, hasil yang akan dikirim, kualitas spesimen, dan bukti validasi petugas lab. |

## Urutan transaksi dan korelasi

Path FHIR relatif terhadap `/fhir-r4/v1`. Gunakan `Authorization: Bearer <token>` dan media type sesuai metode. `POST` transaksi Bundle mengikuti pola FHIR sistem, dengan path dan jenis Bundle yang didukung koleksi SHK di lingkungan tersebut. [Kontrak HTTP FHIR](../endpoint/kontrak-fhir-http.md)

| Bab | Request dan pelaku | Keluaran yang disimpan |
| --- | --- | --- |
| 1–3 | Registrasi atau cari Patient bayi, buat Encounter perujuk dan rencanakan pemeriksaan. | ID Patient bayi dan Encounter asal. |
| 4–5 | Perujuk mengirim ServiceRequest dan Specimen bersama Bundle pada waktu transaksi. Tautkan order dan sampel. Data tambahan bisa terkait Observation, Procedure, Condition atau MedicationStatement sesuai fakta. | ID ServiceRequest dan Specimen per entry. Catat identifier lokal serta ID nasional yang dikembalikan. |
| 6–7 | Perujuk membaca `GET /ServiceRequest/{id}` dan `GET /Specimen/{id}`. | `ServiceRequest.identifier[]` dengan system `http://sys-ids.kemkes.go.id/referral-number` dan `Specimen.identifier[]` dengan system `http://sys-ids.kemkes.go.id/specimen-acsn` serta tipe ACSN. Pakai nomor itu pada dokumen/sampel. |
| 8–10 | Penerima mencari permintaan dengan `GET /ServiceRequest?identifier={system}%7C{nomor}`. Koleksi juga memberi query daftar order dengan `performer`, `category`, `requester` dan `_lastUpdated`. Cari sampel melalui UUID pada `ServiceRequest.specimen[]` atau accession sesuai contoh. | Pastikan Patient, identifier dan fasyankes tujuan cocok. Lihat [query dan korelasi hasil](../endpoint/skrining-hipotiroid-kongenital.md#query-publik-dan-korelasi-hasil-shk). |
| 11–12 | Penerima `PATCH /Specimen/{id}` untuk penerimaan. Catat status `available`, `unavailable` atau `unsatisfactory`, dan detail penerimaan/kondisi sesuai profil. Buat Encounter penerima ketika skenario mengharuskan. Kelas kunjungan spesimen memakai `referred-procedure` dari `http://terminology.kemkes.go.id/CodeSystem/encounter-class`. | Status dan waktu penerimaan, penilaian spesimen, serta ID Encounter penerima. |
| 13–15 | Penerima membuat `Observation` hasil dan `DiagnosticReport` yang menunjuk Observation, order dan sampel. Finalisasi Encounter penerima melalui `PUT /Encounter/{id}`. | Hasil dan laporan dengan korelasi ke order asal. Baca balik keduanya. |
| 16–17 | Perujuk mencari hasil dan laporan dengan korelasi nomor rujukan, IHS Patient, dan ID Organization fasyankes rujukan sebagaimana Playbook. | Pastikan hubungan balik ke order dan sampel. Query hasil gabungan langsung masih perlu bukti. Gunakan [pencarian katalog yang telah dipublikasikan](../endpoint/skrining-hipotiroid-kongenital.md#query-publik-dan-korelasi-hasil-shk) untuk verifikasi jika scope mengizinkan. |
| 18–25 | Pada tes konfirmasi, gunakan IHS bayi yang sama untuk kunjungan baru, order konfirmasi serta spesimen yang benar. Kirim Observation dan DiagnosticReport dengan kode konfirmasi. Kirim Condition untuk diagnosis ICD-10 yang diketahui, satu diagnosis per resource, kemudian finalisasi Encounter. | Simpan relasi antara skrining awal, paket konfirmasi, keputusan klinis dan Encounter. |

## Error, keamanan, dan uji

- Pastikan status entry Bundle semuanya sesuai, baca balik identifier nasional, dan gunakan ID asli setiap kali melakukan pembaruan. Saat create timeout, cari order/sampel lewat identifier sebelum retry.
- Untuk `400`/`422`, simpan `OperationOutcome.issue[]`, parameter atau path bermasalah, serta Rule Number aktual. Untuk `401`/`403`, uji scope antar-fasyankes. Coba ulang error sementara setelah rekonsiliasi dengan batas yang wajar. [Penanganan error](../validasi/respons-dan-error.md)
- Catat correlation ID, waktu dan status yang disamarkan. Batasi akses ke identitas bayi, ibu, accession klinis, hasil dan diagnosis.

| Skenario | Kriteria lulus |
| --- | --- |
| DBS lintas fasilitas | Kedua pihak berwenang. Order dan sampel terkait, nomor rujukan serta accession terbaca. Penerima mencatat kondisi, hasil dan laporan, lalu perujuk dapat mengakses laporan yang sama. |
| Sampel tidak layak | Status serta alasan penerimaan tersimpan dan kasus dapat diproses sesuai alur pengiriman ulang tanpa mencampur spesimen. |
| Konfirmasi | Order dan hasil serum/plasma memakai kode yang dipilih berdasarkan metode, pemeriksaan merujuk pasien dan Encounter yang benar, dan diagnosis tercatat dari keputusan klinis. |
| Gangguan/konsistensi | Uji duplikasi transaksi, referensi bayi salah, kode tidak cocok spesimen, dan izin antar-organisasi. Kondisi gagal tercatat dan integrasi tidak menggandakan hasil. |

[Status bukti Sandbox](../pengujian/skenario-sandbox.md#status-bukti)
