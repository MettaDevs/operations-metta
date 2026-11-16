# Pelayanan IGD dan rawat inap

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Pelayanan Instalasi Gawat Darurat (IGD)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/igd/) (v5.2, rilis 2025-10-30, disunting 2025-12-02) · [Rawat Inap](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rawat-inap-new/) (v6.0, rilis 2026-01-10, disunting 2026-08-06)

[Indeks SATUSEHAT](../README.md) · [Alur layanan](README.md) · [Endpoint, respons, dan hasil uji IGD dan rawat inap](../endpoint/igd-dan-rawat-inap.md)

Gunakan panduan ini bersama [Field wajib per bab](../payload/profil-field-layanan.md), [Kontrak HTTP FHIR](../endpoint/kontrak-fhir-http.md), dan matriks rawat jalan untuk elemen klinis yang sama. Acuan yang diperiksa pada 16 November 2026 adalah Playbook IGD v5.2 (30 Oktober 2025) dan Rawat Inap v6.0 (10 Januari 2026). Penerimaan IGD dan rawat inap belum dibuktikan di Sandbox Metta. [Playbook IGD](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/igd/) · [Playbook Rawat Inap](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rawat-inap-new/)

## Kesiapan data di Metta

| Data | Sumber dan keputusan yang masih dibutuhkan |
| --- | --- |
| Pasien, nakes, unit, Organization, dan Location | Registrasi, master nakes, section, dan ruangan tersedia. `sim_m_section.jenis` membedakan `gawat_darurat` dan `rawat_inap`. Pemetaan IHS dan Location diperlukan per unit dan lingkungan. [Registrasi Metta](../../../../modules/healthcare/README.md#pendaftaran-kunjungan) |
| Waktu kunjungan, pemeriksaan, diagnosa, tindakan dan penanggung jawab | `sim_tr_registrasi`, tujuan, pemeriksaan, panel rekam medis, ICD-10 dan tabel tindakan memberi data dasar. Waktu triase, tingkatan triase, pergantian DPJP, perpindahan kamar, kelas serta episode rawat perlu pencatatan yang cukup rinci agar riwayat Encounter bisa dibentuk. [Rekam medis](../../../../modules/healthcare/README.md#rekam-medis-pemeriksaan) · [Diagnosa](../../../../modules/healthcare/README.md#diagnosa-pemeriksaan) |
| Rencana dan administrasi harian | CPPT dan status pasien tersedia dalam alur Healthcare. Perlu pemeriksaan data terstruktur untuk instruksi harian, care plan, goals, pemberian obat, diet dan akurasi waktu. Simpan asal dan versi setiap catatan. [Status pasien, rujuk internal dan CPPT](../../../../modules/healthcare/README.md#status-pasien-rujuk-internal-dan-cppt) |
| Pulang atau rujuk | Status dan keadaan pulang disimpan pada tujuan, dengan konsep rujuk internal. Kebutuhan rujukan nasional, perintah rawat inap, discharge disposition dan kondisi klinis pulang memerlukan mapping per skenario. [Rujukan pasien](rujukan-pasien.md) |

## Kunjungan dan transisi

| Tahap | IGD | Rawat inap |
| --- | --- | --- |
| Identitas | Cari Patient melalui MPI dan resolve Practitioner, Organization dan Location. | Alur identitas sama; lokasi berupa unit atau ruang yang benar untuk episode rawat. |
| Create Encounter | `POST /Encounter` memakai `class.code=EMER` dari `http://terminology.hl7.org/CodeSystem/v3-ActCode`. Isi status sesuai fakta `arrived`, `triaged`, atau `in-progress` sebagaimana tahapan pendaftaran. | `POST /Encounter` memakai `class.code=IMP` dari system yang sama dan status awal `in-progress`. |
| Data awal | `identifier[]` memakai `http://sys-ids.kemkes.go.id/encounter/{organization-id}`, `subject`, `participant`, `location`, `period.start`, `serviceProvider`, `statusHistory` dan `serviceType` sesuai matriks. Kelas ruang IGD memakai `reguler` dan indikator `kelas-tetap` bila blok digunakan. | Field dasar yang sama. Untuk kelas inpatient gunakan `1`, `2`, `3`, `vip`, `vvip` dari `http://terminology.kemkes.go.id/CodeSystem/locationServiceClass-Inpatient`. Indikator `kelas-tetap`, `naik-kelas`, `turun-kelas`, `titip-rawat` memakai system `http://terminology.kemkes.go.id/CodeSystem/locationUpgradeClass`. |
| Saat pelayanan | Simpan perubahan triase dan pemeriksaan pada periode/status yang benar. Bila pasien keluar dari kategori emergensi namun masih perlu observasi di IGD, `PUT /Encounter/{id}` mengubah `class` ke `OBSENC` dan menulis `classHistory[]` EMER yang ditutup dan OBSENC yang dibuka pada waktu yang sama. | Catat riwayat ruangan, kelas dan DPJP dengan periode yang sebenarnya. Gunakan Location serta extension service class pada entry lokasi sesuai profil. Untuk status pengunjung, kunjungan spesialisasi dan episode pelayanan, Standar Terminologi v12.0 memberi `valueCode` `new`, `returning` atau `unknown`. Canonical URI dan struktur extension perlu diperiksa pada profil aktif. [Kode novelty](../terminologi/kontrak-terminologi.md#nilai-yang-dibutuhkan-lintas-modul) |
| Finalisasi | `PUT /Encounter/{id}` sesuai profil. Kirim body dengan ID resource yang sama, `period.end`, diagnosis, status akhir dan disposition sesuai cara keluar. | `PUT /Encounter/{id}` dengan diagnosis primer/sekunder, akhir periode, cara keluar, dan referensi keputusan/pasca-rawat yang relevan. |
| Resume | `POST /Composition` dari fakta yang telah final. Rujuk Observation, ClinicalImpression, Goal, CarePlan, Condition, Procedure serta resource penunjang dan farmasi yang memang tersedia. | `POST /Composition` memakai section sesuai Rawat Inap. Bedakan resume final dari Composition laporan tindakan terapeutik. Untuk TTE, ikuti alur Provenance dan Task. |

Kelas IGD `reguler` menggunakan system `http://terminology.kemkes.go.id/CodeSystem/locationServiceClass-Outpatient`. Saat petugas atau lokasi berganti, pertahankan peserta/lokasi sebelumnya dan periode aktual. Untuk perpindahan dari IGD ke rawat inap, bedakan transisi `EMER → OBSENC` pada episode IGD dari keputusan admisi ke rawat inap. Hubungan referensi antar-Encounter atau permintaan admisi perlu diuji di Sandbox sesuai jalur yang dipilih. [Pendaftaran IGD](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/igd/#pendaftaran-kunjungan-pasien) · [Pembaruan IGD](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/igd/#_27_pembaruan_data_kunjungan) · [Pendaftaran Rawat Inap](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rawat-inap-new/#pendaftaran-kunjungan-pasien)

## Urutan pengiriman klinis

Alur di bawah dibaca dari atas. Kirim temuan independen sesudah Patient dan Encounter tersedia. Pastikan resource yang dirujuk telah memiliki ID sebelum mengirim dependent resource. Field dengan `*` per bab tersedia di [Field wajib per bab](../payload/profil-field-layanan.md).

| IGD | Rawat inap | Fungsi dan resource |
| --- | --- | --- |
| 3 | — | Triase menjadi Observation terpisah untuk sarana transportasi, surat pengantar dan kondisi saat tiba. Terapkan nilai yang benar-benar ditriase. |
| 4 | 3 | Keluhan dan riwayat penyakit melalui Condition, keluarga melalui FamilyMemberHistory, alergi melalui AllergyIntolerance dan riwayat obat melalui MedicationStatement. |
| 5–7 | 4–5 | Asesmen awal IGD atau fisik rawat inap, nyeri, risiko jatuh, pemeriksaan fungsional, skor dan status psikologis lewat Observation. Skrining IGD memakai Observation dan QuestionnaireResponse sesuai jenis skrining. Gunakan linkId kuesioner untuk instrumen yang dilakukan. |
| 8–11 | 6–9 | ClinicalImpression untuk perjalanan penyakit, Goal untuk tujuan, CarePlan untuk rencana dan instruksi medik/keperawatan. Instruksi rawat inap dapat berupa catatan harian. |
| 12–13 | 10–11 | Order, spesimen, hasil dan laporan dirinci pada [Lab](laboratorium-rujukan-spesimen.md) dan [Radiologi/DICOM](radiologi-dicom.md). Kaitkan ke Encounter dan hubungan order-hasil yang tepat. |
| 14–17 | 12–15 | ClinicalImpression untuk rasional klinis, Condition untuk diagnosis, RiskAssessment untuk penilaian risiko, Procedure untuk tindakan aktual. Kirim satu Condition per diagnosis, dengan kode ICD-10 dan padanan SNOMED CT bila dipetakan. Rawat inap mencakup Composition laporan tindakan/prosedur terapeutik pada kondisi terkait. |
| 18–21 | 16–19 | Resep MedicationRequest, pengkajian QuestionnaireResponse, penyerahan MedicationDispense, pemberian MedicationAdministration. Pemberian aktual memakai waktu, pelaku dan dosis aktual. Untuk obat kronis, cek aturan tambahan Playbook Rawat Inap saat menyusun regimen. [Matriks farmasi](../payload/matriks-farmasi.md) |
| — | 20–22 | NutritionOrder untuk diet yang diperintahkan; edukasi melalui Procedure. Permintaan, pengeluaran, penggunaan serta logistik ALKES mengikuti bagian di bawah. |
| 22–26 | 23–28 | Observation/CarePlan untuk perencanaan pulang, ClinicalImpression prognosis rawat inap, ServiceRequest untuk tindak lanjut dan transportasi rujuk, Condition/Encounter untuk kondisi pulang dan Encounter untuk cara keluar. Bab Rawat Inap 25 mencakup Surat Perintah Rawat Inap. |
| 27–28 | 29–30 | Finalisasi Encounter dengan ID balikan kemudian buat Composition. Baca balik keduanya serta periksa semua referensi resume. |

### Contoh Observation triase

Ketiga Observation menggunakan kategori `survey`, system `http://terminology.hl7.org/CodeSystem/observation-category`. Terapkan coding berikut sesuai data lokal, setelah tenaga kesehatan menyelesaikan penilaian. [IGD bab 3](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/igd/#data-triase-gawat-darurat)

| Fakta | `Observation.code` | `value[x]` |
| --- | --- | --- |
| Transportasi ke IGD | LOINC `74286-6` | `valueCodeableConcept`. Ambulans `LA9315-8` dan lainnya `LA46-8` dari LOINC. Mobil `71783008` dan motor `90748009` dari SNOMED CT. Teks bisa menyertai pilihan lain. |
| Ada surat pengantar rujukan | `OC000034` dari `http://terminology.kemkes.go.id/CodeSystem/clinical-term` | `valueBoolean`. |
| Kondisi triase | LOINC `75910-0` | `valueCodeableConcept`, LOINC `LA6112-2` resusitasi, `LA6113-0` emergensi, `LA6114-8` urgent, `LA6115-5` less urgent, `LA10137-0` non urgent. SNOMED CT `63238001` untuk death on arrival. |

```json
{
  "resourceType": "Observation",
  "status": "final",
  "category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "survey"}]}],
  "code": {"coding": [{"system": "http://loinc.org", "code": "75910-0"}]},
  "subject": {"reference": "Patient/<PATIENT>"},
  "encounter": {"reference": "Encounter/<ENCOUNTER_IGD>"},
  "effectiveDateTime": "2026-11-16T04:20:00Z",
  "performer": [{"reference": "Practitioner/<PETUGAS_TRIASE>"}],
  "valueCodeableConcept": {"coding": [{"system": "http://loinc.org", "code": "LA6114-8"}]}
}
```

### Rawat inap, kelas perawatan, dan ALKES

Untuk perubahan kelas perawatan, rekam Location, waktu pindah dan jenis perubahan. Contoh potongan baca balik menunjukkan konteks `IMP`; lengkapi payload update dari resource aktual sebelum PUT.

```json
{
  "resourceType": "Encounter",
  "id": "<ENCOUNTER_INAP>",
  "status": "in-progress",
  "class": {"system": "http://terminology.hl7.org/CodeSystem/v3-ActCode", "code": "IMP"},
  "subject": {"reference": "Patient/<PATIENT>"},
  "location": [{"location": {"reference": "Location/<RUANG_INAP>"}, "period": {"start": "2026-11-16T06:00:00Z"}}],
  "serviceProvider": {"reference": "Organization/<FASYANKES>"}
}
```

| Fakta alat | Resource dan field | Sumber dan gap |
| --- | --- | --- |
| Alat terdaftar | `Device.identifier` system `http://sys-ids.kemkes.go.id/device/{organization-id}`, `type.coding` KFA, status, produsen, seri, lot, lokasi dan pemilik sesuai fakta. | Petakan inventaris alat dan kode KFA ke masing-masing perangkat. |
| Permintaan, penyerahan, penggunaan | `DeviceRequest.codeReference` ke Device, subjek/Encounter, permintaan dan pelaksana. `DeviceDispense` menunjuk DeviceRequest pada `basedOn[]`, Device, Patient dan waktu serah. `DeviceUseStatement` menunjuk Device serta Patient, waktu penggunaan dan sumber. | Perlu catatan klinis request, dispenser, penerima dan durasi penggunaan. Pastikan kemampuan `DeviceDispense` dan versi/profilnya sesuai modul. |
| Stok dan perpindahan | `SupplyRequest` dan `SupplyDelivery` mengikat item, jumlah, sumber serta tujuan. Kategori persediaan `central`/`nonstock`, alasan `patient-care`/`ward-stock`, tipe penyerahan `device` untuk ALKES. | Peta jumlah dan satuan dari transaksi gudang dan area layanan. Simpan korelasi request dan serah. |

Kontrak publik menjelaskan field ALKES di Playbook. DeviceDispense hadir pada definisi dasar FHIR R5. Pastikan versi profil, wire field dan operasi yang diterima pada lingkungan modul sebelum mengirim payload perangkat. [Rawat Inap bab 22](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rawat-inap-new/#_22_pengiriman_data_alat_kesehatan) · [Kompatibilitas payload](../payload/kompatibilitas-payload-fhir.md#extension-dan-kontrak-modul) · [KFA](../endpoint/master-data-kfa.md)

### Terminologi skrining, prognosis, dan pulang

| Fakta | Field dan kode |
| --- | --- |
| Risiko dekubitus dan kuesioner skrining IGD | Observation memakai kategori `exam` dan SNOMED CT `285304000` untuk skrining dekubitus sesuai bab 6. Untuk pengkajian gizi sesuai instrumen pada bab itu, `QuestionnaireResponse.questionnaire=https://fhir.kemkes.go.id/Questionnaire/Q0008`; petakan dan validasi `linkId` serta setiap tipe jawaban pada versi instrumen yang dipakai. |
| Prognosis rawat inap | `ClinicalImpression.code` SNOMED CT `20481000`. Isi `prognosisCodeableConcept[]` dengan SNOMED CT `170968001` baik, `65872000` cenderung baik, `67334001` cenderung tidak baik, atau `170969009` tidak baik. |
| Kondisi klinis saat pulang | Condition dengan kategori `problem-list-item` dari `http://terminology.hl7.org/CodeSystem/condition-category`; kode SNOMED CT `359746009` stabil, `162668006` tidak stabil, `268910001` membaik. |
| Cara keluar | `Encounter.hospitalization.dischargeDisposition` memakai `http://terminology.hl7.org/CodeSystem/discharge-disposition` dengan `home` pulang disetujui, `aadvice` pulang atas permintaan sendiri, `other-hcf` rujuk, atau `oth` lainnya dalam skenario yang sesuai. Untuk waktu meninggal yang dipetakan, gunakan `exp-lt48h` atau `exp-gt48h` dari `http://terminology.kemkes.go.id/CodeSystem/discharge-disposition`. Cocokkan dua fakta lokal, kondisi saat keluar dan cara keluar, agar coding yang berbeda tidak saling menimpa. |

[Skrining IGD](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/igd/#pengiriman-data-skrining) · [Kondisi pulang IGD](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/igd/#_25_pengiriman_data_kondisi_saat_meninggalkan_rumah_sakit) · [Prognosis Rawat Inap](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rawat-inap-new/#_24_pengiriman_data_prognosis)
