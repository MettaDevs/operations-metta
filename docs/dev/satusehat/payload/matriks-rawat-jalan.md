# Matriks resource rawat jalan

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Resume Medis - Rawat Jalan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/) (v7.0, rilis 2026-01-10, disunting 2026-08-04) · [Encounter](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/encounter/) (disunting 2026-11-06) · [Condition](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/condition/) (disunting 2024-12-15)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md)

Matriks mencakup registrasi, pemeriksaan, diagnosis, dan resume. [Urutan implementasi kunjungan](../pengujian/prioritas-implementasi.md#2-kunjungan-dan-resume-tanpa-resep) · [Cara membaca matriks](aturan-field-fhir.md#cara-membaca-matriks)

[Encounter](#encounter) · [Condition](#condition) · [AllergyIntolerance](#allergyintolerance) · [Observation](#observation) · [Procedure](#procedure) · [ServiceRequest](#servicerequest) · [Composition](#composition)

## Encounter

Gunakan satu `POST /Encounter` per NoReg dan `PUT /Encounter/{id}` untuk finalisasi. Satu kunjungan dapat meliputi beberapa poli. Periksa minimum payload awal dan akhir secara terpisah. [Playbook pendaftaran](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_2_pendaftaran_kunjungan_pasien) · [Playbook pembaruan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_28_pembaharuan_data_kunjungan) · [Pemetaan lokal](../../../../modules/healthcare/README.md#pendaftaran-kunjungan) · [Migration waktu](../../../../modules/healthcare/database/migrations/0038_visit_times.sql) · [Profil Encounter](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/encounter/)

| Field | Aturan | Sumber di Operations Metta | Celah |
| --- | --- | --- | --- |
| `identifier[].system`, `.value` | W | `sim_tr_registrasi.no_reg`, `legal_entity_id` | Namespace `http://sys-ids.kemkes.go.id/encounter/{Organization_ID}` perlu ID nasional. Jaga kunci lokal stabil. |
| `id` | W saat `PUT` | ID balikan `POST` | Penyimpanan ID dan rekonsiliasi kirim ulang belum terverifikasi. |
| `status` | W | `sim_tr_registrasi.status` | Petakan `terdaftar` → `arrived`, `diperiksa` → `in-progress`, `selesai` → `finished`, `batal` → `cancelled`. Uji pembukaan kembali setelah rujuk internal. |
| `statusHistory[].status`, `.period.start`, `.period.end` | W pada histori status; waktu akhir mengikuti tahap | `sim_tr_registrasi.didaftarkan_pada`, `selesai_pada`, `batal_pada`; waktu mulai dan selesai tiap `sim_tr_registrasi_tujuan` | Definisikan riwayat yang bertahan saat kunjungan dibuka ulang. Uji data migrasi historis dan waktu kosong. |
| `class.system`, `.code` | W | Konstanta rawat jalan ketika use case berlaku | Isi `AMB` dari HL7 v3 `ActCode`. |
| `classHistory[].class`, `.period` | K bila `classHistory` dipakai; konfirmasi minimum per tahap | Jenis layanan lokal dan waktu kunjungan | Histori perubahan kelas belum terverifikasi. |
| `subject.reference` | W | `sim_tr_registrasi.pasien_id` | Resolve `Patient/{ihs}`. |
| `participant[].type`, `.individual.reference` | W untuk peserta yang dikirim; cek minimum saat registrasi tanpa jadwal | `sim_tr_registrasi_tujuan.nakes_id`, `sim_tr_pemeriksaan.dokter_id` dan `perawat_id` | Pemetaan peran peserta dan IHS. Bedakan nakes terjadwal dari pelaku aktual. |
| `period.start`, `.end` | W untuk periode. Akhir diisi saat selesai | `sim_tr_registrasi.didaftarkan_pada`, `selesai_pada` | Bentuk waktu UTC dan validasi urutannya. |
| `length` | K pada finalisasi sesuai profil | Selisih waktu awal dan akhir yang terverifikasi | Hitung durasi dalam satuan yang diminta, tanpa memakai waktu bayar. |
| `location[].location.reference`, `.period`, `.status` | W untuk referensi lokasi. Detail periode/status mengikuti tahap | `sim_tr_registrasi_tujuan.section_id`, `ruangan_id`, status serta waktu per tujuan | Petakan Location per poli/ruangan dan urutan rujuk internal. |
| `serviceProvider.reference` | W | `sim_tr_registrasi.legal_entity_id` | Resolve `Organization/{id}`. |
| `diagnosis[].condition.reference` | W saat mengirim elemen diagnosis. Isi saat finalisasi sesuai fakta | `sim_tr_pemeriksaan_diagnosa`; keluhan terkait pada `sim_tr_pemeriksaan` bila dipetakan ke Condition | Tunggu ID Condition yang diterima. Keluhan, diagnosis utama, dan diagnosis penyerta punya peran masing-masing. |
| `diagnosis[].use`, `.rank` | K sesuai pemetaan keluhan dan diagnosis | `sim_tr_pemeriksaan_diagnosa.jenis_id`, `urutan` | Petakan klasifikasi dan urutan lintas poli. |
| `hospitalization.dischargeDisposition` | K saat informasi cara keluar tersedia pada tahap akhir yang berlaku | `sim_tr_registrasi_tujuan.status_pulang_id`, `sim_m_status_pulang.kode_satusehat` | Lengkapi kode dan aturan memilih hasil akhir untuk banyak poli. Kondisi klinis pulang dapat memakai Condition terpisah. |
| `serviceType.coding`, `location[].extension` untuk kelas layanan | P menurut pelayanan dan kelas dalam Playbook | Jenis `sim_m_section`, organisasi, dan data kunjungan | Pemetaan kode tipe layanan serta kelas reguler/eksekutif belum terverifikasi. |
| Ekstensi `EncounterToFacility`, `EncounterToSpecialty`, `EncounterToEpisode` | P menurut tambahan v7.0 | `jenis_kunjungan` kandidat untuk status pengunjung; data section dan rujukan memberi konteks | Uji definisi baru dan lama pada fasyankes, serta status spesialisasi dan episode. Jangan turunkan ketiganya dari satu kolom. |

## Condition

`POST /Condition` untuk pola keluhan, riwayat pribadi, diagnosis, dan kondisi pulang sesuai bab masing-masing. Satu resource diagnosis per diagnosis, dengan kode ICD-10 dan padanan SNOMED CT sesuai Playbook. [Anamnesis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_3_pengiriman_data_anamnesis) · [Diagnosis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_13_pengiriman_data_diagnosis) · [Kondisi pulang](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_26_pengiriman_data_kondisi_saat_meninggalkan_rumah_sakit) · [Diagnosis di Metta](../../../../modules/healthcare/README.md#diagnosa-pemeriksaan) · [Profil Condition](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/condition/)

| Field | Aturan | Sumber di Operations Metta | Celah |
| --- | --- | --- | --- |
| `code.coding` untuk diagnosis | W | `sim_tr_pemeriksaan_diagnosa.icd10_id` → `sim_m_icd10.kode` dan `nama` | Padanan SNOMED CT belum terverifikasi. Simpan pasangan yang sah per diagnosis. |
| `code.coding` untuk keluhan dan riwayat pribadi | W jika dikirim sebagai Condition | `sim_tr_pemeriksaan.keluhan_utama` dan riwayat pada `sim_tr_pemeriksaan_riwayat_penyakit` | Teks klinis perlu coding sesuai skenario. Pemetaan teks bebas belum tersedia. |
| `code.coding` untuk keadaan klinis saat pulang | W jika kondisi seperti stabil, tidak stabil, atau perbaikan dikirim sebagai Condition | `sim_tr_registrasi_tujuan.keadaan_pulang_id` → `sim_m_keadaan_pulang` | Migration lokal mencatat bahwa kode SNOMED CT masih menyusul. |
| `category.coding`, `clinicalStatus.coding`, `verificationStatus` | K menurut tipe Condition dan profil | Jenis diagnosis, riwayat, atau pilihan keadaan pulang | Tetapkan coding untuk tiap tipe. Data riwayat teks bebas tidak membuktikan kondisi masih aktif atau sudah berakhir. |
| `subject.reference`, `encounter.reference` | W | Pasien dan kunjungan dari record pemeriksaan | Resolve Patient dan Encounter SATUSEHAT. |
| `onset[x]`, `recordedDate`, `recorder`/`asserter` | K/P sesuai fakta dan skenario | Lama keluhan dan nakes pada pemeriksaan atau diagnosis | Validasi perbedaan waktu onset dan waktu pencatatan. Pemetaan pelaku dan presisi onset belum disahkan. |
| `stage[].assessment` | K bila ada penilaian tahap yang direferensikan | Belum ditemukan sumber terstruktur untuk skenario ini | Perlu keputusan klinis dan ID penilaian yang sah sebelum dirujuk. |

## AllergyIntolerance

`POST /AllergyIntolerance` dari alergi yang benar-benar dicatat. Ikuti ketentuan Playbook untuk pernyataan tidak ada alergi atau status tidak diketahui. Koleksi kosong tidak cukup untuk menyimpulkan salah satunya. [Playbook Anamnesis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_3_pengiriman_data_anamnesis) · [Migration daftar alergi](../../../../modules/healthcare/database/migrations/0044_patient_allergy_list.sql) · [Profil AllergyIntolerance](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/allergy-intolerance/)

| Field | Aturan | Sumber di Operations Metta | Celah |
| --- | --- | --- | --- |
| `category[]` | W pada pemetaan alergi | `sim_m_pasien_alergi.kategori` | Cek pilihan `lainnya` dan aturan kategori FHIR. |
| `code.coding` | W | Alergen dari `alergi_id` atau `obat_id`, atau `nama` dengan teks bebas | Pemetaan kode nasional per alergen belum terverifikasi. |
| `patient.reference`, `encounter.reference` | W | `pasien_id`; `pemeriksaan_id` ke kunjungan yang mencatat alergi | Gunakan IHS dan ID Encounter saat dicatat. |
| `recorder.reference` | W | `dicatat_oleh_nakes_id`, disimpan saat kejadian | Bila nakes kosong, selesaikan pencatat sesuai fakta dan IHS-nya. |
| `reaction[].manifestation[]` | W ketika objek `reaction` dikirim | `reaksi` tersimpan sebagai teks | Perlu pemetaan terminologi atau bentuk teks yang diterima; jangan menciptakan reaksi. |
| `clinicalStatus.coding`, `verificationStatus`, `recordedDate` | K sesuai status dan profil | `status`, `dicatat_pada` | Petakan aktif/inaktif/sembuh dan bedakan status verifikasi. Status verifikasi belum punya sumber yang terverifikasi. |

## Observation

`POST /Observation` per pengukuran atau hasil sesuai skenario. Tabel ini untuk pemeriksaan fisik dan fungsional. Lab/radiologi punya variasi di [bagian penunjang](matriks-layanan-kondisional.md#lab-dan-radiologi). [Pemeriksaan fisik](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_4_pengiriman_data_hasil_pemeriksaan_fisik) · [Pemeriksaan fungsional](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_5_pengiriman_data_pemeriksaan_fungsional) · [Pemetaan LOINC dan UCUM di migration](../../../../modules/healthcare/database/migrations/0048_vital_sign_codes.sql) · [Profil Observation](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/observation/)

| Field | Aturan | Sumber di Operations Metta | Celah |
| --- | --- | --- | --- |
| `status` | W | Pemeriksaan tersimpan dan status konfirmasi klinis yang relevan | Tetapkan kapan nilai `final` sah dan bagaimana koreksi dikirim. |
| `code.coding.system`, `.code` | W | Komentar kolom pada migration `0048` untuk tanda vital | Ubah pemetaan menjadi sumber yang dapat dipakai pengirim dan uji coverage per kolom. |
| `category[].coding` | K menurut pemetaan pemeriksaan | Jenis field yang dipetakan, misalnya tanda vital | Gunakan kategori yang sesuai tiap pengukuran, bukan satu kategori untuk semua. |
| `subject.reference`, `encounter.reference` | W | Header pemeriksaan dan registrasi | Referensi nasional perlu tersedia. |
| `performer[].reference` | W | `sim_tr_pemeriksaan_fisik.diukur_oleh_nakes_id` | IHS pengukur dan penanganan data lama atau pengukur kosong. |
| `effectiveDateTime` atau `effectivePeriod` | K sesuai tipe pengukuran | `sim_tr_pemeriksaan_fisik.diukur_pada`; data tinggi/berat saat daftar punya konteks registrasi sendiri | Bedakan waktu yang dicatat pada pengukuran dari waktu entri. Pemetaan pelaku untuk pengukuran pendaftaran perlu diperiksa. |
| `valueQuantity.value`, `.unit`, `.system`, `.code` | K untuk hasil numerik | `sistole`, `diastole`, `nafas`, `detak_nadi`, `suhu`, dan kolom lain yang dipetakan di `0048` | Pertahankan nilai klinis dan UCUM yang tepat. Uji hasil yang benar-benar kosong serta konfigurasi field wajib per section. |
| `valueCodeableConcept`, `component[]`, `dataAbsentReason` | K menurut jenis hasil dan profil | `kesadaran`, status fisik, serta panel pemeriksaan yang berlaku | Siapkan pemetaan nilai kualitatif dan komponen. Kirim alasan data tidak ada hanya jika ada dasar yang sah. |

## Procedure

`POST /Procedure` dari fakta tindakan yang dilakukan. Untuk permintaan dan hasil diagnostik, lihat `ServiceRequest` dan `Observation`. [Playbook tindakan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_15_pengiriman_data_tindakanprosedur_medis) · [Master dan transaksi tindakan Metta](../../../../modules/healthcare/README.md#biaya-tindakan-dan-e-resep) · [Profil Procedure](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/procedure/)

| Field | Aturan | Sumber di Operations Metta | Celah |
| --- | --- | --- | --- |
| `status` | W | Baris `sim_tr_pemeriksaan_tindakan` dan konteks pemeriksaan | Tetapkan status tindakan yang benar. Selesai bayar tidak membuktikan tindakan selesai. |
| `code.coding.system`, `.code`, `.display` | W | `sim_m_tindakan.kode_icd9cm`, nama tindakan; catatan `sim_tr_pemeriksaan_lainnya.edukasi` untuk skenario edukasi | Bedakan jasa tarif dari tindakan klinis. Lengkapi ICD-9-CM untuk tindakan dan terminologi yang ditetapkan untuk edukasi. |
| `subject.reference`, `encounter.reference` | W | `sim_tr_pemeriksaan_tindakan.pemeriksaan_id` ke pasien dan kunjungan | Resolve referensi SATUSEHAT. |
| `performer[].actor.reference` | W pada pemetaan pelaku tindakan | `sim_tr_pemeriksaan_tindakan.dokter_id` bila terisi | Petakan pelaku aktual, termasuk skenario nakes selain dokter. |
| `performed[x]`, `category.coding` | K sesuai tipe tindakan | Pemeriksaan menyimpan rentang waktu poli. Tindakan punya baris dan metadata pencatatan | Waktu mulai/selesai aktual per tindakan belum terverifikasi. Jangan menggantinya dengan timestamp simpan. |
| `reasonReference[]`, `basedOn[]` | K bila diagnosis atau permintaan terkait ada | `sim_tr_pemeriksaan_tindakan.diagnosa_id`; alur order penunjang belum terverifikasi | Tunggu ID `Condition` atau `ServiceRequest`, sesuai relasinya. |
| `focalDevice[].manipulated`, `usedCode[]` | K pada skenario yang memakai alat atau bahan sesuai profil | Data BMHP atau barang lokal memberi konteks | Belum ditemukan hubungan terstruktur ke Device atau terminologi pemakaian yang diperlukan. |

Untuk laporan tindakan yang berlaku, Playbook membedakan permintaan `ServiceRequest`, pelaksanaan `Procedure`, hasil `Observation`, dan dokumen laporan `Composition`. Tabel laporan tindakan memberi tipe LOINC `28570-0`. Pakai tipe dan section varian yang sesuai dengan tindakan. Jika data anestesi, komplikasi, atau temuan pascatindakan belum tercatat di Metta, masukkan sumber dan pemetaannya ke backlog sebelum mengaktifkan skenario tersebut. Uji laporan tindakan pada SB-02 bila layanan fasyankes mencakupnya. [Playbook bab 15](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_15_pengiriman_data_tindakanprosedur_medis) · [SB-02](../pengujian/skenario-sandbox.md#sb-02-temuan-klinis-kondisional)

## ServiceRequest

`POST /ServiceRequest` untuk permintaan penunjang, rencana tindak lanjut, atau rujukan yang berlaku. Pemicu dan field berbeda per skenario. [Rencana tindak lanjut](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_24_pengiriman_data_rencana_tindak_lanjut) · [Instruksi dan transportasi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_25_pengiriman_data_instruksi_untuk_tindak_lanjut_sarana_transportasi_untuk_rujuk) · [Rujukan di Metta](../../../../modules/healthcare/README.md#status-pasien-rujuk-internal-dan-cppt) · [Profil ServiceRequest](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/service-request/)

| Field | Aturan | Sumber di Operations Metta | Celah |
| --- | --- | --- | --- |
| `status`, `intent`, `code` | W | `sim_tr_registrasi_tujuan.status_pulang_id`, tujuan rujuk, `kontrol_ulang`, atau kebutuhan pemeriksaan yang relevan | Petakan status, intent, dan kode per order/tindak lanjut. Baris kunjungan saja belum membuktikan order lab atau radiologi. |
| `subject.reference`, `encounter.reference` | W | Tujuan ke registrasi dan pasien | Resolve referensi nasional. |
| `requester`, `performer` | W pada pemetaan lab/radiologi; `performer` juga ditandai pada instruksi rujuk. K untuk skenario lain sesuai profil | Nakes pemeriksa, `dokter_konsul_id`, atau tujuan layanan | Pemetaan nakes/fasyankes tujuan dan perannya belum terverifikasi. |
| `identifier[]`, `authoredOn`, `occurrence[x]` | K sesuai skenario | `no_bukti`, waktu tujuan dibuat, `tanggal_kontrol` | Pisahkan nomor order dan waktu request dari nomor atau waktu kunjungan. Order penunjang perlu sumber sendiri. |
| `category`, `priority`, `supportingInfo`, `reasonReference` | K, dengan `category` ditandai untuk radiologi | Diagnosis, skrining, kondisi kehamilan, dan alergi pada proses klinis jika relevan | Perlu kategori/order, prioritas, status puasa, dan kode permintaan yang spesifik. |
| `locationReference`, `locationCode`, `patientInstruction`, `note` | K pada skenario rujuk/tindak lanjut | `section_id`, `rujuk_eksternal_tujuan`, `rujuk_eksternal_poli`, `rujuk_eksternal_alasan`, `catatan_rujukan` | Petakan tujuan ke ID nasional. Jenis transportasi dan instruksi terstruktur belum terverifikasi. |

## Composition

`POST /Composition` untuk resume rawat jalan. Jika ada laporan tindakan terapetik, ikuti tipe dan bagian dari bab tindakan. Resume memakai LOINC `88645-7`. [Playbook Resume Medis](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_29_pengiriman_data_resume_medis) · [Profil Composition](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/composition/) · [Sumber CPPT](../../../../modules/healthcare/README.md#status-pasien-rujuk-internal-dan-cppt)

| Field | Aturan | Sumber di Operations Metta | Celah |
| --- | --- | --- | --- |
| `status`, `type.coding`, `title` | W | Jenis dokumen dan status final yang akan ditetapkan | Belum ditemukan pembentuk resume dan finalisasi dokumen FHIR. |
| `subject.reference` | W | Pasien di `sim_tr_registrasi` | Resolve Patient IHS. |
| `encounter.reference` | K menurut profil; isi pada resume rawat jalan ini | Satu NoReg dan ID balikan Encounter | Kaitkan ke Encounter yang sudah diterima sesuai alur. |
| `date`, `author[]` | W | Waktu klinis dan nakes pada pemeriksaan; calon sumber | Tetapkan waktu finalisasi resume dan siapa penulis/pengesah bila ada beberapa poli. Resolve IHS penulis. |
| `section[].code.coding`, `.entry[].reference`, `.text` | K sesuai section yang berlaku; petakan sesuai Playbook | Data kunjungan, CPPT, diagnosis, hasil, tindakan, obat, dan rujukan | Susun section dan rujuk ID SATUSEHAT berdasarkan kategori. CPPT menyediakan data klinis, sementara payload resume masih perlu dibangun. |
| `attester[].mode`, `.time`, `.party` | K ketika attester dikirim; `mode` ditandai wajib di dalamnya | Belum ditemukan fakta pengesahan resume | Definisikan pengesahan dan sumber identitas sah. |
| `relatesTo[].code`, `.target[x]` | K untuk relasi versi/koreksi; keduanya wajib dalam `relatesTo` | ID resume sebelumnya setelah penerimaan | Tentukan revisi yang sah dan simpan referensi versi yang dikoreksi. |

### Kode section resume

Gunakan sistem `http://terminology.kemkes.go.id` untuk kode `TK...` dan `http://loinc.org` untuk kode LOINC di tabel. Susun subsection hanya pada bagian yang berlaku. Setiap `entry` memakai ID resource SATUSEHAT yang sudah tersedia. Kategori resume pada Playbook memakai LOINC `LP173421-1`. [Playbook bab 29](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_29_pengiriman_data_resume_medis) · [Contoh payload](contoh-rawat-jalan-dan-farmasi.md#resume-medis)

| Section | Kode atau subsection | Sumber referensi |
| --- | --- | --- |
| Anamnesis | `TK000003`. Keluhan utama `10154-3`, keluhan penyerta `11450-4`, alergi `48765-2`, riwayat pribadi terdahulu `11348-0`, riwayat saat ini `10164-2`, riwayat keluarga `10157-6`, riwayat obat `10160-0` | Condition, AllergyIntolerance, FamilyMemberHistory, dan MedicationStatement sesuai subsection. |
| Pemeriksaan fisik | `TK000007`. Tanda vital `8716-3` dan pemeriksaan head to toe `10187-3` | Observation dari pengukuran atau pemeriksaan aktual. |
| Pemeriksaan fungsional | `47420-5` | Observation temuan fungsional yang berlaku. |
| Perencanaan perawatan | `18776-5` | ClinicalImpression, Goal, dan CarePlan sesuai data rencana atau instruksi. |
| Penunjang | `TK000009`. Lab `11502-2` dan radiologi `18782-3` | Referensi order, spesimen, hasil, dan laporan yang sesuai dengan layanan. |
| Diagnosis | `TK000004`. Diagnosis awal `42347-5` dan akhir `78375-3` | Condition sesuai tahap. Diagnosis akhir juga bisa merujuk ClinicalImpression dan RiskAssessment yang berlaku. |
| Tindakan | `TK000005` | ServiceRequest, Procedure, atau Observation untuk permintaan, pelaksanaan, dan hasil. |
| Farmasi | `TK000013`. Obat saat kunjungan `42346-7` dan obat pulang `75311-1` | MedicationRequest, MedicationDispense, dan MedicationAdministration sesuai subsection. |
| Diet | Kelompok Diet dengan subsection rekomendasi `42344-2` dan diet yang diberikan `61144-2` | NutritionOrder dengan `intent` sesuai jenis diet. Tabel Playbook menamai kelompok Diet tanpa mencantumkan kode section induk. |
| Edukasi | `34895-3` | Procedure edukasi. |
| Kondisi pulang | `10184-0` | ClinicalImpression prognosis dan Condition terkait pulang. |
| Tindak lanjut | `8653-8` | Observation, CarePlan, dan ServiceRequest sesuai alur. |
| Perjalanan kunjungan | `8648-8` | Narasi pada `section.text` berdasarkan fakta yang tercatat. |
