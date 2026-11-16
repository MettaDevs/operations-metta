# HIV, kajian risiko dan pemeriksaan penunjang

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Human Immunodeficiency Virus (HIV)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/hiv/) (v1.0, rilis 2024-08-10, disunting 2024-12-08) · [EpisodeOfCare](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/episode-of-care/) (disunting 2023-09-27)

[Indeks SATUSEHAT](../README.md) · [Alur layanan](README.md)

Halaman publik HIV menampilkan v1.0 (10 Agustus 2024) dan menunjuk buku publik v1.3 (15 Agustus 2024). Panduan internal mengikuti buku yang ditautkan. Portal menandai modul HIV tersedia di Sandbox selama pengembangan. Alur yang terbit berfokus pada asesmen, EpisodeOfCare terduga, pemeriksaan, diagnosis dan tindak lanjut. [Halaman HIV](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/hiv/) · [Buku HIV v1.3](https://drive.google.com/file/d/1pALbwPhb68fql_pC4j8PstfQ2TKPVc5u/preview)

[Prasyarat dan data Metta](#prasyarat-dan-data-metta) · [Bab 1–10 dan dependensi](#bab-110-dan-dependensi) · [Episode dan QuestionnaireResponse](#episode-dan-questionnaireresponse) · [Order, sampel, dan hasil](#order-sampel-dan-hasil) · [Error, privasi dan verifikasi](#error-privasi-dan-verifikasi)

## Prasyarat dan data Metta

Siapkan Patient IHS, Organization, Location, Practitioner, serta akun dengan akses program dan data yang digunakan. Operations Metta punya registrasi, rekam medis, hasil pemeriksaan umum, diagnosis dan riwayat klinis. Data program yang masih perlu sumber terstruktur meliputi identitas episode, suspect-id, respons Q0023, klasifikasi risiko, riwayat tes, hasil tiap metode dan rencana tindak lanjut. Pastikan pencatatan ibu hamil/anak menggunakan pasien yang tepat dan keterkaitan pemeriksaan tidak hilang. [Registrasi Metta](../../../../modules/healthcare/README.md#pendaftaran-kunjungan) · [Rekam medis Metta](../../../../modules/healthcare/README.md#rekam-medis-pemeriksaan)

## Bab 1–10 dan dependensi

| Bab | Tahap dan operasi | Respons atau korelasi |
| --- | --- | --- |
| 1–2 | Resolve Patient melalui MPI, laporkan fakta sosial/demografi yang diminta modul, buat Encounter sesuai pintu masuk. | IHS pasien, ID Encounter, penanggung jawab dan lokasi. |
| 3 | Ketika kriteria terduga HIV dinyatakan sesuai alur modul, `POST /EpisodeOfCare` sekali dengan tipe `HIV` dan status `waitlist`. Tambahkan `Encounter.episodeOfCare[].reference` ke episode. | ID episode dan nomor surveilans `suspect-id` dari balikan. Simpan ID dan identifier yang benar-benar diterima. |
| 4 | Kirim Condition, AllergyIntolerance, MedicationStatement dan Observation untuk anamnesis, pemeriksaan dan variabel risiko. `POST /QuestionnaireResponse` Q0023 setelah Observation yang dipakai sebagai jawaban tersedia. | ID tiap fakta, Q0023, dan hubungan ke pasien/Encounter. |
| 5 | Kirim ServiceRequest, Specimen, Observation hasil dan DiagnosticReport. Bedakan jalur serologi tunggal dan panel, PCR DNA/EID, PCR RNA dan pemeriksaan sifilis. | Hubungkan order, sampel, hasil dan laporan. Baca balik hasil serta kesimpulan yang dilaporkan. |
| 6 | Kirim Condition untuk satu diagnosis yang tercatat pada tiap payload dengan ICD-10 sesuai profil. | Simpan ID Condition, status dan kode diagnosis. |
| 7–9 | Catat rencana melalui ServiceRequest serta kondisi dan cara keluar sesuai profil pintu masuk. | Simpan keputusan tindak lanjut, Condition dan discharge disposition sesuai fakta. |
| 10 | Finalisasi `PUT /Encounter/{id}`. | Baca ulang Encounter dengan ID yang sama serta periode dan rujukan final. |

Path singkat relatif terhadap `/fhir-r4/v1`. Gunakan Bearer, host sesuai lingkungan, serta JSON FHIR atau format patch sesuai [Kontrak HTTP](../endpoint/kontrak-fhir-http.md). Pencarian EpisodeOfCare generik mendokumentasikan `subject`; buku HIV menyebut pasien, `type`, `status` dan opsional Organization. Buktikan selector program; gunakan ID yang telah disimpan atau cocokkan hasil pencarian pasien dengan tipe, status, periode dan pengelola yang diizinkan. [Katalog HTTP](../endpoint/inventaris-operasi-http.md) · [Katalog EpisodeOfCare](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/episode-of-care/)

## Episode dan QuestionnaireResponse

- EpisodeOfCare memakai `status`, `type`, `patient`, `managingOrganization`, `period` yang ditandai wajib pada buku, serta histori ketika berlaku. Identifier lokal `http://sys-ids.kemkes.go.id/episode-of-care/{organization-id}`. Tipe memakai `HIV` dari `http://terminology.kemkes.go.id`. Bab 3 menyebut HIV sebagai konteks episode; satu kalimat tertulis TB di tengah pembahasan HIV. Gunakan pemicu HIV dari judul bab serta pemetaan, dan catat keputusan klinis yang sah.
- Deskripsi `period.end` memuat kasus `cancelled` saat pasien terkonfirmasi bukan HIV. Buku ini kurang rinci untuk semua transisi episode, register konfirmasi, dan seluruh perawatan longitudinal. Konfirmasi payload pembaruan, status transisi dan izin operasinya sebelum membuat flow pengobatan yang lebih luas.
- Q0023 memakai `https://fhir.kemkes.go.id/Questionnaire/Q0023`. Kelompok `1` memuat kajian risiko; `2` memuat tanda klinis IMS dan pemeriksaan fisik. `1.1` kelompok populasi mengarah ke Observation kategori `survey`, kode `TK000034` dari `http://terminology.kemkes.go.id` dengan komponen boolean sesuai tabel. Baris buku menukar posisi system dan code pada variabel ini. Gunakan struktur Coding yang benar dan cocokkan hasil uji. `1.2–1.7` memuat pajanan seksual, alat suntik, transfusi, transmisi ibu-anak dan periode jendela. `1.8` penyakit terkait, `1.9`/ `1.9.1` risiko lain. `2.1` dan `2.1.1` tanda IMS dengan cabang kondisional, `2.2` pemeriksaan fisik. Pertahankan `valueReference` atau nesting per butir sesuai sumber, khususnya bila Observation disimpan terpisah. [Buku HIV, bab 3–4](https://drive.google.com/file/d/1pALbwPhb68fql_pC4j8PstfQ2TKPVc5u/preview)

Contoh request episode terduga menggunakan fixture dan organisasi yang wajar untuk pengujian.

```json
{
  "resourceType": "EpisodeOfCare",
  "status": "waitlist",
  "type": [{"coding": [{"system": "http://terminology.kemkes.go.id", "code": "HIV"}]}],
  "patient": {"reference": "Patient/<PATIENT>"},
  "managingOrganization": {"reference": "Organization/<ORGANIZATION>"},
  "period": {"start": "2026-11-16"}
}
```

## Order, sampel, dan hasil

| Bagian | Pemetaan |
| --- | --- |
| ServiceRequest | Isi identifier order, status, intent, category SNOMED CT `108252007` untuk lab pada tabel, kode metode/panel, `reasonCode[]` dari lampiran, Patient, Encounter, `requester` dan `performer[]` Organization lab sesuai profil. |
| Specimen | Isi jenis, ID lokal, pasien, tautan order, waktu pengambilan, `condition[]`, `status`, serta `processing[].timeDateTime` bila dicatat. Dalam FHIR R4, `Specimen.status` adalah code. Buku menulis `Specimen.status.coding` pada tabel kondisi; verifikasi contoh payload aktual. |
| Observation | Hasil terhubung ke Patient, Encounter, sampel dan order. Terapkan satu `value[x]` dan terminologi menurut metode. Simpan fakta pengulangan dan hubungan panel. Untuk PCR RNA, contoh kode jumlah viral load mencakup `59419-2` dan `86548-5`; `29539-4` untuk hasil log sesuai metodenya. |
| DiagnosticReport | Simpan `status`, `code`, `subject`, `encounter`, `basedOn[]`, `specimen[]`, `result[]`, waktu, performer dan `conclusionCode[]`. Jalur panel mencakup `X099419` tes diagnostik HIV dan `X099420` HIV + sifilis dari terminologi panel. Kesimpulan HIV memakai LOINC `LA6577-6` negatif, `LA6576-8` positif, `LA9663-1` inkonklusif sesuai hasil lab yang disahkan. |

Buku merinci bahwa R1 nonreaktif memakai kode LOINC tunggal pada order/hasil/laporan. Bila protokol laboratorium menghasilkan panel, catat rangkaian R1, R2, R3 dan ulangan yang benar-benar dilakukan pada panel sesuai pemetaan. Jangan menetapkan kesimpulan dari satu flag secara otomatis. PCR DNA/EID antara lain memakai LOINC `44871-2` atau `25841-8` sesuai spesimen/metode. Sifilis/TPHA mencakup `8041-6`, `22587-0`, `5393-4`; titer RPR `31147-2` memakai `valueRatio`. [Buku HIV, bab 5 dan lampiran 8–11](https://drive.google.com/file/d/1pALbwPhb68fql_pC4j8PstfQ2TKPVc5u/preview) · [Kontrak Lab](laboratorium-rujukan-spesimen.md)

Contoh bagian balikan laporan panel dengan kesimpulan yang tercatat. Kode panel dan status harus cocok dengan order dan hasil aktual.

```json
{
  "resourceType": "DiagnosticReport",
  "id": "<LAPORAN>",
  "status": "final",
  "code": {"coding": [{"system": "http://terminology.kemkes.go.id/CodeSystem/examination", "code": "X099419"}]},
  "basedOn": [{"reference": "ServiceRequest/<ORDER>"}],
  "subject": {"reference": "Patient/<PATIENT>"},
  "encounter": {"reference": "Encounter/<VISIT>"},
  "specimen": [{"reference": "Specimen/<SPECIMEN>"}],
  "result": [{"reference": "Observation/<HASIL_PANEL>"}],
  "conclusionCode": [{"coding": [{"system": "http://loinc.org", "code": "LA9663-1"}]}]
}
```

## Error, privasi dan verifikasi

Pada kegagalan validasi `400`/`422` simpan `OperationOutcome.issue[]`, kode aturan, dan path yang telah disamarkan. Untuk `401`/`403` periksa token, role dan Organization. Pada respons hilang, cari ID/identifier order, episode, panel atau hasil yang sudah dikirim, lalu retry terbatas bila sementara. Log umum hanya berisi waktu operasi, status dan korelasi fixture. Batasi akses ke data risiko seksual, status HIV, kode surveilans, demografi dan panel lengkap. [Validasi dan error](../validasi/respons-dan-error.md)

Uji dua kunjungan yang menunjuk satu episode, Q0023 dengan `valueReference`, serologi tunggal, panel dengan hasil ikutan atau inkonklusif, PCR dan baca balik order/hasil. Lulus jika pasien, sampel, EpisodeOfCare, hasil dan laporan konsisten, dan akses lintas organisasi hanya mengikuti izin yang diperoleh. Variasi retry perlu menghasilkan satu laporan per pemeriksaan. Bukti Sandbox program dan selector spesifik HIV masih terbuka. [Bukti Sandbox](../pengujian/skenario-sandbox.md#status-bukti)
