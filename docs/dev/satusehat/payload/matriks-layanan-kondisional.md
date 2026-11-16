# Matriks resource layanan kondisional

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Resume Medis - Rawat Jalan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/) (v7.0, rilis 2026-01-10, disunting 2026-08-04) · [FamilyMemberHistory](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/family-member-history/) (disunting 2024-12-15) · [MedicationStatement](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/medication-statement/) (disunting 2024-12-15)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md)

Gunakan bagian yang sesuai dengan layanan fasyankes dan fakta yang dicatat. [Urutan implementasi layanan kondisional](../pengujian/prioritas-implementasi.md#4-variasi-rawat-jalan-dan-layanan-kondisional) · [Cara membaca matriks](aturan-field-fhir.md#cara-membaca-matriks)

## Anamnesis dan rencana perawatan

Matriks ini berlaku ketika temuan atau rencana tersebut dicatat. Kolom **P** dan celah berikut belum menjadi kontrak pengiriman Metta. [Panel rekam medis di Metta](../../../../modules/healthcare/README.md#rekam-medis-pemeriksaan) · [Skema sumber pemeriksaan](../../../../modules/healthcare/database/migrations/0021_examination_record.sql)

### FamilyMemberHistory

[Playbook Anamnesis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_3_pengiriman_data_anamnesis) · [Profil FamilyMemberHistory](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/family-member-history/)

| Field | Aturan | Sumber di Operations Metta | Celah |
| --- | --- | --- | --- |
| `status`, `patient.reference` | W | Pasien dan catatan riwayat pada pemeriksaan | Status penyelesaian riwayat dan IHS belum terverifikasi. |
| `relationship.coding`, `condition[].code` | W. Kode kondisi berlaku pada baris kondisi | `sim_tr_pemeriksaan_riwayat_penyakit.riwayat_keluarga` adalah narasi | Hubungan keluarga dan diagnosis anggota keluarga belum dipisah menjadi field terstruktur. |
| `condition[].onset[x]`, `.outcome`, `.contributedToDeath` | K jika fakta tersebut dicatat | Narasi keluarga bila memuat fakta | Catat terstruktur dan jangan menurunkan outcome dari teks tanpa validasi klinis. |

### MedicationStatement

[Playbook Riwayat Pengobatan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_3_pengiriman_data_anamnesis) · [Profil MedicationStatement](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/medication-statement/)

| Field | Aturan | Sumber di Operations Metta | Celah |
| --- | --- | --- | --- |
| `status`, `medication[x]`, `subject.reference` | W | Pasien tersedia. `sim_tr_pemeriksaan_lainnya.terapi_obat` berupa narasi terapi | Belum ditemukan sumber riwayat obat pasien dengan status penggunaan dan produk terpisah. Resep baru tidak membuktikan pasien sudah menggunakan obat. |
| `effective[x]`, `dateAsserted`, `informationSource`, `note` | K/P menurut profil dan fakta yang dicatat | Narasi pemeriksaan dapat memberi konteks | Perlu waktu pemakaian, sumber informasi, dan catatan terverifikasi. |

### ClinicalImpression

[Perjalanan penyakit](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_6_pengiriman_data_riwayat_perjalanan_penyakit) · [Rasional klinis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_12_pengiriman_data_rasional_klinis) · [Prognosis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_23_pengiriman_data_prognosis) · [Profil ClinicalImpression](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/clinical-impression/)

| Field | Aturan | Sumber di Operations Metta | Celah |
| --- | --- | --- | --- |
| `status`, `subject`, `encounter` | W pada profil Playbook untuk skenario ini | Pemeriksaan yang dinilai, pasien, dan registrasi | Tetapkan fakta kapan penilaian selesai dan resolve referensi. |
| `code`, `summary`, `assessor` | K menurut tipe penilaian | `riwayat_sekarang`, nakes pemeriksa, CPPT | Pastikan narasi benar mewakili perjalanan penyakit atau rasional nakes. Rasional terstruktur belum terverifikasi. |
| `investigation[].code`, `.item[]`, `problem[]` | K untuk penunjang dan masalah yang dirujuk. Kode wajib jika kelompok terkait dikirim | Diagnosis dan data pemeriksaan yang relevan | Petakan kelompok investigasi dan referensi hasil yang sudah diterima. |
| `prognosisCodeableConcept[]`, `prognosisReference[]` | K untuk skenario prognosis atau penilaian yang dirujuk | `sim_tr_pemeriksaan.prognosa_id` | Pemetaan SNOMED CT prognosis dan referensi penilaian risiko belum terverifikasi. |

### Goal

[Playbook Tujuan Perawatan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_7_pengiriman_data_tujuan_perawatan) · [Profil Goal](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/goal/)

| Field | Aturan | Sumber di Operations Metta | Celah |
| --- | --- | --- | --- |
| `lifecycleStatus`, `description`, `subject` | W | Pasien ada. `sim_tr_pemeriksaan_lainnya.rencana` dapat memberi konteks | Target perawatan dan statusnya belum diverifikasi sebagai record terpisah. |
| `addresses`, `target[].measure`, `.detail[x]`, `.due[x]`, `achievementStatus`, `expressedBy` | K menurut jenis tujuan dan target | Diagnosis terkait dan narasi rencana | Perlu ukuran target, batas waktu, dan pelaku yang menyatakan tujuan. |

### CarePlan

[Rencana rawat](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_8_pengiriman_data_rencana_rawat_pasien) · [Instruksi medik dan keperawatan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_9_pengiriman_data_instruksi_medik_dan_keperawatan) · [Profil CarePlan](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/care-plan/)

| Field | Aturan | Sumber di Operations Metta | Celah |
| --- | --- | --- | --- |
| `status`, `intent`, `title`, `description` | W pada pemetaan rencana rawat | `sim_tr_pemeriksaan_lainnya.rencana`, `tindakan_keperawatan`, dan catatan terapi | Teks lokal tersedia. Status, tujuan penggunaan, dan pemisahan rencana dari instruksi perlu keputusan. |
| `subject`, `encounter`, `author` | W pada pemetaan rencana rawat | Pasien, registrasi, dan nakes pemeriksa | Resolve referensi dan konfirmasi siapa penulis rencana. |
| `category`, `goal[]`, `activity[].detail.status` | K sesuai jenis dan aktivitas. `status` ditandai pada `detail` | Narasi rencana dan aktivitas; `Goal` belum terverifikasi | Butuh kode kategori, relasi Goal, dan status per aktivitas. |

### RiskAssessment

[Playbook Penilaian Risiko](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_14_pengiriman_data_penilaian_risiko) · [Profil RiskAssessment](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/risk-assessment/)

| Field | Aturan | Sumber di Operations Metta | Celah |
| --- | --- | --- | --- |
| `status`, `subject` | W | Pasien dan `sim_tr_pemeriksaan_risiko_jatuh` untuk risiko jatuh | Validasi skenario dan status penilaian. Jangan gunakan tabel ini untuk semua jenis risiko. |
| `code`, `encounter`, `performer`, `condition`, `reasonReference` | K/P menurut skenario | Pemeriksaan dan diagnosis bila relasinya sah | Tetapkan kode jenis penilaian, pelaku aktual, dan sumber alasan. |
| `prediction[].outcome`, `.probability[x]`, `.qualitativeRisk`, `.when[x]`, `mitigation` | K sesuai hasil yang dinilai | Nilai atau hasil panel risiko yang memang dicatat | Pemetaan skor, kategori, dan proyeksi periode belum terverifikasi. |

## Lab dan radiologi

Metta memiliki section penunjang dan sebagian konteks klinis. Rangkaian order, pengambilan spesimen, hasil penunjang, dan integrasi DICOM belum terverifikasi di repo ini. Gunakan rujukan tiap resource untuk field tambahan menurut layanan. [Playbook Lab](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_10_pengiriman_data_pemeriksaan_penunjang_laboratorium) · [Playbook Radiologi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_11_pengiriman_data_pemeriksaan_penunjang_radiologi) · [Lab dan rujukan spesimen](../alur/laboratorium-rujukan-spesimen.md) · [Radiologi dan DICOM Router](../alur/radiologi-dicom.md)

| Resource dan field | Aturan | Sumber di Operations Metta | Celah |
| --- | --- | --- | --- |
| [`ServiceRequest`](matriks-rawat-jalan.md#servicerequest) — `status`, `intent`, `code`, `subject`, `encounter`, `requester`, `performer` | W pada order lab/radiologi | Konteks kunjungan, pasien, dan nakes | Belum ada sumber order penunjang terverifikasi untuk mengisi kode order, pelaku, dan status faktual. |
| `ServiceRequest.category`, `.identifier`, `.supportingInfo` | `category` W untuk pemetaan radiologi. Lainnya K menurut skenario | Alergi, skrining, dan data pendaftaran memberi konteks | Perlu accession number untuk skenario radiologi yang berlaku, dan data penunjang seperti status puasa saat diminta. |
| [`Specimen`](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/specimen/) — `status`, `type`, `subject` | W pada pengiriman spesimen | Pasien tersedia | Jenis, status, dan ID spesimen belum ditemukan. |
| `Specimen.collection`, `.processing`, `.request` | K sesuai pengambilan, pemrosesan, atau order terkait | Belum terverifikasi | Perlu waktu dan pelaku pengambilan, kode spesimen, relasi order, serta pemrosesan bila ada. |
| [`Substance`](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/substance/) — `status`, `category`, `code`, `instance.quantity` | W untuk status, kategori, dan kode ketika Substance dikirim. Jumlah K | Belum ditemukan fakta bahan tambahan spesimen | Catat bahan aktual pada skenario yang membutuhkannya. |
| [`Observation`](matriks-rawat-jalan.md#observation) — `status`, `code`, `subject`, `encounter`, `performer`, `value[x]` dan `issued` | W pada hasil penunjang sesuai daftar bab. `issued` ditandai untuk bacaan radiologi | Pasien dan kunjungan ada | Hasil terukur atau narasi, satuan, pemeriksa, dan waktu publikasi penunjang belum terverifikasi. |
| `Observation.basedOn`, `.specimen`, `.derivedFrom`, `.referenceRange`, `.interpretation` | K menurut skenario lab/radiologi | Belum ditemukan rekam hasil penunjang yang memegang relasi ini | Hubungkan ke order, spesimen, atau studi citra, dan petakan interpretasi yang disahkan. |
| [`DiagnosticReport`](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/diagnostic-report/) — `basedOn`, `status`, `code`, `subject`, `encounter`, `performer`, `result` | W pada laporan penunjang | Konteks pasien dan kunjungan | Belum ada sumber laporan terverifikasi dan referensi hasil yang sudah diterima. |
| `DiagnosticReport.specimen`, `.imagingStudy`, `.conclusion` | W sesuai bab yang berlaku. Spesimen untuk lab; studi citra dan kesimpulan untuk radiologi yang memerlukannya | Tidak ditemukan sumber yang terverifikasi | Perlu relasi ke spesimen atau citra serta kesimpulan tenaga yang berwenang. |
| [`ImagingStudy`](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/imaging-study/) — `identifier[]`, `status`, `modality`, `subject`, `started`, `basedOn`, `endpoint`, `series[].uid`, `series[].modality` | W untuk skenario DICOM yang dipetakan Playbook | Pasien dan kunjungan ada. PACS/DICOM router belum terverifikasi | Perlu UID studi dan seri, order sumber, serta endpoint hasil integrasi NIDR. |

## Pemberian obat, diet, dan alat kesehatan

Bagian ini berlaku bila klinik menjalankan layanan tersebut. Pilih jenis resource berdasarkan fakta layanan. Untuk alat kesehatan, uji dukungan endpoint dan versi profil yang benar di Sandbox sebelum mengasumsikan setiap resource dapat dipanggil lewat jalur FHIR yang sama. [Pemberian obat](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_19_pengiriman_data_pemberian_obat) · [Diet](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_20_pengiriman_data_diet) · [Alat kesehatan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_22_pengiriman_data_alat_kesehatan)

| Resource dan field | Aturan | Sumber di Operations Metta | Celah |
| --- | --- | --- | --- |
| [`MedicationAdministration`](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/medication-administration/) — `status` | W | Fakta pemberian ke pasien belum ditemukan | `MedicationDispense` membuktikan obat diserahkan. Butuh catatan pemberian aktual untuk resource ini. |
| `MedicationAdministration.medication[x]`, `.subject`, `.effective[x]`, `.context`, `.performer`, `.dosage` | P/K menurut profil dan fakta pemberian. Validasi kardinalitas FHIR R4 untuk obat, subjek, dan waktu efektif | Pasien, kunjungan, dan resep dapat menjadi referensi | Waktu, dosis yang diberikan, dan pelaku aktual belum terverifikasi. |
| [`NutritionOrder`](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/nutrition-order/) — `status`, `intent`, `patient`, `encounter`, `dateTime` | W pada pemetaan diet Playbook | Pasien dan kunjungan ada | Belum ditemukan order diet dengan status, intent, dan waktu order. |
| `NutritionOrder.orderer`, `.oralDiet`, `.supplement`, `.enteralFormula` | K sesuai jenis order diet | Tidak ditemukan order diet terstruktur | Perlu sumber order, kategori diet, komposisi, dan instruksi gizi. |
| `Device.deviceName[].name`, `.type`; `Device.type` | W saat mengirim Device menurut Playbook | `gd_m_barang` bisa memberi identitas barang | Perlu identitas perangkat dan tipe perangkat yang sah. Master barang belum cukup untuk mengidentifikasi satu perangkat klinis. |
| `Device.identifier`, `.udiCarrier`, `.serialNumber`, `.lotNumber` | K sesuai perangkat dan profil | Kode barang, batch, atau serial bila tercatat di persediaan | Konfirmasi cakupan UDI serta tautan ke perangkat yang benar-benar dipakai. |
| `DeviceRequest.intent`, `.code[x]`, `.subject`, `.encounter` | W pada pemetaan permintaan alat | Pasien dan registrasi tersedia | Belum ditemukan order klinis alat beserta produk atau jenis dan intent-nya. |
| `DeviceDispense.basedOn`, `.status`, `.device`, `.subject` | W pada pemetaan penyerahan alat di Playbook | Persediaan menyimpan pengeluaran barang | Perlu catatan penyerahan alat ke pasien dan referensi order/perangkat. Konfirmasi dukungan profil dan endpoint. |
| `DeviceUseStatement.status`, `.subject`, `.device` | W pada pemetaan pemakaian alat | Catatan pemeriksaan atau BMHP memberi konteks | Belum ditemukan fakta pemakaian alat per pasien dengan status dan identitas perangkat. |
| `SupplyRequest.item[x]`, `.quantity` | `item[x]` W menurut Playbook. Konfirmasi `quantity` terhadap profil FHIR yang aktif | Barang tersedia di Core | Sumber permintaan klinis dan jumlah per kejadian belum terverifikasi. |
| `SupplyDelivery.basedOn`, `.suppliedItem`, `.occurrence[x]` | `basedOn` W menurut Playbook. Sisanya K sesuai pengiriman | Persediaan menyimpan barang dan pergerakannya | Belum ditemukan pengaitan pergerakan dengan permintaan SATUSEHAT, penerima, dan waktu serah klinis. |
