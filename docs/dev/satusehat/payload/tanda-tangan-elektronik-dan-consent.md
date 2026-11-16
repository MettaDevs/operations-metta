# Payload tanda tangan elektronik dan FHIR Consent

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Tanda Tangan Elektronik (TTE)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tanda-tangan-elektronik/) (v1.1, rilis 2026-10-19, disunting 2026-10-30) · [Task](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/task/) (disunting 2026-10-30) · [Provenance](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/provenance/) (disunting 2026-10-30)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Tanda tangan elektronik dan FHIR Consent](../alur/tanda-tangan-elektronik-dan-consent.md) · [Endpoint dan respons tanda tangan elektronik](../endpoint/tanda-tangan-elektronik.md)

## Matriks TTE

| Resource | Field yang dikirim | Sumber Metta dan gap |
| --- | --- | --- |
| Resource target | Isi skema klinisnya dan simpan ID. Untuk resume, `Composition` mereferensikan Patient, Encounter, author dan section medis. Untuk formulir persetujuan, petakan jenis, teks formulir dan Consent terkait sesuai Playbook. | Bangun referensi dari hasil klinis yang telah disahkan serta tautkan ke versi dokumen yang ditampilkan. |
| Task | `status` dan `intent` wajib pada profil. `encounter` wajib untuk alur umum. `code.coding.system=http://terminology.kemkes.go.id`, code `electronic-sign-doc`. Untuk bulk di luar fasyankes tanpa hubungan langsung ke satu kunjungan, code `electronic-sign-doc-out` mengizinkan Encounter kosong. Hubungkan `requester`, `owner` dan `for` sesuai penanda tangan dan modul. | Perlu fakta siapa meminta, siapa berhak tanda tangan, dokumen yang ditarget dan kapan. Cek nilai awal status/intent sesuai koleksi. |
| Task `extension[]` | Elemen `documentName.valueString` wajib untuk kedua code TTE. Gunakan URL extension kanonis yang dikonfirmasi di koleksi modul. | Nama dari jenis dokumen dan tampilan yang disetujui. Hindari identitas pasien pada nama yang keluar ke log. |
| Task `input[]`, `output[]` | Tiap item membawa `type` dan satu `value[x]`. Input `document-provenance` dan `valueReference` ke resource Provenance. Output `signed` atau `rejected` dari system Kemenkes atau `exception` dari `http://hl7.org/fhir/issue-type`, dengan `valueReference` ke Provenance menurut tabel modul. | Simpan status aplikasi, ID Task, semua Provenance, waktu, dan hasil setiap penanda tangan. |
| Provenance | `target[]`, `recorded`, `agent[].who` wajib. Tentukan `agent[].type` sesuai peran. Untuk signature, isi `signature[].type[]`, `when`, `who`, dan format serta data signature yang dihasilkan alur. `targetFormat`, `sigFormat`, `onBehalfOf` mengikuti format dan skenario. | Agen ditautkan ke Practitioner, Patient, wali, atau Organization sesuai skenario. Simpan versi target dan metadata hasil. Kunci penanda tangan berada pada proses penandatanganan. |
| Provenance penyedia tanda tangan | Standar v12.0 memberi `signature-provider.valueCodeableConcept.coding` dengan system Kemenkes dan code `BSrE`. Gunakan bila sesuai penyedia dari kontrak alur. URI extension memerlukan definisi profil yang aktif. | Pemetaan penyedia berasal dari proses penandatanganan. [Kode penyedia](../terminologi/kontrak-terminologi.md#nilai-yang-dibutuhkan-lintas-modul) |
| Contained Location, Device | Lokasi memakai `position.longitude`, `latitude`, `altitude` sesuai data yang tersedia pada alur. Jenis perangkat memakai `Device.type.coding` system Kemenkes dengan code `device-telephone`. Referensi contained memakai `#id` pada resource yang memilikinya. | Sumber perangkat dan lokasi adalah proses penandatanganan. Tetapkan akses log terbatas untuk metadata ini. |

`Provenance.agent.type.coding.system` untuk peran yang dicontohkan adalah `http://terminology.hl7.org/CodeSystem/provenance-participant-type`. Jenis signature menggunakan `urn:iso-astm:E1762-95:2013`. Contoh General Consent mencatat pemberi informasi sebagai `attester` dengan signature code `1.2.840.10065.1.12.1.2` dan pasien/wali sebagai `author` dengan signature code `1.2.840.10065.1.12.1.7`. Ambil penulis, verifikator, pasien, wali atau saksi sesuai jenis formulir dan pemetaan Playbook. [TTE, bab 1.5](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tanda-tangan-elektronik/#_1_5_pemetaan_variabel_dan_terminologi_spesifik) · [Profil Task](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/task/) · [Profil Provenance](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/provenance/)

### Jenis dokumen dan penanda tangan

Tabel mengikuti urutan terminologi pada Playbook. Kolom Coding dokumen memakai `Composition.type` kecuali jika disebutkan field lain. Kode LOINC ber-system `http://loinc.org`. Kode dokumen yang ditulis sebagai kode Kemenkes memakai `http://terminology.kemkes.go.id`. Sel penanda tangan ditulis sebagai kode `Provenance.agent.type` diikuti angka terakhir `Provenance.signature.type`, dengan awalan OID `1.2.840.10065.1.12.1.`. Setiap baris mengikuti urutan peran di tabel sumber. [TTE v1.1, tabel 2 dan 3](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tanda-tangan-elektronik/#_1_5_pemetaan_variabel_dan_terminologi_spesifik)

| No. | Dokumen | Coding dokumen | Penanda tangan menurut urutan sumber |
| ---: | --- | --- | --- |
| 1 | Persetujuan umum | Kemenkes `general-consent-doc` | Petugas `attester/2`, pasien/wali `author/7` |
| 2 | Persetujuan tindakan | LOINC `64293-4` | Petugas `attester/2`, pasien/wali `author/7`, saksi `attester/11` |
| 3 | Persetujuan anestesi | LOINC `61359-6` | DPJP `author/1`, petugas `attester/2`, pasien/wali `author/7`, saksi `attester/11` |
| 4 | Persetujuan aborsi | LOINC `52027-0` | Petugas `attester/2`, pasien/wali `author/7`, saksi `attester/11` |
| 5 | DNR | Kemenkes `dnr-doc` | Pasien `author/7`, saksi `attester/11` |
| 6 | Pulang atas permintaan sendiri | Kemenkes `dama-doc` | Pasien/wali `author/7`, saksi `attester/11` |
| 7 | Penghentian atau penundaan bantuan hidup | Kemenkes `term-susp-lst-doc` | Pasien/wali `author/7`, saksi `attester/11` |
| 8 | Layanan jenazah | Kemenkes `mortuary-service-doc` | Petugas `attester/2`, wali `author/7`, saksi `attester/11` |
| 9 | Serah terima limbah patologis | Kemenkes `pwh-doc` | Petugas penyerah `author/1`, keluarga `author/7`, pengelola `performer/2`, saksi `attester/11` |
| 10 | Pengkajian akhir hayat | LOINC `85435-6`; section `8716-3` dan `10154-3` | Dokter/perawat `author/1`, keluarga `attester/7` |
| 11 | Catatan ruang pemulihan | LOINC `67860-7`; section `8716-3` dan `18776-5` | Perawat ruang pemulihan `author/2`, penerima pasien `attester/11`, dokter anestesi `author/1` |
| 12 | Catatan sedasi dan anestesi | LOINC `84061-1`; section `8716-3`, `29545-1`, `10154-3`, `30954-2`, `48765-2` | Perawat anestesi `author/2`, perawat ruang pemulihan `attester/11`, dokter anestesi `author/1` |
| 13 | Perhitungan cairan | `Observation.code` LOINC `104103-7`; komponen `8953-2`, `8975-5`, `9187-6`, `9217-1`, `9137-1`, `9161-1` | Nakes `author/1` |
| 14 | Grafik intensif | LOINC `77440-6`; section `8716-3`, `29545-1`, `10154-3`, `30954-2`, `48765-2`, `TK000004`, `42346-7` | Perawat `author/1`, DPJP `verifier/5` |
| 15 | Pernyataan naik kelas | Kemenkes `upgrade-class-doc` | Pasien/wali `author/1`, petugas verifikasi `verifier/5` |
| 16 | Pernyataan kesanggupan biaya | Kemenkes `finance-doc` | Pasien/wali `author/1`, petugas verifikasi `verifier/5` |
| 17 | Lembar edukasi | `34895-3` dengan system Kemenkes sebagaimana tertulis di tabel. Verifikasi terhadap contoh resmi sebelum kirim. | Pemberi edukasi `author/1`, penerima `attester/7` |
| 18 | Hasil laboratorium | `DiagnosticReport.identifier.system=http://sys-ids.kemkes.go.id/diagnostic/{organization-id}/lab` | Petugas lab `author/1`, dokter lab `verifier/5` |
| 19 | Hasil radiologi | `DiagnosticReport.identifier.system=http://sys-ids.kemkes.go.id/diagnostic/{organization-id}/rad` | Dokter radiologi `author/1` |
| 20 | Resep | `DocumentReference.type` LOINC `57833-6`; gunakan profil kefarmasian untuk dokumen dan resep terkait | Dokter penulis resep `author/1` |
| 21 | Perintah rawat inap | `ServiceRequest.code` Kemenkes `spri` dan `inpatient-admission` menurut tabel | DPJP `author/1` |
| 22 | Resume medis | Jenis dan section Composition mengikuti pintu masuk layanan | DPJP `author/1` |
| 23 | Kuasa pelepasan data medik | Kemenkes `surat-pelepasan-informasi-medik` | Pemberi kuasa `author/7` |
| 24 | Surat jaminan awal | Kemenkes `surat-jaminan-awal` | Asuransi `author/1` |
| 25 | Surat jaminan akhir | Kemenkes `surat-jaminan-akhir` | Asuransi `author/1`, administrasi fasyankes `verifier/5`, pasien/wali `author/7` |
| 26 | Surat pernyataan excess | Kemenkes `surat-pernyataan-excess` | Asuransi `author/1` |

Untuk Composition yang berisi section terstruktur, isi `section.code` dan referensi `section.entry` sesuai isi aktual. Untuk formulir persetujuan, sertakan Consent dengan scope dan kategori sesuai tabel di bawah. Pemetaan field klinis untuk target digunakan kembali dari [Matriks Rawat Jalan](matriks-rawat-jalan.md), [Farmasi](matriks-farmasi.md), [Lab](../alur/laboratorium-rujukan-spesimen.md), dan [Radiologi](../alur/radiologi-dicom.md).

### Contoh Provenance awal dan hasil baca Task

Provenance awal dikirim setelah Composition dibuat. Reference berisi ID Sandbox yang telah dipetakan saat menjalankan uji.

```json
{
  "resourceType": "Provenance",
  "target": [{"reference": "Composition/<ID_RESUME>"}],
  "recorded": "2026-11-16T03:30:00Z",
  "agent": [{
    "type": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/provenance-participant-type", "code": "author"}]},
    "who": {"reference": "Practitioner/<ID_DPJP>"}
  }]
}
```

Potongan hasil `GET /Task/{id}` setelah penandatanganan.

```json
{
  "resourceType": "Task",
  "id": "<ID_TASK>",
  "status": "completed",
  "input": [{
    "type": {"coding": [{"system": "http://terminology.kemkes.go.id", "code": "document-provenance"}]},
    "valueReference": {"reference": "Provenance/<ID_PROVENANCE>"}
  }],
  "output": [{
    "type": {"coding": [{"system": "http://terminology.kemkes.go.id", "code": "signed"}]},
    "valueReference": {"reference": "Provenance/<ID_PROVENANCE>"}
  }]
}
```

## FHIR Consent, persetujuan klinis dan akses SSRME

Di TTE, persetujuan pasien pada tindakan atau formulir dicatat dengan Consent dan dokumen klinis terkait. Gunakan tipe persetujuan berdasarkan skenario. Untuk General Consent, `Composition.type` menggunakan code `general-consent-doc` dan `Consent.scope` menggunakan `general-consent`, keduanya dari `http://terminology.kemkes.go.id`. Kategori Consent memakai LOINC `59284-0`. Surat kuasa pelepasan informasi menggunakan pemetaan privacy consent tersendiri. [Pemetaan Consent pada TTE](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tanda-tangan-elektronik/#_1_5_pemetaan_variabel_dan_terminologi_spesifik)

Untuk scope FHIR gunakan `http://terminology.hl7.org/CodeSystem/consentscope`. Untuk kategori FHIR gunakan `http://terminology.hl7.org/CodeSystem/consentcategorycodes`.

| Formulir | `Consent.scope` | `Consent.category` |
| --- | --- | --- |
| Persetujuan umum | Kemenkes `general-consent` | LOINC `59284-0` |
| Tindakan, anestesi, layanan jenazah dan limbah patologis | FHIR `treatment` | LOINC `64293-4` |
| Aborsi | FHIR `treatment` | LOINC `52027-0` |
| DNR | FHIR `adr` | FHIR `dnr` |
| Pulang atas permintaan sendiri | FHIR `treatment` | Kemenkes `dama` |
| Penghentian atau penundaan bantuan hidup | FHIR `adr` | FHIR `hcd` |
| Naik kelas | FHIR `treatment` | Kemenkes `upgrade-class` |
| Kesanggupan biaya | FHIR `treatment` | Kemenkes `finance` |
| Kuasa pelepasan data medik | FHIR `patient-privacy` | FHIR `npp` |

| Field FHIR Consent | Aturan profil dan sumber |
| --- | --- |
| `identifier[]`, `status`, `scope`, `category[]` | W pada profil SATUSEHAT. Identifier bertahan untuk dokumen persetujuan. Status dapat berupa `draft`, `proposed`, `active`, `rejected`, `inactive` atau `entered-in-error` sesuai fakta. Scope dan kategori mengikuti objek persetujuan, bukan status tanda tangan. |
| `patient`, `dateTime`, `performer[]`, `organization[]` | Isi sesuai pelaku, pasien, fasyankes dan tanggal yang tertulis di persetujuan. Catat perwakilan yang berwenang ketika berlaku. |
| `source[x]` | Pakai `sourceAttachment` atau `sourceReference` sesuai bentuk bukti yang sah. Tautkan dokumen yang ditinjau dan disetujui. |
| `policy[].uri` | W dalam profil SATUSEHAT. Profil memberi contoh URI `http://satusehat.kemkes.go.id/fhir/consent-policy`. Simpan kebijakan yang berlaku ketika persetujuan diperoleh. |
| `verification[]` | Kondisional. Bila digunakan, `verified` wajib per item. Isi `verifiedWith` dan `verificationDate` bila tersedia. |
| `provision` | Kondisional. Isi tipe permit/deny, periode, tujuan, aktor, resource yang dicakup dan aturan anak sesuai kebijakan data. Tiap aktor memuat role dan reference. Tiap item `data[]` memuat meaning dan reference. |

Katalog profil memberi definisi payload. Operasi standalone Consent yang diizinkan untuk aplikasi Metta masih perlu dibuktikan per modul dan scope. SSRME memakai persetujuan akses riwayat dan Time-bound FHIR SHLink melalui layanan SSRME v2. `data.consentId` dan kode `CONSENT_REQUIRED` ditangani menurut kontrak SSRME. Status persetujuan klinis TTE tidak memberi izin membuka riwayat nasional. [Profil Consent](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/consent/) · [Alur akses SSRME](../alur/ssrme.md#alur-akses)
