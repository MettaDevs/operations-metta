# Data kelahiran dan pengajuan akta

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Data Kelahiran](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/data-kelahiran/) (v1.0, rilis 2026-06-26, disunting 2026-09-29)

[Indeks SATUSEHAT](../README.md) · [Alur layanan](README.md) · [Payload dan pemetaan data kelahiran dan akta](../payload/data-kelahiran-dan-akta.md)

Playbook Data Kelahiran v1.0 (26 Juni 2026) mendokumentasikan pencatatan data bayi, persalinan, keluarga, dokumen, dan pengajuan Task akta lahir. Balikan nomor transaksi menandakan pengajuan tercatat pada Task. Simpan nomor akta terbit melalui alur administratif yang disediakan untuk fasyankes. [Playbook Data Kelahiran](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/data-kelahiran/)

## Prasyarat dan urutan

| Bab | Pelaku, input dan operasi | Respons atau hubungan |
| --- | --- | --- |
| 1 | Petugas memastikan data ibu dan bayi melalui MPI. Bila bayi belum memiliki NIK, ikuti registrasi bayi baru lahir dengan data ibu sesuai [MPI](../endpoint/master-data-pasien.md). | Simpan IHS Patient bayi dan ibu secara terpisah. Cocokkan urutan lahir pada kelahiran kembar. |
| 2 | Petugas menyiapkan Encounter persalinan ibu sesuai INC dan konteks pelayanan Neonatus bila digunakan. | Kedua Encounter harus memiliki subjek yang tepat. Simpan ID yang dipakai untuk fakta bayi dan yang dipakai untuk Task akta. |
| 3–4 | Kirim fakta kelahiran yang diperlukan dari INC dan Neonatus melalui `POST /fhir-r4/v1/Observation`. Gunakan hasil klinis yang telah tersedia dan cek ID sebelumnya. | Hubungkan setiap Observation ke Patient ibu atau bayi sesuai pemetaan variabel. Baca ulang untuk memastikan kode dan subjek sesuai. |
| 5 | Isi RelatedPerson untuk ibu, ayah, pelapor dan saksi sesuai fakta. Laporkan tanggal lapor dengan Observation dan dokumen pendukung melalui DocumentReference. | Simpan ID relasi dan dokumen. Konfirmasi metode create dan cakupan baca untuk RelatedPerson dan DocumentReference berdasarkan profil serta koleksi modul ketika akses diaktifkan. |
| 6 | Ajukan `Task` akta melalui create FHIR pada resource Task. Konfirmasi rute dan izin aktual pada akun yang tersedia. Tautkan `for` ke Patient bayi dan `encounter` ke Encounter persalinan ibu. | `Task.id` dan `identifier[].system=http://sys-ids.kemkes.go.id/task/transaction-number`. Nomor transaksi mengikuti pola `TRX-` dengan tanggal dan nomor generator. Simpan bersama status. |

Untuk request FHIR gunakan host sesuai environment, Bearer, dan JSON berdasarkan [Kontrak HTTP FHIR](../endpoint/kontrak-fhir-http.md). Simpan semua ID balikan per environment. Untuk data yang memerlukan role penerbit dan pengelola dokumen, baca profil dan batas akses per Organization. Bila respons create Task hilang, cek catatan pengiriman dan gunakan selector yang dibuktikan sebelumnya untuk menemukan pengajuan yang sudah tercatat. [Bab 6 Task Akta Lahir](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/data-kelahiran/#_6_pengiriman_data_task_akta_lahir)

## Uji, error, dan kontrol akses

| Uji | Kriteria lulus |
| --- | --- |
| Bayi tanpa NIK | Patient bayi memperoleh IHS dengan jalur MPI yang sah. Setelah lookup ulang, informasi ibu dan bayi cocok serta penamaan mengikuti keputusan registrasi. |
| Kelahiran ganda | Setiap bayi mempunyai IHS dan urutan sendiri. Task masing-masing menunjuk bayi yang benar dan Encounter persalinan ibu pada skenario yang sama. |
| Dokumen dan pengajuan | Dokumen serta RelatedPerson dapat dibaca pihak yang berwenang. Task mengembalikan ID dan identifier transaksi yang cocok. Apabila kemudian tersedia bukti akta, rekonsiliasi dengan pengajuan tersebut. |
| Kasus gagal dan duplikat | Uji salah identitas, scope Organization, referensi dokumen gagal, `400`/`422` serta timeout. Lacak `OperationOutcome.issue[]` dan Rule Number aktual. Lakukan rekonsiliasi nomor transaksi sebelum retry. |

Gunakan retry terbatas untuk gangguan sementara setelah mencari pengajuan yang mungkin sudah tersimpan. Buktikan callback atau pembaruan Task hanya setelah mekanismenya diperoleh untuk fasyankes. Dalam log umum, gunakan ID korelasi yang disamarkan. Batasi akses atas NIK, KK, data keluarga, dan lampiran kelahiran. Status endpoint create/baca khusus dan balikan selain nomor transaksi perlu konfirmasi pada Sandbox. [Validasi dan error](../validasi/respons-dan-error.md)
