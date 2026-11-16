# Registrasi Mata dan Telinga

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Registrasi Mata](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/mata/) (v1.0, rilis 2024-11-05, disunting 2024-12-08) · [Registrasi Telinga](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-telinga/) (v1.0, rilis 2025-05-16, disunting 2025-07-24) · [EpisodeOfCare](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/episode-of-care/) (disunting 2023-09-27)

[Indeks SATUSEHAT](../README.md) · [Alur layanan](README.md)

Dokumen ini mengikuti Registrasi Mata v1.0 (5 November 2024) dan Registrasi Telinga v1.0 (16 Mei 2025). Masing-masing mencatat episode pelayanan dan temuan per sisi, lalu menyusun Composition dari ID yang sudah diterbitkan. Portal menandai kedua modul tersedia di Sandbox selama pengembangan. [Registrasi Mata](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/mata/) · [Buku Mata](https://drive.google.com/file/d/1oWFHZ2-hTO4RIBc6C0CtsVPHZKvGzq4N/preview) · [Registrasi Telinga](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/registrasi-telinga/) · [Buku Telinga](https://drive.google.com/file/d/1CPbTLCLuG9YckkhYsQxLHjESP4l9Gx_w/preview)

[Prasyarat dan sumber Metta](#prasyarat-dan-sumber-metta) · [Operasi dan siklus episode](#operasi-dan-siklus-episode) · [Registrasi Mata](#registrasi-mata) · [Registrasi Telinga](#registrasi-telinga) · [Composition, hasil dan korelasi](#composition-hasil-dan-korelasi) · [Error, akses dan uji](#error-akses-dan-uji)

## Prasyarat dan sumber Metta

Siapkan IHS Patient dan nakes, Organization, Location dan Encounter. Metta menyimpan identitas, kunjungan, anamnesis, pemeriksaan dasar, diagnosis, tindakan, obat dan rujukan. Perlu data terstruktur sisi pemeriksaan, metode, temuan dan nilai per mata/telinga, hasil pemeriksaan alat, spesifikasi lensa atau alat bantu, rencana terapi, dan status episode. Untuk skrining awal di UKS atau Posyandu, gunakan [PKPR](pkpr-luar-gedung.md); untuk deteksi dalam program PTM ikuti [Skrining PTM](skrining-penyakit-tidak-menular.md). [Rekam medis Metta](../../../../modules/healthcare/README.md#rekam-medis-pemeriksaan)

## Operasi dan siklus episode

| Tahap | Request | Balikan dan keputusan |
| --- | --- | --- |
| Registrasi | Resolve Patient melalui MPI, buat `POST /fhir-r4/v1/Encounter`. | Simpan ID Patient, nakes, Organization, Location dan Encounter. |
| Buka episode Mata | `POST /fhir-r4/v1/EpisodeOfCare` dengan tipe `EMC` dari `http://terminology.kemkes.go.id`. `waitlist` untuk dicurigai glaukoma dengan `H40.0` menurut bab 3. `active` tersedia saat diagnosis mata yang sesuai telah dicatat. | ID episode dan `suspect-id` sesuai alur. Kaitkan `Encounter.episodeOfCare[]`. Setelah terkonfirmasi, PATCH menjadi `active` dan simpan `registry-id` aktual. Bab 18 menutup episode dengan PATCH `finished` dan akhir periode ketika pasien dinyatakan meninggal. |
| Buka episode Telinga | `POST /fhir-r4/v1/EpisodeOfCare` tipe `ADM` dari `http://terminology.kemkes.go.id` dan status `waitlist` untuk ambang dengar di kategori yang tercantum bab 3. | ID, `suspect-id` dan hubungan Encounter. PATCH `active` saat diagnosis terkonfirmasi dan simpan `registry-id`. Bab 25 memberi penutupan `finished` ketika dinyatakan sembuh atau tidak ada pembaruan kegiatan pasien selama 2 tahun sejak kunjungan terakhir. |
| Baca ulang dan perbarui | `GET /fhir-r4/v1/EpisodeOfCare/{id}` atau [kueri program](../endpoint/kueri-episode-of-care.md) dari contoh Koleksi Mata dan Telinga. `PATCH /fhir-r4/v1/EpisodeOfCare/{id}` untuk transisi dan periode. `PUT /fhir-r4/v1/Encounter/{id}` saat finalisasi kunjungan. | Buktikan hak akses dan nomor nasional dari respons akun program. Cocokkan Patient, tipe, Organization, status, dan periode. |

Kirim `EpisodeOfCare.patient`, `managingOrganization`, `status`, `type[]`, `period` dan histori sesuai profil. Pertahankan episode yang sudah tertaut untuk kunjungan berulang. Gunakan OAuth Bearer serta JSON FHIR/JSON Patch sesuai metode. [Kontrak HTTP](../endpoint/kontrak-fhir-http.md) · [Katalog EpisodeOfCare](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/episode-of-care/)

## Registrasi Mata

| Bab | Resource dan pemetaan |
| --- | --- |
| 1–3 | Patient, Encounter dan EpisodeOfCare `EMC`. |
| 4–6 | Anamnesis, risiko, pemeriksaan fisik dan psikologis mengikuti profil pintu masuk dengan Condition, AllergyIntolerance, MedicationStatement dan Observation. Risiko diabetes pada pemetaan memakai SNOMED CT `73211009` dengan boolean. |
| 7–8 | Observation per metode dan sisi serta penunjang aktual. Snellen kanan/kiri LOINC `79882-7`/`79883-5` dengan `valueRatio` dan UCUM `m`. Visus jauh `386714003`/`386716001` dan dekat `386712004`/`386711006` dari SNOMED CT dengan `valueString`. Pemeriksaan lanjutan tertentu memakai `OC000003` dan `bodySite`; refleks fundus SNOMED CT `43408002`. Buku Mata memberi LOINC `79892-6`/`79893-4` pada tabel tekanan intraokular. Playbook PTM menampilkan pasangan itu untuk pinhole. Gunakan metode, terminologi resmi dan contoh koleksi yang cocok dengan pemeriksaan; verifikasi perbedaan sebelum mengirim kode tersebut. |
| 9–12 | Condition diagnosis, Procedure tindakan/edukasi, MedicationRequest bila resep, serta VisionPrescription untuk resep kacamata. ClinicalImpression untuk prognosis sesuai fakta. |
| 13–19 | ServiceRequest rencana dan instruksi, data pulang, pembaruan Encounter, penutupan episode menurut kriteria dan Composition registrasi. |

Pada VisionPrescription, buku menandai `status`, `created`, `patient`, `dateWritten`, `prescriber` dan `lensSpecification[]` dengan `product` dan `eye` wajib. Di `lensSpecification[]` catat sisi dan spesifikasi `sphere`, `cylinder`, `axis`, `add`, `power` atau prisma dari resep yang disahkan. Gunakan `product.coding` `lens` dari `http://terminology.hl7.org/CodeSystem/ex-visionprescriptionproduct` pada contoh, dan `eye` sebagai code `right`/`left` sesuai FHIR R4. Jika prisma dikirim, isi `amount` dan `base`. [Buku Mata, bab 7 dan 11](https://drive.google.com/file/d/1oWFHZ2-hTO4RIBc6C0CtsVPHZKvGzq4N/preview) · [FHIR R4 VisionPrescription](https://hl7.org/fhir/R4/visionprescription.html)

Koleksi Registrasi Mata menerbitkan `POST /fhir-r4/v1/VisionPrescription` dengan OAuth Bearer, body JSON FHIR, `status=active` serta contoh dua baris lensa dengan sisi berbeda. Simpan ID yang diterima untuk bagian `TK000045` pada Composition. Dukungan baca detail dan scope akun Metta masih perlu bukti. [Postman peresepan kacamata](https://www.postman.com/satusehat/satusehat-public/documentation/rz23vr8/31-use-case-registrasi-mata?entity=request-30206597-4c0907a6-0b2c-47f3-8381-d8e3b10a117e)

## Registrasi Telinga

| Bab | Resource dan pemetaan |
| --- | --- |
| 1–3 | Patient, Encounter dan EpisodeOfCare `ADM` sesuai pemicu. |
| 4–10 | Anamnesis, pemeriksaan fisik/fungsional, perjalanan penyakit, tujuan dan perencanaan, rencana/perintah medik. Gunakan Observation, Condition, ClinicalImpression, Goal dan CarePlan sesuai fakta. |
| 11–15 | Observation untuk status audiologi dan penunjang, ClinicalImpression untuk rasional, Condition untuk diagnosis ICD-10 dan RiskAssessment bila dilakukan. Kode SNOMED CT `385898003` untuk asesmen perawatan telinga, `47078008` untuk tipe gangguan dan `89269003` untuk ambang dengar. Kode Kemenkes `TK000135` mencatat pemeriksaan fungsi dalam pemetaan. Ambang memakai nilai desimal `dB` dan interpretasi dari lampiran. Gunakan `bodySite` SNOMED CT `25577004` kanan atau `89644007` kiri. Pada tabel kiri unit system memakai UCUM, sedangkan tabel kanan memberi SNOMED CT untuk unit yang sama. Cocokkan wire UCUM dan validasi terhadap profil. |
| 16–19 | Procedure, tatalaksana dan obat; Observation tatalaksana telinga `385900001`, prognosis ClinicalImpression, dan `POST /fhir-r4/v1/CarePlan` hasil akhir pengobatan menurut bab 19. CarePlan kategori SNOMED CT `773983001` dan outcome `182992009`, `266714009` atau `399307001` sesuai fakta. Gunakan `completed` saat rencana dinyatakan selesai. |
| 20–26 | Tindak lanjut, rujukan, kondisi/cara keluar, PUT Encounter, PATCH penutupan episode sesuai kriteria, serta Composition. |

[Buku Telinga, bab 11–19](https://drive.google.com/file/d/1CPbTLCLuG9YckkhYsQxLHjESP4l9Gx_w/preview)

## Composition, hasil dan korelasi

`POST /fhir-r4/v1/Observation`, `POST /fhir-r4/v1/CarePlan`, dan `POST /fhir-r4/v1/Composition` sesuai operasi yang didukung. Simpan ID setiap resource dan baca balik melalui GET detail. Isi `Composition.identifier` per organisasi, `type.coding`, status, waktu, Patient, Encounter, author, dan referensi. Tipe dan section menggunakan `http://terminology.kemkes.go.id`.

| Bagian | Mata `TK000043` | Telinga `TK000137` |
| --- | --- | --- |
| Episode/anamnesis/fisik | `TK000002`, `TK000003`, `TK000007` | `TK000002`, `TK000003`, `TK000007` |
| Hasil program | `TK000044` hasil pemeriksaan mata ke Observation | `TK000138` status audiologi ke Observation |
| Penunjang, diagnosis, tindakan, obat | `TK000009`, `TK000004`, `TK000005`, `TK000013` | `TK000009`, `TK000004`, `TK000005`, `TK000013` |
| Bagian khusus lainnya | `TK000045` resep kacamata yang menunjuk VisionPrescription | `TK000215` tatalaksana dan `TK000139` akhir pengobatan yang menunjuk fakta terkait |

Contoh request ambang dengar telinga kiri. Nilai dan interpretasi harus berasal dari pemeriksaan yang dipakai sebagai fixture.

```json
{
  "resourceType": "Observation",
  "status": "final",
  "category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "exam"}]}],
  "code": {"coding": [{"system": "http://snomed.info/sct", "code": "89269003"}]},
  "bodySite": {"coding": [{"system": "http://snomed.info/sct", "code": "89644007"}]},
  "subject": {"reference": "Patient/<PATIENT>"},
  "encounter": {"reference": "Encounter/<VISIT_TELINGA>"},
  "effectiveDateTime": "2026-11-16T04:10:00Z",
  "valueQuantity": {"value": 30, "unit": "dB", "system": "http://unitsofmeasure.org", "code": "dB"}
}
```

Potongan baca balik Composition Mata yang memuat resep kacamata jika dilakukan. Pastikan referensi yang dibaca merupakan VisionPrescription yang berhubungan dengan bagian tersebut.

```json
{
  "resourceType": "Composition",
  "id": "<REGISTRASI_MATA>",
  "type": {"coding": [{"system": "http://terminology.kemkes.go.id", "code": "TK000043"}]},
  "subject": {"reference": "Patient/<PATIENT>"},
  "section": [{"code": {"coding": [{"system": "http://terminology.kemkes.go.id", "code": "TK000045"}]}, "entry": [{"reference": "VisionPrescription/<RESEP_KACAMATA>"}]}]
}
```

## Error, akses dan uji

Gunakan `OperationOutcome.issue[]` dan kode aturan pada `400`/`422`, terutama untuk typologi episode, tipe hasil/lensa, satuan atau referensi sisi. Cek role dan lingkungan bila `401`/`403`. Untuk respons hilang, cari ID episode/kiriman berdasarkan pasien, tipe, Encounter serta waktu sesuai mekanisme yang didukung, lalu retry terbatas untuk gangguan sementara. Lindungi data klinis dan data alat bantu. Log umum cukup memuat waktu, status dan korelasi tersamarkan. [Validasi dan error](../validasi/respons-dan-error.md)

Uji glaukoma terduga dan diagnosis mata dengan episode aktif, dua temuan per mata, resep kacamata bila diizinkan, dua ambang dengar pada sisi berbeda, hasil CarePlan dan penutupan sesuai modul. Lulus jika EpisodeOfCare dan Composition dapat dibaca, seluruh referensi berasal dari pasien/fasyankes yang tepat, dan retry tidak menambah data ganda. VisionPrescription dan penerimaan kedua alur Sandbox Metta masih terbuka. [Status bukti](../pengujian/skenario-sandbox.md#status-bukti)
