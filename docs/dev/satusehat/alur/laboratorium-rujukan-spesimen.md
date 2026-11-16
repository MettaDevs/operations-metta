# Laboratorium dan rujukan spesimen

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Resume Medis - Rawat Jalan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/) (v7.0, rilis 2026-01-10, disunting 2026-08-04) · [Rujukan Spesimen](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rujukan-spesimen/) (v1.0, rilis 2024-12-16, disunting 2025-10-02)

[Indeks SATUSEHAT](../README.md) · [Alur layanan](README.md)

Bagian laboratorium menghubungkan order, spesimen, hasil per parameter dan laporan. Rujukan spesimen menambah perpindahan sampel dan pertukaran status antar-fasyankes. Organisasi perujuk, organisasi penerima, dan akun OAuth harus sesuai peran. Data klinis pasien, kunjungan, nakes dan diagnosis tersedia dalam domain Healthcare. Nomor order penunjang, inventaris spesimen, penerimaan lab, antarmuka LIS dan nomor nasional perlu kontrak penyimpanan Metta yang terverifikasi. [Rawat Jalan bab 10](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_10_pengiriman_data_pemeriksaan_penunjang_laboratorium) · [Playbook Rujukan Spesimen v1.0](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rujukan-spesimen/) · [Healthcare Metta](../../../../modules/healthcare/README.md)

## Laboratorium dalam satu fasyankes

| Tahap | Operasi HTTP FHIR | Payload dan data hasil |
| --- | --- | --- |
| Order pemeriksaan | `POST /fhir-r4/v1/ServiceRequest` | Simpan identifier order, kode permintaan, Patient, Encounter, peminta, waktu dan prioritas. Catat ID ServiceRequest balikan. |
| Data pengambilan | `POST /fhir-r4/v1/Specimen` | Kirim jenis spesimen, subjek, order pada `request[]`, waktu dan petugas pengambilan serta kondisi/penerimaan yang tercatat. Buat Substance dan referensikan sesuai profil jika menggunakan bahan tambahan. Pakai `PUT` atau `PATCH` dari katalog untuk perubahan yang didukung profil. |
| Hasil per parameter | `POST /fhir-r4/v1/Observation` | Satu Observation per parameter sesuai Playbook. Isi kategori `laboratory`, kode hasil, status, subjek, encounter, referensi order dan spesimen, penanggung jawab, waktu, nilai dan nilai rujukan bila berlaku. Simpan ID tiap hasil. |
| Laporan terverifikasi | `POST /fhir-r4/v1/DiagnosticReport` | Kode laporan mengikuti kode order yang dilaporkan. Hubungkan `basedOn[]` ke order, `specimen[]` ke sampel, dan `result[]` ke Observation. Isi status klinis, waktu, penanggung jawab dan kesimpulan bila ada. Baca balik laporan dan semua referensinya. |

Kirim kode yang memang dipetakan untuk permintaan dan kode untuk hasil. Gunakan LOINC atau kode Pemeriksaan Penunjang Nasional sesuai daftar kode skenario. Hasil numerik menempati `valueQuantity`, dengan satuan UCUM jika berlaku. Hasil kategori memakai `valueCodeableConcept` sesuai value set dan hasil naratif memakai `valueString` jika profil mendukungnya. Pilih satu field `value[x]` per Observation. [Rawat Jalan bab 10](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_10_pengiriman_data_pemeriksaan_penunjang_laboratorium) · [Katalog HTTP](../endpoint/inventaris-operasi-http.md#fhir-dan-orientasi)

Contoh bentuk hasil numerik. Kode hasil, nilai, waktu, ID, dan satuan diganti dengan data fixture yang dipetakan untuk pemeriksaan yang dipilih.

```json
{
  "resourceType": "Observation",
  "status": "final",
  "category": [{
    "coding": [{"system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "laboratory"}]
  }],
  "code": {"coding": [{"system": "http://loinc.org", "code": "<KODE_LOINC_HASIL>"}]},
  "subject": {"reference": "Patient/<PATIENT>"},
  "encounter": {"reference": "Encounter/<ENCOUNTER>"},
  "basedOn": [{"reference": "ServiceRequest/<ORDER>"}],
  "specimen": {"reference": "Specimen/<SPECIMEN>"},
  "performer": [{"reference": "Practitioner/<VALIDATOR>"}],
  "effectiveDateTime": "2026-11-16T03:00:00+00:00",
  "issued": "2026-11-16T03:15:00+00:00",
  "valueQuantity": {"value": 120, "unit": "mg/dL", "system": "http://unitsofmeasure.org", "code": "mg/dL"}
}
```

## Rujukan spesimen antar-fasyankes

| Bab | Pelaku dan tahap | Operasi dan keluaran |
| --- | --- | --- |
| 1–2 | Perujuk menyiapkan IHS dan kunjungan asal | Resolusi Patient melalui [MPI](../endpoint/master-data-pasien.md), lalu `POST Encounter`. Simpan ID Encounter yang menjadi konteks order. |
| 3–4 | Perujuk membuat order dan data sampel saat transaksi | Kirim ServiceRequest dan Specimen dalam satu Bundle saat permintaan rujukan dibuat. Hubungkan `ServiceRequest.specimen[]` dan `Specimen.request[]` melalui referensi antar-entry. Lihat [pola transaksi FHIR](../endpoint/kontrak-fhir-http.md) untuk `fullUrl` dan validasi hasil per entry. |
| 5–7 | Perujuk mengambil nomor nasional dan menyelesaikan kunjungan asal | `GET ServiceRequest/{id}` membaca identifier `http://sys-ids.kemkes.go.id/referral-number`. `GET Specimen/{id}` membaca identifier `http://sys-ids.kemkes.go.id/specimen-acsn` bertipe ACSN. Cetak nomor rujukan pada dokumen pengiriman dan nomor spesimen pada sampel. Finalisasi kunjungan asal dengan `PUT Encounter/{id}`. |
| 8–9 | Penerima memeriksa permintaan dan kondisi saat sampel tiba | `GET ServiceRequest?identifier={system}%7C{nomor}&_include=ServiceRequest:specimen&_include=ServiceRequest:supportingInfo`. Baca entry order dan resource terkait, lalu gunakan `PATCH Specimen/{id}` untuk mencatat waktu, petugas penerima, histori kondisi, dan status sesuai kondisi fisik. |
| 10–11 | Penerima menyatakan diterima atau ditolak | `POST Task` dengan status `accepted` atau `rejected`. Untuk sampel yang siap diperiksa, `POST Encounter` penerima dengan status `in-progress` dan `class.code=referred-procedure` dari `http://terminology.kemkes.go.id/CodeSystem/encounter-class`. Pertahankan Patient dan tautan ke order asal. |
| 12–15 | Penerima mengirim hasil dan laporan | `POST Observation` untuk hasil, lalu `POST DiagnosticReport`. Hubungkan data ke order asal, spesimen, Patient, serta Encounter penerima. `PATCH Task/{id}` ke `completed` dengan `output.valueReference` ke laporan disertai `output.type`. Akhiri Encounter penerima melalui `PUT Encounter/{id}`. |
| 16–18 | Perujuk mengambil hasil dan menutup permintaan | Cari Observation dan DiagnosticReport dengan nomor rujukan nasional menurut Playbook. Cocokkan relasi order, spesimen dan pasien. `PATCH ServiceRequest/{id}` ke `completed` setelah hasil dan laporan diterima. Query spesifik hasil dan laporan perlu diverifikasi dari koleksi contoh sebelum implementasi. |

Nama resource pada tabel adalah relatif terhadap `/fhir-r4/v1`. `_include` menambahkan resource terkait ke Bundle pencarian. Saat membaca Bundle, bedakan entry yang cocok dengan kriteria dari entry yang hanya disertakan. Otorisasi antar-fasyankes harus dibuktikan untuk masing-masing organisasi. [Playbook Rujukan Spesimen bab 1–18](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rujukan-spesimen/) · [Kontrak HTTP FHIR](../endpoint/kontrak-fhir-http.md)

### Field spesifik rujukan

| Resource | Field dan aturan skenario | Sumber dan gap Metta |
| --- | --- | --- |
| ServiceRequest | `identifier` order lokal dengan system `http://sys-ids.kemkes.go.id/servicerequest/{organization-id}`, `status=active`, `intent=original-order`, `priority=stat` atau `routine`. Kategori SNOMED CT `108252007` dan `266753000`, `code` menggunakan kode LOINC, `requester` dokter, `performer[]` Organization tujuan, `subject` Patient, `encounter` kunjungan asal, `specimen[]` sampel. `reasonReference[]` membawa alasan terstruktur dan `supportingInfo[]` konteks yang dibutuhkan. | Kunjungan, pasien dan dokter ada. Perlu konfigurasi tujuan, kode order, tingkat prioritas lab, rujukan nasional dan status pembaruan. |
| Specimen | `identifier[]`, `status`, `type`, `subject`, `request[]`, `collection`, data transportasi, `receivedTime`, dan extension `receivedPerson` serta `conditionHistory` sesuai profil. | Perlu ID tabung/sampel, barcode, status kondisi dan rantai serah terima. Simpan ID nasional terpisah dari ID lokal. |
| Task | `basedOn[]` ServiceRequest, `status`, `intent=instance-order`, `priority` mengikuti order, `code=fulfill` dengan system `http://hl7.org/fhir/CodeSystem/task-code`, `focus` Specimen, `for` Patient, `encounter`, `requester` Organization asal, `owner` Organization penerima, `reasonReference` Condition dan `note[]` untuk alasan atau catatan. Jika `input[]` atau `output[]` dikirim, sertakan tipe dan `value[x]`. | Perlu keputusan lab yang dapat diaudit, pemetaan dua organisasi, ID Task dan referensi laporan. |
| Condition, Observation | Diagnosis asal dapat menjadi `reasonReference` (ICD-10). Tujuan spesimen memakai Observation kemkes `TK000026`, dengan nilai `225419007` di SNOMED CT untuk surveilans atau `TK000027` di terminologi Kemenkes untuk tujuan lainnya. | Diagnosis ada. Perlu data tujuan pemeriksaan terstruktur. |
| MedicationStatement, Procedure, Substance | Sertakan data pendukung yang memang tersedia. `MedicationStatement` bisa mendeskripsikan obat yang sedang dikonsumsi melalui KFA, Procedure mencatat riwayat tindakan atau puasa, dan Substance mendeskripsikan bahan yang digunakan. | Tentukan per pemeriksaan informasi yang dibutuhkan dan sumber terstruktur masing-masing. |

Untuk hasil rujukan, catat personel yang menganalisis, memvalidasi dan menginterpretasi hasil. Playbook memakai kode peran `petugas-lab`, `quality-validator`, dan `dpjp-lab` dengan system `http://terminology.kemkes.go.id/practitioner-type` pada `Observation.performer[].identifier`. Identitas Practitioner dan Organization tetap memakai referensi yang sesuai. Kategori DiagnosticReport memakai `http://terminology.hl7.org/CodeSystem/v2-0074` dan kode laporan LOINC. [Rujukan Spesimen bab 12–14](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rujukan-spesimen/)

### Variasi penolakan dan rujuk lagi

- Jika sampel hilang atau rusak, penerima merekam penerimaan dan kondisi melalui PATCH Specimen, menggunakan `unavailable` atau `unsatisfactory` sesuai alasan. Keputusan order diterbitkan melalui Task `rejected`. Jika penolakan karena kendala lain, catat alasannya pada `Task.note`.
- Untuk pengiriman ulang dari perujuk, buat order dan sampel baru. Gunakan `ServiceRequest.replaces[]` ketika tujuan sama dengan fasyankes yang menolak sesuai Playbook. Sampel baru menunjuk order baru.
- Jika penerima pertama merujuk ke penerima kedua, order baru menunjuk order asal di `ServiceRequest.basedOn[]` dan sampel baru menunjuk sampel sebelumnya di `Specimen.parent[]`. Saat penerima pertama melaporkan hasil kembali ke asal, ia menerbitkan Observation dengan `derivedFrom[]` ke hasil penerima kedua dan DiagnosticReport dengan referensi order serta spesimen awal. Playbook menulis `derivedForm` pada ringkasan bab 20. Nama elemen FHIR R4 adalah `derivedFrom`. [Rujukan Spesimen bab 19–20](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rujukan-spesimen/) · [FHIR R4 Observation](https://hl7.org/fhir/R4/observation.html)

## Respons, error, dan penerimaan Sandbox

Simpan resource ID dan identifier aplikasi dari respons create. Pada transaksi, simpan status tiap entry dan verifikasi tiap resource dapat dibaca balik. Untuk PATCH, simpan ID, perubahan yang diminta serta status akhir yang dibaca ulang. Jika respons HTTP hilang, cari dulu dengan identifier yang tepat sebelum mengirim ulang create. Cocokkan Error FHIR dengan `issue[].code`, `diagnostics`, `expression[]` dan Rule Number bila ada. `rejected` merupakan keputusan lab yang sah dan diproses sebagai status kerja. [Validasi dan error](../validasi/respons-dan-error.md) · [Kontrak HTTP FHIR](../endpoint/kontrak-fhir-http.md)

| Skenario | Kriteria lulus |
| --- | --- |
| Pemeriksaan internal | Satu order fixture, satu spesimen, dua parameter hasil dan satu laporan dapat dibaca balik dengan tautan yang sesuai. Kode permintaan, kode hasil dan unit benar. |
| Rujukan berhasil | Dua Organization terotorisasi. Nomor rujukan dan nomor sampel ditemukan melalui ID atau query. Penerima membaca kueri dengan `_include`, mencatat sampel, mengirim Task hingga `completed` dan laporan, lalu perujuk menyelesaikan ServiceRequest. |
| Spesimen tidak layak | PATCH menyimpan status dan alasan kondisi. Task `rejected` terlihat sebagai keputusan bisnis dan hasil final tidak dibuat untuk order itu. |
| Rujuk lagi | Order pengganti atau turunan, sampel, dan Observation turunan membentuk rantai yang benar dalam pembacaan balik. |
| Error integrasi | Uji referensi salah, kode tidak terpetakan, akses beda Organization, timeout saat create dan pengiriman pesan penerimaan ganda. Log hanya menyimpan status, kode dan ID korelasi fixture. |

Hasil uji laboratorium dan rujukan spesimen Metta masih terbuka. [SB-08 Lab dan radiologi](../pengujian/skenario-sandbox.md#sb-08-lab-dan-radiologi)
