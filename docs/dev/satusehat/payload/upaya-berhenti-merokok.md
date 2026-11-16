# Payload dan terminologi upaya berhenti merokok

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Upaya Berhenti Merokok (UBM)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/ubm/) (v1.1, rilis 2025-06-17, disunting 2026-09-10)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Upaya Berhenti Merokok (UBM)](../alur/upaya-berhenti-merokok.md)

## Field dan terminologi

| Resource | Pemetaan |
| --- | --- |
| Encounter | `class` memakai `http://terminology.hl7.org/CodeSystem/v3-ActCode` dengan `AMB` tatap muka di klinik, `VR` telepon, `HH` kunjungan rumah, `FLD` lapangan. Untuk AMB, buku meminta extension service class pada lokasi. `hospitalization.admitSource` mencatat rujukan eksternal/internal, Posyandu, Quitline, datang sendiri atau Brief Advice sesuai lampiran. Brief Advice memakai SNOMED CT `225323000`. |
| Observation CO | `code=93045-3` dari LOINC, hasil kuantitatif dengan `valueQuantity` `[ppm]` dari `http://unitsofmeasure.org`. Gunakan interpretasi dan metode sesuai buku, serta waktu dan Patient/Encounter yang benar. |
| Pemeriksaan kotinin | `ServiceRequest.code`, Observation dan laporan LOINC `12293-7` menurut buku. Specimen urine SNOMED CT `122575003`, metode pengambilan `57617002`. Observation memakai LOINC `LA6576-8` atau `LA6577-6` sesuai hasil. |
| Goal | `description.coding` SNOMED CT `160617001`; kategori `behavioral` dari `http://terminology.hl7.org/CodeSystem/goal-category`. Isi `lifecycleStatus`, `achievementStatus`, subjek serta target/waktu sesuai keputusan. |
| CarePlan | `category[]` SNOMED CT `710081004` dan `program-intensif`/ `program-lanjutan` dari `http://terminology.kemkes.go.id`. Ketika pasien menyetujui program intensif, buku memetakan `active`. Status `completed` atau `revoked` diterapkan sesuai ketentuan tahap. Simpan `subject`, `encounter`, `goal[]`, `activity[]`, dan fase. |
| ServiceRequest tindak lanjut | Kategori SNOMED CT `3457005`, code `185389009`, detail SNOMED CT `1290027009` untuk konseling berhenti merokok dan kode fase Kemenkes `program-intensif` atau `program-lanjutan`. Tanggal rencana memakai `occurrenceDateTime` jika berlaku. |

[Buku UBM, bab 2 dan 4–10](https://drive.google.com/file/d/1DIzkdl8Oo6cm45CfBbAO1kn9q-4pApqE/preview)

### Kuesioner program

Canonical memakai `https://fhir.kemkes.go.id/Questionnaire/`. Simpan `status`, Patient, Encounter, author dan waktu. Gunakan `item[].item[]` untuk anak dan `answer[].item[]` untuk cabang yang tergantung jawaban sesuai template program. Cocokkan `valueBoolean`, `valueCoding`, `valueQuantity`, atau reference dengan hasil yang dikumpulkan. [Buku UBM, bab 3.3–3.5](https://drive.google.com/file/d/1DIzkdl8Oo6cm45CfBbAO1kn9q-4pApqE/preview)

| Instrumen | Cakupan dan korelasi |
| --- | --- |
| `Q0029` | Konseling awal. Isian mencakup percobaan sebelumnya, metode dan hambatan, kesiapan/motivasi. Kelompok `2` memuat riwayat berhenti dan `3` kesiapan/motivasi. `3.3` punya cabang alasan siap dan belum siap. |
| `Q0030` | Program intensif. Kelompok `1` status saat ini, gejala, catatan, penilaian CO/kotinin, kemajuan; kelompok `2` dan `3` memuat keputusan dan penggunaan obat sesuai kesepakatan awal serta jawaban kondisional. |
| `Q0031` | Program lanjutan. Kelompok `1` memantau status, gejala, evaluasi dan pemeriksaan, kelompok `2` terkait terapi. Tambahkan jalur kembali merokok atau tidak sesuai skema buku, serta hanya fakta dari sesi yang sedang dicatat. |

Contoh request potongan ServiceRequest untuk follow-up program intensif. Pertahankan definisi tanggal dan role berdasarkan data fixture.

```json
{
  "resourceType": "ServiceRequest",
  "status": "active",
  "intent": "order",
  "category": [{"coding": [{"system": "http://snomed.info/sct", "code": "3457005"}]}],
  "code": {"coding": [{"system": "http://snomed.info/sct", "code": "185389009"}]},
  "orderDetail": [
    {"coding": [{"system": "http://snomed.info/sct", "code": "1290027009"}]},
    {"coding": [{"system": "http://terminology.kemkes.go.id", "code": "program-intensif"}]}
  ],
  "subject": {"reference": "Patient/<PATIENT>"},
  "encounter": {"reference": "Encounter/<KONSELING_AWAL>"},
  "occurrenceDateTime": "2026-11-23T02:00:00Z"
}
```

Potongan respons baca balik kunjungan intensif yang sudah menautkan order.

```json
{
  "resourceType": "Encounter",
  "id": "<KONSELING_INTENSIF>",
  "status": "finished",
  "class": {"system": "http://terminology.hl7.org/CodeSystem/v3-ActCode", "code": "VR"},
  "subject": {"reference": "Patient/<PATIENT>"},
  "basedOn": [{"reference": "ServiceRequest/<ORDER_KONSELING>"}]
}
```
