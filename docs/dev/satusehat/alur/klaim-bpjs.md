# Klaim BPJS Kesehatan dan E-Klaim

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Pembiayaan Kesehatan Klaim BPJS Kesehatan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/klaim-bpjs/) (v1.3, rilis 2025-08-20, disunting 2026-09-10) · [Lampiran Terminologi Pembiayaan Kesehatan Klaim BPJS Kesehatan](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/klaim-bpjs/) (disunting 2025-01-30)

[Indeks SATUSEHAT](../README.md) · [Alur layanan](README.md) · [Payload dan terminologi klaim BPJS](../payload/klaim-bpjs.md)

Panduan ini mengikuti buku publik v2.0 (24 Agustus 2026) dan menjelaskan tanggung jawab fasyankes, BPJS Kesehatan dan E-Klaim. Portal publik menandai modul tersedia di Sandbox selama pengembangan. Fasyankes memakai data kepesertaan yang diterbitkan BPJS Kesehatan dan mengirim SEP, RME, serta tagihan sesuai perannya. E-Klaim memvalidasi RME berdasarkan Encounter dan menyerahkan berkas klaim bertanda tangan ke BPJS Kesehatan, yang kemudian melakukan purifikasi dan verifikasi. [Playbook BPJS Kesehatan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/klaim-bpjs/) · [Buku publik BPJS v2.0](https://drive.google.com/file/d/1uavv0iKT-UPnyRkfO9nIMdRRL-X_wqQ0/preview)

[Prasyarat dan sumber Metta](#prasyarat-dan-sumber-metta) · [Alur dan operasi](#alur-dan-operasi) · [Error, ulang kirim, dan rekonsiliasi](#error-ulang-kirim-dan-rekonsiliasi) · [Penerimaan Sandbox atau lingkungan sertifikasi](#penerimaan-sandbox-atau-lingkungan-sertifikasi)

## Prasyarat dan sumber Metta

| Data/prasyarat | Bukti dan gap |
| --- | --- |
| Organization dan Location fasilitas, IHS pasien dan nakes, kredensial per lingkungan | Empat identitas pernah diuji untuk flow rawat jalan. Untuk klaim, siapkan akses fasyankes, V-Klaim dan E-Klaim serta IHS Organization penjamin. Akses transaksi klaim Metta belum diuji. [Orientasi](../endpoint/onboarding-fhir.md) |
| Peserta dan penjamin | Cara bayar pasien dan aturan wajib penjamin/nomor kartu tersimpan. Penjamin terkait party organisasi, dan tipe pasien mempunyai opsi `kode_satusehat` untuk `Coverage.type`. Hubungkan penjamin lokal ke Organization dan Coverage nasional, lalu catat SEP aktual dari V-Klaim. [Penjamin di Metta](../../../../modules/healthcare/README.md#penjamin) |
| Kunjungan, dokter, diagnosis dan tindakan | Data klinis dan tarif tindakan berasal dari pemeriksaan. Sumber ID SATUSEHAT dan pencatatan ID per aplikasi pengklaim masih perlu integrasi. [Rekam medis Metta](../../../../modules/healthcare/README.md#rekam-medis-pemeriksaan) |
| Tagihan dan rekonsiliasi | Tarif tindakan dan komponennya dicatat sebagai snapshot saat simpan. Event `healthcare.examination.charges-replaced.v1` mengganti potret biaya di kasir. Gunakan nilai yang sudah difinalisasi untuk klaim. Perlu pemetaan baris biaya ke ChargeItem, rekening pada Account, Invoice, serta nomor klaim dan hasil penjamin. [Biaya tindakan dan E-Resep](../../../../modules/healthcare/README.md#biaya-tindakan-dan-e-resep) |

## Alur dan operasi

Endpoint FHIR relatif terhadap `/fhir-r4/v1`, dengan OAuth Bearer dan JSON FHIR. Operasi yang khusus untuk peran klaim perlu akses modul sesuai lingkungan. Buku publik menguraikan data teknis tahap 1–8. Untuk alur E-Klaim, PurificationDecision dan callback BPJS, narasi dan diagram menjelaskan peran. Path, keamanan callback, struktur pesan, status HTTP dan body spesifik tahap itu perlu kontrak teknis yang diberikan saat onboarding. [Buku BPJS v2.0, bab C](https://drive.google.com/file/d/1uavv0iKT-UPnyRkfO9nIMdRRL-X_wqQ0/preview) · [Kontrak HTTP FHIR](../endpoint/kontrak-fhir-http.md)

| Tahap dan pelaku | Request | Hasil yang disimpan |
| --- | --- | --- |
| 1. BPJS Kesehatan menerbitkan kepesertaan | `POST /Coverage` pada peran penjamin. Pembaruan dengan `PUT` atau `PATCH` sesuai perubahan yang didukung. | ID Coverage. Verifikasi subjek, nomor kartu, Organization penjamin, kepesertaan dan periode. |
| 2. Fasyankes mencari peserta | `GET /Coverage` dengan pasien IHS dan identifier system `https://sys-ids.kemkes.go.id/insurance-subscriber/{organization-bpjs}` sesuai contoh modul. Gunakan format token `system%7Cvalue` apabila mengirim kartu. | Bundle pencarian. Cocokkan beneficiary, payor, nomor kartu dan masa berlaku. Simpan satu Coverage yang dipakai untuk tagihan terkait. |
| 3. Fasyankes melaporkan eligibilitas | `POST /CoverageEligibilityRequest` membawa QuestionnaireResponse Q0006 sebagai `contained` untuk variabel SEP. Fasyankes melaporkan hasil V-Klaim dengan `POST /CoverageEligibilityResponse` yang menunjuk request dan Coverage. | Simpan ID kedua resource dan SEP. SEP berada pada `CoverageEligibilityResponse.identifier[]` dengan system `http://sys-ids.kemkes.go.id/jkn-claim-number`. Webhook dapat memberitahukan hasil sesuai akses modul. |
| 4–5. Fasyankes membuat kunjungan dan akun | Buat Encounter sesuai pintu masuk. `POST /Account` lalu `PATCH /Encounter/{id}` untuk menautkan `account[]` ke Account. | Simpan Encounter ID, Account ID dan rujukan Coverage. Baca ulang relasi paling lambat sebelum validasi RME. |
| 6. Fasyankes mengirim RME | Buat resource klinis sesuai Rawat Jalan, IGD, Rawat Inap atau use case. Kaitkan Patient, Encounter, penulis dan konteks semua resource. | Simpan ID RME dan pastikan subjek dan Encounter cocok. Data ini menjadi dasar validasi klaim. |
| 7–8. Fasyankes mengirim tagihan | Setelah layanan terlaksana, `POST /ChargeItem` per fakta tarif terkait. Setelah selesai layanan, `POST /Invoice` dengan akun dan referensi ChargeItem. | Simpan ID baris dan invoice. Cocokkan mata uang, jumlah, harga dan total dengan kasir. |
| 9. Fasyankes mengajukan ke E-Klaim | Panggil API E-Klaim melalui kanal mitra. Validasi RME menggunakan Encounter ID SATUSEHAT. E-Klaim membentuk `Claim` dan data pendukung RME pada Bundle dengan signature untuk BPJS Kesehatan. | Simpan nomor pengajuan dan korelasi Encounter, SEP dan Invoice. Konfirmasi URL, envelope request, metode validasi dan kepemilikan sertifikat dengan Juknis E-Klaim/V-Klaim yang berlaku untuk fasilitas. |
| 10. BPJS Kesehatan dan fasyankes menangani hasil | BPJS Kesehatan menghasilkan `ClaimResponse` purifikasi/verifikasi. Fasyankes memproses webhook dan tindak lanjut purifikasi melalui `PurificationDecision` non-FHIR. | Simpan fase proses, referensi klaim, kode keputusan dan excess jika ada. Excess muncul pada `ClaimResponse.item[].adjudication[].category` dengan kode `copay` dalam narasi modul. |

## Error, ulang kirim, dan rekonsiliasi

- Pencarian sukses bisa memberi `Bundle.total=0`. Tampilkan hasil pencarian peserta kosong dan periksa Organization, identifier dan kondisi kepesertaan. Simpan ID resource dari create serta korelasi kartu/SEP dalam penyimpanan akses terbatas.
- Kelompokkan error FHIR menurut HTTP dan `OperationOutcome.issue[]`. Cek token dan izin untuk `401`/`403`, payload/terminologi untuk `400`/`422`, referensi untuk `404`, serta respons jaringan/transien untuk `429`/`5xx`. Severity, code dan Rule Number aktual harus masuk bukti bila tersedia.
- Untuk timeout create, cari resource memakai identifier yang didukung dan catatan pengiriman. Rekonsiliasi Account/Encounter dan Invoice sebelum mengulang. Terapkan retry terbatas untuk gangguan sementara. Hasil pending, purifikasi, verifikasi, dan penolakan menjadi status bisnis yang dapat ditindaklanjuti.
- Verifikasi webhook berasal dari kanal terdaftar dan korelasikan dengan SEP/Claim serta fase. Callback ganda diproses terhadap record yang sama. Batasi akses berkas klaim dan log. Hindari menyimpan kartu, NIK, SEP mentah, payload medis dan signature di log umum. [Validasi dan error](../validasi/respons-dan-error.md)

## Penerimaan Sandbox atau lingkungan sertifikasi

| Uji | Kriteria lulus |
| --- | --- |
| Kepesertaan dan SEP | Coverage fixture menghasilkan kecocokan Patient dan BPJS. Request dan response tertaut, termasuk koding Q0006 serta SEP yang direkonsiliasi dengan hasil V-Klaim yang sah. |
| RME dan tagihan | Encounter menautkan Account, Account menautkan Coverage. ChargeItem dan Invoice dapat dibaca balik, nominal per item dan total cocok dengan bukti kasir. |
| Pengajuan dan hasil | E-Klaim memvalidasi Encounter, mengembalikan korelasi pengajuan, dan tim menerima hasil purifikasi serta verifikasi pada peran yang tepat. Uji koreksi/purifikasi dan excess. |
| Gangguan | Uji Coverage yang tidak cocok, tagihan belum siap, penanda tangan atau organisasi tidak sah, callback duplikat, serta waktu habis setelah pembentukan Invoice. Bukti melacak keputusan dan menjaga satu pengajuan efektif untuk satu transaksi. |

Flow klaim BPJS Metta belum diuji. Bukti Encounter rawat jalan awal sudah tersedia sebagai prasyarat. [Bukti Sandbox](../pengujian/skenario-sandbox.md#status-bukti)
