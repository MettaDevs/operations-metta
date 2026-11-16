# Aturan field dan kardinalitas FHIR

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Selamat Datang](https://satusehat.kemkes.go.id/platform/docs/id/playbook/) (disunting 2025-07-23) · [Resume Medis - Rawat Jalan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/) (v7.0, rilis 2026-01-10, disunting 2026-08-04) · [Interoperabilitas](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/) (disunting 2026-11-06)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md)

## Cara membaca matriks

Matriks ini diperiksa terhadap Playbook Rawat Jalan v7.0 dan skema `operations-metta`. Nama field di setiap tabel relatif terhadap resource pada judulnya. Beberapa field ditulis satu baris jika berbagi aturan dan sumber. Kolom celah membedakan data yang sudah tersimpan, data yang masih perlu pemetaan, dan data yang belum punya sumber yang terverifikasi. Data yang tersimpan belum berarti payload diterima SATUSEHAT.

| Label | Cara membaca |
| --- | --- |
| **W** | Wajib dalam payload untuk skenario pada bagian itu, berdasarkan penanda atau ketentuan eksplisit di profil/Playbook. Seluruh resource tetap mengikuti kondisi layanan benar-benar terjadi. |
| **K** | Kondisional. Kirim saat kondisi atau tahap yang disebut berlaku. Anak yang wajib di dalam kelompok opsional berlaku jika kelompok itu dikirim. |
| **P** | Perlu dikonfirmasi. Field ada dalam pemetaan, tetapi kewajibannya berbeda antar tahap, bergantung use case, atau belum jelas dari sumber yang diperiksa. Periksa profil dan uji Sandbox sebelum menetapkan validasi pengiriman. |
| **O** | Opsional untuk skenario yang dicatat. Kirim bila ada fakta yang sah dan pemetaan sudah ditetapkan. |

`resourceType` wajib untuk setiap payload JSON FHIR. `id` dalam referensi adalah ID SATUSEHAT. `id` pada body pembaruan mengikuti endpoint. Jangan mengisi field klinis kosong dengan nilai buatan. Tanda bintang pada Playbook tidak berarti semua resource pada semua alur harus dibuat. Matriks mencatat field bertanda wajib dan field kondisional penting untuk alur yang dibahas. Profil resmi tetap menjadi acuan untuk field tambahan, kardinalitas, terminologi, dan validasi. [Playbook Rawat Jalan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/) · [Katalog resource SATUSEHAT](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/)

## Kardinalitas yang memengaruhi payload

Kardinalitas dasar FHIR R4 menjelaskan bentuk payload. Profil dan use case SATUSEHAT menentukan apakah field tersebut wajib untuk skenario tertentu. Notasi `0..1` berarti boleh kosong atau satu, `1..1` berarti tepat satu dan `0..*` berarti bisa berulang. Gunakan nama property yang sesuai untuk field pilihan seperti `value[x]` dan `answer.value[x]`.

| Field | Bentuk FHIR R4 | Aturan saat membentuk payload |
| --- | --- | --- |
| Encounter `status`, `class` | Masing-masing `1..1` | Kirim status aktual dan kelas rawat jalan `AMB` pada fixture ini. |
| Encounter `subject`, `serviceProvider` | Masing-masing `0..1` | Matriks rawat jalan menetapkan Patient dan Organization untuk skenario ini. |
| Encounter `identifier`, `participant`, `location`, `statusHistory`, `diagnosis` | Daftar `0..*` | Pertahankan identifier per NoReg. Peserta, lokasi, dan histori hanya berasal dari fakta yang tercatat. Tambahkan diagnosis yang berlaku saat finalisasi. Setiap item statusHistory memuat status dan periode. |
| Composition `author`, `section` | Author `1..*`, section `0..*` | Resume memakai penulis yang berwenang dan section sesuai profil. Subsection dan referensi `entry` berbentuk daftar. |
| MedicationRequest `medication[x]` | `1..1` | Untuk pola `contained` pada contoh, gunakan `medicationReference` yang menunjuk `#id` Medication di payload yang sama. |
| QuestionnaireResponse `item`, `item.item`, `item.answer` | Daftar `0..*`. `linkId` satu per item | Susun jawaban berdasarkan grup dan `linkId` Q0007. Gunakan tipe jawaban yang ditentukan tiap pertanyaan. |

[FHIR R4 Encounter](https://hl7.org/fhir/R4/encounter.html) · [FHIR R4 Composition](https://hl7.org/fhir/R4/composition.html) · [FHIR R4 MedicationRequest](https://hl7.org/fhir/R4/medicationrequest.html) · [FHIR R4 QuestionnaireResponse](https://hl7.org/fhir/R4/questionnaireresponse.html) · [Matriks Metta per bab](../referensi/cakupan-rawat-jalan-dan-ssrme.md#cakupan-bab-playbook-rawat-jalan)
