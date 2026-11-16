# Pelaporan kematian maternal, perinatal, dan SMPK

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Kematian Maternal dan Perinatal](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/mpdn/) (v1.4, rilis 2024-09-06, disunting 2025-10-02) · [Sertifikat Medis Penyebab Kematian (SMPK)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/smpk/) (v1.5, rilis 2026-09-09, disunting 2026-09-10)

[Indeks SATUSEHAT](../README.md) · [Alur layanan](README.md)

MPDN mencatat notifikasi awal kematian maternal dan perinatal. SMPK mencatat informasi sertifikasi penyebab kematian melalui formulir dokter dan proses verifikasi kode. Keduanya memakai data pasien, lokasi, kematian dan riwayat klinis yang beririsan. Simpan ID, tipe Composition, status dan pelaku untuk masing-masing. Acuan adalah MPDN v1.4 (6 September 2024) dan SMPK v1.5 (9 September 2026). [Playbook MPDN](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/mpdn/) · [Playbook SMPK](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/smpk/) · [Buku publik SMPK v1.5](https://drive.google.com/file/d/1zJiGu4T99iv4I3mY67iyHZuqGPCIWqhN/preview)

[Prasyarat dan data Metta](#prasyarat-dan-data-metta) · [MPDN](#mpdn) · [SMPK](#smpk) · [HTTP, keamanan, dan kriteria uji](#http-keamanan-dan-kriteria-uji)

## Prasyarat dan data Metta

- Resolve Patient, IHS Practitioner, Organization dan Location yang berwenang. Untuk perinatal, pisahkan IHS ibu dan bayi, termasuk registrasi bayi baru lahir bila belum ada. Tentukan konteks peristiwa, tempat kejadian, pelapor, dan Encounter yang sah jika disyaratkan skenario. [MPI](../endpoint/master-data-pasien.md) · [Data Kelahiran](data-kelahiran-dan-akta.md)
- Metta sudah punya registrasi, pemeriksaan, diagnosis dan keadaan saat pulang. Catatan waktu dan lokasi kematian, hubungan ibu–bayi, penyebab dan interval kronologis, laporan notifikasi, serta formulir sertifikasi masih perlu sumber terstruktur dan otorisasi yang diverifikasi. [Status pasien Metta](../../../../modules/healthcare/README.md#status-pasien-rujuk-internal-dan-cppt)
- Laporan klinis berasal dari petugas atau dokter yang berwenang menurut modul. Gunakan riwayat rekam medis dan formulir yang benar-benar diisi. Data verifikasi kode berasal dari Tim Sentral Koder Kemenkes pada alur SMPK.

## MPDN

| Cabang | Flow dan referensi | Composition |
| --- | --- | --- |
| Kematian ibu | Resolve Patient ibu dan konteks Encounter menurut tempat/peristiwa. Cari atau buat Location kejadian bila perlu. Kirim fakta kematian dan riwayat kehamilan yang tersedia. | `COM000001` dengan section LOINC `64297-5` untuk informasi kematian dan `57073-9` untuk riwayat kehamilan. |
| Bayi lahir mati | Resolve IHS ibu dan bayi; jalankan MPI bayi baru lahir jika dibutuhkan. Pada alur dengan Encounter persalinan ibu, `Observation.subject` adalah ibu. Untuk riwayat kematian bayi dan riwayat persalinan selain cara persalinan, isi `Observation.focus[]` dengan bayi. Isi referensi ibu/bayi pada bagian Composition sesuai tabel bab lahir mati. | `COM000002`; section kematian bayi memakai `64297-5` dan riwayat persalinan `15508-5`. |
| Bayi lahir hidup | Resolve IHS keduanya. Gunakan Encounter yang sesuai data perawatan. Untuk skenario kematian bayi di luar fasilitas, saat rujukan, atau DOA, Playbook memberi kondisi ketika Encounter bayi tidak diperlukan. Cocokkan subjek dan `focus` pada tiap Observation dan bagian laporan sesuai bab. | `COM000003`; gunakan section kematian bayi dan persalinan sebagaimana profil ini. |

Tipe Composition menggunakan `http://terminology.kemkes.go.id/CodeSystem/composition-type`. Notifikasi awal memakai `Composition.status=preliminary` dan event SNOMED CT `445667001` untuk data diterima pada tabel modul. Rujukan `Composition.section.focus` muncul sebagai panduan pemetaan subjek bagian, sementara elemen itu perlu verifikasi terhadap profil dan bentuk JSON koleksi yang aktif. Diagnosis administratif default `Z02.9` pada Condition menggunakan `http://hl7.org/fhir/sid/icd-10` sesuai Bab MPDN. Gunakan kode itu dalam skenario notifikasi yang ditetapkan. Catat penyebab klinis dari sumbernya. [Kematian ibu](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/mpdn/#_1_pelaporan_kematian_ibu) · [Kematian bayi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/mpdn/#_2_pelaporan_kematian_bayi)

Urutan teknis yang perlu dijaga adalah identitas dan Encounter bila digunakan, lokasi dan fakta klinis, lalu Composition yang menunjuk fakta terkait. PATCH Patient untuk alamat domisili hanya mengikuti skenario yang mengizinkannya. Simpan alamat kejadian pada Location dan tautkan sesuai profil, karena alamat kejadian merupakan fakta tersendiri. Catat Condition dan finalisasi Encounter dengan ID balikan melalui PUT bila alur memiliki Encounter.

## SMPK

| Urutan | Fakta dan operasi | Kontrak output |
| --- | --- | --- |
| 1–2 | Resolve Patient dan dokter, buat atau gunakan Encounter yang relevan. Buku SMPK v1.5 meminta Encounter pada konteks sertifikasi. | Simpan ID Patient, Practitioner, Encounter dan Organization dokter/fasyankes. |
| 3.1 | Catat tempat, tanggal dan waktu kematian, usia, DOA dan cara kematian. Gunakan Observation dan Location sebagaimana profil. | Section Kemenkes `TK000258` merujuk detail tersebut. |
| 3.2 | Bila penyebab eksternal berlaku, catat waktu, deskripsi dan tempat sesuai temuan yang sah. | Section LOINC `11374-6` menunjuk Observation terkait. |
| 3.3 | Bila kematian janin atau bayi, catat konteks kelahiran, usia gestasi, berat, masa hidup dan kondisi ibu sesuai data. | Section SNOMED CT `276507005` menunjuk Observation. |
| 3.4 | Bila skenario mengharuskan, catat riwayat kehamilan yang relevan dan kaitannya dengan kematian. | Section Kemenkes `TK000271` menunjuk Observation. |
| 3.5 | Kirim penyebab langsung dan rantai akibat yang dinyatakan dokter sebagai Observation. Gunakan komponen nomor baris dan interval sesuai pemetaan. | Section LOINC `79378-6`. Contoh Observation memakai `code=79378-6`, `valueString` untuk uraian penyebab dan `component` Kemenkes `line-number` bertipe integer. Interval `69440-6` berasal dari LOINC. |
| 3.6 | Jika berlaku, kirim fakta operasi atau autopsi dan hasil medis lain yang dirinci dalam panduan. | Section LOINC `69441-4` menunjuk Observation terkait. |
| 4–5 | `POST /fhir-r4/v1/Composition` dengan tipe LOINC `64297-5`, identifier `http://sys-ids.kemkes.go.id/composition/{organization-id}`, `subject`, `encounter`, `date`, `author[]` Practitioner dan `attester.mode=official` dengan Organization pada `attester.party`. Finalisasi Encounter sesuai proses. | Simpan ID Composition dan rujukan bagian. Baca ulang referensi dan cocokkan versi formulir. |

Tim Sentral Koder dapat melakukan `PATCH /fhir-r4/v1/Observation/{id}` dengan komponen `verify-code` dari system `http://terminology.kemkes.go.id`, serta `valueCodeableConcept.coding` ICD-10. Fasyankes membaca `GET /fhir-r4/v1/Observation/{id}` untuk memperoleh hasil yang sudah diverifikasi. Simpan teks dokter, ID Observation, hasil coding dan status verifikasi sehingga perubahan dapat dilacak. [Buku publik SMPK, bagian 3.5–5](https://drive.google.com/file/d/1zJiGu4T99iv4I3mY67iyHZuqGPCIWqhN/preview)

### Contoh bagian identitas notifikasi maternal

Ini bentuk request sintetis. Tambahkan section lain dan fakta pada konteks aktual sesuai profil MPDN.

```json
{
  "resourceType": "Composition",
  "status": "preliminary",
  "type": {"coding": [{"system": "http://terminology.kemkes.go.id/CodeSystem/composition-type", "code": "COM000001"}]},
  "subject": {"reference": "Patient/<IBU>"},
  "encounter": {"reference": "Encounter/<KUNJUNGAN>"},
  "date": "2026-11-16T03:00:00Z",
  "author": [{"reference": "Practitioner/<PELAPOR>"}],
  "title": "Laporan maternal fixture",
  "event": [{"code": [{"coding": [{"system": "http://snomed.info/sct", "code": "445667001"}]}]}],
  "section": [{
    "title": "Kematian ibu",
    "code": {"coding": [{"system": "http://loinc.org", "code": "64297-5"}]},
    "entry": [{"reference": "Observation/<DATA_KEMATIAN>"}]
  }]
}
```

Potongan hasil baca balik setelah kode diverifikasi pada alur SMPK.

```json
{
  "resourceType": "Observation",
  "id": "<ID_FAKTA_PENYEBAB>",
  "code": {"coding": [{"system": "http://loinc.org", "code": "79378-6"}]},
  "component": [{
    "code": {"coding": [{"system": "http://terminology.kemkes.go.id", "code": "verify-code"}]},
    "valueCodeableConcept": {"coding": [{"system": "http://hl7.org/fhir/sid/icd-10", "code": "<KODE_VERIFIKASI>"}]}
  }]
}
```

## HTTP, keamanan, dan kriteria uji

Gunakan Bearer, host dan media type sesuai [Kontrak HTTP FHIR](../endpoint/kontrak-fhir-http.md). Operasi utama adalah pencarian Patient, create Location bila diperlukan, create Observation dan Composition, baca ulang resource, serta PUT Encounter bila berlaku. Respons sukses menyimpan ID dan korelasi laporan. Catat `OperationOutcome.issue[]` untuk validasi, scope dan akses dari status `401`/`403`, dan retry terbatas pada gangguan sementara setelah rekonsiliasi. Petugas berwenang harus dapat membaca hasil laporan dan status verifikasi. Bukti dashboard atau status lanjutan yang tersedia khusus pelapor perlu diminta untuk lingkungan pengujian. [Katalog HTTP](../endpoint/inventaris-operasi-http.md) · [Validasi dan error](../validasi/respons-dan-error.md)

| Uji | Kriteria lulus |
| --- | --- |
| MPDN maternal | Composition `COM000001` dapat dibaca dan menautkan fakta serta pelapor yang benar. Status preliminer berbeda dengan hasil sertifikasi dalam tampilan Metta. |
| MPDN perinatal | Uji lahir mati dan lahir hidup. IHS ibu/bayi, Encounter dan fokus klinis tetap tepat sesuai skenario, termasuk kasus di luar fasilitas. |
| SMPK | Isi formulir yang relevan, baca Composition dan seluruh Observation. Ketika koder memberi verifikasi, baca kode ICD-10 pada komponen tanpa kehilangan narasi penyebab. |
| Gangguan dan akses | Uji data referensi tertukar, peran koder yang tidak sah, dan respons create hilang. Cocokkan identifier dan status balikan sebelum retry agar laporan tidak ganda. |

Simpan waktu, correlation ID yang disamarkan, jenis dokumen dan status sebagai bukti. Batasi akses pada lokasi kematian, hubungan keluarga, riwayat penyebab dan payload lengkap. Ketiga jalur notifikasi dan sertifikasi belum diuji oleh Metta. [Status bukti](../pengujian/skenario-sandbox.md#status-bukti)
