# Payload dan terminologi imunisasi dan KIPI

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Imunisasi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-new/) (v2.6, rilis 2024-05-27, disunting 2025-10-02) · [Lampiran Terminologi Imunisasi](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/imunisasi-new/) (disunting 2024-08-29) · [Imunisasi COVID-19](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-covid/) (v1.0, rilis 2024-07-15, disunting 2025-10-02)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Imunisasi rutin, riwayat imunisasi, KIPI, dan COVID-19](../alur/imunisasi-dan-kipi.md)

## Payload dan terminologi imunisasi umum

| Elemen | Aturan |
| --- | --- |
| `status`, `statusReason` | `completed` untuk diberikan/riwayat yang sah. `not-done` untuk gagal dilakukan atau ditolak sesuai use case, dengan alasan yang tepat. |
| `vaccineCode.coding[]` | Gunakan produk aktual KFA `93xxxxxx`, KFA CVX Group, dan CVX Name `http://hl7.org/fhir/sid/cvx` sesuai tabel skenario. Dua coding CVX Group dan Name dipakai pada kasus tanpa produk aktual yang tercatat sesuai lampiran. Jangan mengisi produk dari perkiraan. |
| `patient`, `encounter`, `occurrenceDateTime`, `recorded` | Patient IHS dan Encounter ditandai wajib. `occurrenceDateTime` menjelaskan saat pemberian atau penolakan; `recorded` menjelaskan saat dicatat. Gunakan nama wire FHIR `occurrenceDateTime`. |
| `primarySource`, `reportOrigin` | `primarySource=true` untuk pencatatan langsung, penolakan, KIPI pada pemberian yang dicatat, dan skenario kader pada tabel. Untuk laporan kader, origin `provider`. Riwayat dari ingatan dan tertulis memakai `primarySource=false` dengan origin `recall` atau `record`. Gunakan coding origin dari profil. |
| `location`, `lotNumber`, `expirationDate`, `doseQuantity`, `route` | Kirim lokasi dan data vaksin dari fakta. Lot dan kedaluwarsa ditandai wajib untuk pemberian nakes dan pemberian yang disertai KIPI pada tabel. Kuantitas dosis mengikuti satuan UCUM, misalnya `mL`. Tabel terminologi memberi nama `Immunization.valueQuantity`; nama elemen FHIR R4 untuk dosis adalah `doseQuantity`. |
| `performer[].actor`, `performer[].function` | System `http://terminology.hl7.org/CodeSystem/v2-0443`. Pakai `AP` pemberi, `OP` pemesan, `EP` pihak yang mencatat sesuai peran. Skenario nakes memakai referensi Practitioner/Organization sesuai profil, sedangkan kader dan riwayat memakai Organization untuk aktor `EP`. |
| `reasonCode[]`, `protocolApplied[]` | Pilih alasan program dan seri/dosis sesuai lampiran. Tabel contoh menulis dosis 1 untuk DPT-1. Untuk profil R4 gunakan field pilihan `doseNumberPositiveInt` atau tipe yang didukung, dan pertahankan nomor dosis dari tindakan. |
| `reaction[]` | Saat KIPI dicatat, masukkan tanggal, `detail` ke Observation, dan `reported` sesuai sumber. Observation gejala memakai LOINC `31044-1`, kategori `exam`, dan nilai gejala sesuai lampiran. Kondisi kehamilan memakai LOINC `82810-3` dan kategori `survey` pada pemetaan yang relevan. |

[Variasi kasus dan pemetaan field](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-new/#pengiriman-data-imunisasi) · [Lampiran kode imunisasi](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/imunisasi-new/) · [FHIR R4 Immunization](https://hl7.org/fhir/R4/immunization.html)

Contoh request pemberian untuk satu produk Hepatitis B yang tercantum pada lampiran. Produk, nomor dosis, alasan program, lot, waktu dan petugas perlu mengikuti fixture yang dipakai. Tambahkan data lain yang berlaku untuk layanan.

```json
{
  "resourceType": "Immunization",
  "status": "completed",
  "vaccineCode": {"coding": [
    {"system": "http://sys-ids.kemkes.go.id/kfa", "code": "93003730"},
    {"system": "http://sys-ids.kemkes.go.id/kfa", "code": "VG45"},
    {"system": "http://hl7.org/fhir/sid/cvx", "code": "43"}
  ]},
  "patient": {"reference": "Patient/<PATIENT>"},
  "encounter": {"reference": "Encounter/<VISIT>"},
  "occurrenceDateTime": "2026-11-16T02:20:00Z",
  "recorded": "2026-11-16T02:25:00Z",
  "primarySource": true,
  "location": {"reference": "Location/<LOC>"},
  "lotNumber": "LOT-FIXTURE",
  "expirationDate": "2027-04-01",
  "performer": [{
    "function": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v2-0443", "code": "AP"}]},
    "actor": {"reference": "Practitioner/<PEMBERI>"}
  }],
  "protocolApplied": [{"doseNumberPositiveInt": 1}]
}
```

## Imunisasi COVID-19 dan Q0015

`QuestionnaireResponse.questionnaire` memakai `https://fhir.kemkes.go.id/Questionnaire/Q0015`. Pastikan Encounter, Patient, pelaku dan waktu konsisten. Gunakan `item[]` per grup dan `item[].item[]` untuk anak, termasuk `3.8.1` pada cabang pertanyaan kehamilan. Pada skenario penundaan atau tidak diberikan, gunakan satu keputusan yang konsisten antara Q0015 dan Immunization `not-done` dengan alasan. Pada pemberian, coding KFA group mencakup `VG213` dan coding produk/nama mengikuti lampiran COVID-19. Bab 8 dan 10 sama-sama menjelaskan gejala KIPI melalui Observation; catat reaksi berdasarkan kejadian, hindari duplikasi. [Playbook COVID-19 bab 3–10](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/imunisasi-covid/#_3_pengiriman_data_penentuan_verifikasi_identitas) · [Lampiran COVID-19](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/imunisasi-covid/)

| Grup linkId | Fakta |
| --- | --- |
| `1` | Verifikasi identitas. Anak `1.1` dosis terakhir, `1.2` waktu vaksinasi terakhir. |
| `2` | Penentuan sasaran. `2.1` usia, `2.2` hamil, `2.3` tenaga kesehatan, `2.4` komorbid, `2.5` immunocompromised, `2.6` kategori. Kelompok komorbid dapat memiliki beberapa jawaban sesuai lampiran. |
| `3` | Skrining. `3.1` kondisi hari ini, `3.2–3.4` suhu dan tekanan darah dengan Observation sesuai profil, `3.5` alergi berat, `3.6` autoimun, `3.7` riwayat COVID-19, `3.8` hamil dan anak `3.8.1` bila berlaku, `3.9` keputusan skrining. |
| `4` | Hasil layanan. Isi hasil sesuai skenario dan cocokkan dengan Immunization. |
| `5` | Hasil pemantauan dengan nilai dari SNOMED CT `248264000` atau `105721009` sesuai fakta sumber. Anak `5.1` memuat keluhan jika ada. |

Untuk `statusReason.coding` pada COVID-19, katalog lampiran memberi `IS000001` untuk penundaan dan `IS000002` untuk tidak diberikan, dengan system `http://terminology.kemkes.go.id/CodeSystem/immunization-statusReason`. Alasan `IMMUNE`, `MEDPREC`, `OSTOCK` dan `PATOBJ` berasal dari `http://terminology.hl7.org/CodeSystem/v3-ActReason`. Tabel sumber menyisipkan spasi pada URI HL7. Gunakan URI kanonis dan cocokkan hasil uji dengan koleksi modul. [Alasan COVID-19](https://satusehat.kemkes.go.id/platform/docs/id/terminology/lampiran-terminologi/imunisasi-covid/#lampiran-5-covid) · [HL7 v3 ActReason](https://terminology.hl7.org/CodeSystem-v3-ActReason.html)

Potongan hasil baca balik saat vaksinasi COVID-19 ditunda. Simpan alasan yang sebenarnya dikembalikan atau dikirim.

```json
{
  "resourceType": "Immunization",
  "id": "<ID_IMUNISASI>",
  "status": "not-done",
  "statusReason": {"coding": [{"system": "http://terminology.kemkes.go.id/CodeSystem/immunization-statusReason", "code": "IS000001"}]},
  "patient": {"reference": "Patient/<PATIENT>"},
  "encounter": {"reference": "Encounter/<VISIT>"}
}
```
