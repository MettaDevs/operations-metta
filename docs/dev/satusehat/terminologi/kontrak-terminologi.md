# Kontrak terminologi dan pemetaan kode SATUSEHAT

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Standar Terminologi SATUSEHAT](https://drive.google.com/file/d/1r_fHBmTYkqbaE3_g20RMcVztWHSsRHgP/preview) (v12.0, rilis 2026-10-31) · [Standar Terminologi SATUSEHAT](https://satusehat.kemkes.go.id/platform/docs/id/terminology/standar-terminologi/) (disunting 2026-11-06) · [Terminologi](https://satusehat.kemkes.go.id/platform/docs/id/terminology/) (disunting 2026-10-08)

[Indeks SATUSEHAT](../README.md) · [Terminologi](README.md)

Acuan lintas modul adalah Standar Terminologi v12.0 (31 Oktober 2026) dan lampiran use case yang berlaku. Gunakan [indeks terminologi per field](indeks-terminologi-field.md) untuk memilih bagian buku dari path payload. Gunakan versi dan contoh pada modul saat ada syarat yang berbeda menurut peran atau tahap. [Terminologi SATUSEHAT](https://satusehat.kemkes.go.id/platform/docs/id/terminology/) · [Standar Terminologi](https://satusehat.kemkes.go.id/platform/docs/id/terminology/standar-terminologi/) · [Buku v12.0](https://drive.google.com/file/d/1r_fHBmTYkqbaE3_g20RMcVztWHSsRHgP/preview)

[Sistem dan lingkup](#sistem-dan-lingkup) · [Mata uang dan tipe media](#mata-uang-dan-tipe-media) · [Langkah pemetaan kode](#langkah-pemetaan-kode) · [Lingkup SNOMED CT dan ECL](#lingkup-snomed-ct-dan-ecl) · [Nilai yang dibutuhkan lintas modul](#nilai-yang-dibutuhkan-lintas-modul) · [Kriteria uji pemetaan](#kriteria-uji-pemetaan)

## Sistem dan lingkup

| Keluarga | Sistem, konteks dan sumber data |
| --- | --- |
| ICD-10 | Kemenkes menyatakan edisi 2010 untuk diagnosis. Gunakan `http://hl7.org/fhir/sid/icd-10` jika profilnya meminta ICD-10. Metta menyimpan kode melalui `sim_m_icd10` dan transaksi diagnosis. [Diagnosis Metta dan kode](../../../../modules/healthcare/README.md#diagnosa-pemeriksaan) |
| ICD-9-CM dan KPTL | Kemenkes menyatakan ICD-9-CM 2010 untuk tindakan tertentu dengan `http://hl7.org/fhir/sid/icd-9-cm`. KPTL mendeskripsikan pembiayaan tindakan dan layanan. Gunakan `http://terminology.kemkes.go.id/CodeSystem/kptl` pada field yang memintanya, misalnya skenario pembiayaan atau penunjang. Metta menyimpan referensi tindakan dan salinan tarif. [Biaya tindakan](../../../../modules/healthcare/README.md#biaya-tindakan-dan-e-resep) · [Klaim BPJS](../payload/klaim-bpjs.md#payload-dan-terminologi) |
| ICD-IM | Edisi 2026 untuk konteks pembiayaan iDRG sebagaimana portal Terminologi. Konfirmasi namespace, use case dan field sebelum menggunakan kode ini pada payload. Kode pada rekam medis dan tagihan memiliki sumber serta scope masing-masing. [Klaim BPJS dan E-Klaim](../alur/klaim-bpjs.md) |
| ICD-O, ICD-MM dan ICD-PM | Portal menyatakan ICD-O 3.2 (2019) untuk neoplasma, ICD-MM 2012 untuk kematian maternal dan ICD-PM 2016 untuk perinatal. Gunakan aturan pengkodean modul menurut tujuan. [Registrasi kanker](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md) · [MPDN dan SMPK](../alur/pelaporan-kematian-mpdn-dan-smpk.md) |
| LOINC dan kode penunjang nasional | Gunakan `http://loinc.org` dan code metode yang didokumentasikan. Kode order dan kode hasil dapat berbeda. Jika profil menetapkan kode pemeriksaan nasional, ikuti CodeSystem dan code yang diterbitkan pada pemeriksaan. [LOINC Kemenkes](https://satusehat.kemkes.go.id/platform/docs/id/terminology/loinc/) · [Lab](../alur/laboratorium-rujukan-spesimen.md) |
| SNOMED CT | Gunakan `http://snomed.info/sct` dengan concept ID dari nilai atau lingkup ECL yang benar. Pertahankan edisi atau tanggal yang disebut pada dokumen terminologi. Pilih konsep pada konteks, misalnya anatomi, temuan, alergi, prosedur atau pekerjaan. [Akar konsep ECL](indeks-terminologi-field.md#akar-konsep-pada-bagian-ecl) |
| KFA dan kode lokal Kemenkes | KFA memakai `http://sys-ids.kemkes.go.id/kfa`. Bedakan zat aktif, produk virtual dan produk aktual sesuai profil obat/ALKES. Metta menyimpan `gd_m_barang.kode_kfa`. Kode terbitan Kemenkes memakai system persis sesuai tabel profil. [KFA](../endpoint/master-data-kfa.md) · [Matriks farmasi](../payload/matriks-farmasi.md) |
| UCUM | Gunakan `http://unitsofmeasure.org` dan code satuan, seperti `kg`, `cm`, `mL`, `mm[Hg]` atau `{score}` bila ditetapkan. Nilai dikirim sebagai angka. Bedakan `Quantity.code` untuk mesin dan `Quantity.unit` untuk pengguna. Simpan nilai serta satuan asli ketika ada konversi. [Matriks tanda vital](../payload/matriks-rawat-jalan.md#observation) |
| HL7 CodeSystem, ValueSet, dan kode primitif | Nama field menentukan cara serialisasi. `Encounter.status` adalah code primitif, `Encounter.class` adalah Coding, dan `Observation.code` adalah CodeableConcept. Isi `system` pada Coding dengan URI CodeSystem. ValueSet menunjukkan pilihan yang dapat dipakai sesuai binding. [FHIR Coding dan CodeableConcept](https://hl7.org/fhir/R4/datatypes.html#Coding) |

## Mata uang dan tipe media

| Field | Binding FHIR R4 | Nilai contoh dan penggunaan |
| --- | --- | --- |
| `Money.currency` | `http://hl7.org/fhir/ValueSet/currencies` | `IDR` sebagai string code ISO 4217. Gunakan untuk nilai rupiah pada tarif, tagihan atau pembayaran sesuai transaksi. `Money.value` berupa angka dalam denominasi tersebut. [Contoh pembiayaan](../payload/contoh-pembiayaan.md) · [FHIR Currency Codes](https://hl7.org/fhir/R4/valueset-currencies.html) · [ISO 4217 List One](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml) |
| `DocumentReference.content[].attachment.contentType` | `http://hl7.org/fhir/ValueSet/mimetypes` | `application/pdf` untuk dokumen PDF sesuai media lampiran aktual. [Contoh DocumentReference](../payload/contoh-penunjang-dan-logistik.md#documentreference) · [IANA application/pdf](https://www.iana.org/assignments/media-types/application/pdf) |
| `Endpoint.payloadMimeType[]` | `http://hl7.org/fhir/ValueSet/mimetypes` | `application/dicom` untuk DICOM sesuai kontrak endpoint. Header HTTP upload dokumen atau layanan DICOM mengikuti operasi yang dipanggil. [Contoh Endpoint](../payload/contoh-penunjang-dan-logistik.md#endpoint) · [FHIR Mime Types](https://hl7.org/fhir/R4/valueset-mimetypes.html) · [IANA application/dicom](https://www.iana.org/assignments/media-types/application/dicom) |

Verifikasi offline pada 16 November 2026 mencakup 12 literal `IDR` pada contoh pembiayaan, satu `application/pdf` dan satu `application/dicom` pada contoh penunjang. Ketiganya cocok dengan ISO 4217 List One bertanggal 17 September 2026 dan IANA Media Types bertanggal 10 November 2026. Pemeriksaan membuktikan keanggotaan literal pada daftar rujukan. Kecocokan fakta transaksi, format lampiran, dan penerimaan SATUSEHAT mengikuti skenario masing-masing. [Registri IANA Media Types](https://www.iana.org/assignments/media-types/media-types.xhtml)

## Langkah pemetaan kode

1. Tentukan fakta lokal, method atau penilaian, resource, path, tahap dan profil. Untuk rawat jalan, misalnya, pisahkan hasil pemeriksaan tekanan darah dari interpretasi, serta order lab dari hasil.
2. Cari path di [indeks field](indeks-terminologi-field.md). Cocokkan module, aturan wajib/kondisional, pilihan `value[x]`, dan kode yang memang diterbitkan bagi fakta itu. Gunakan kode resmi sesuai versi dan scope.
3. Catat kunci Metta, jenis fakta, system, code, display bila dipakai, versi/edisi, sumber dan tanggal berlaku. Gunakan code sebagai string untuk mempertahankan angka awal nol atau case. Integrasi perlu melacak mapping yang disetujui dan data historis sebelum mengirim.
4. Saat kode belum terpetakan, perbaiki master atau data sumber dan verifikasi dengan petugas yang berwenang. Gunakan coding alternatif hanya saat profil menyediakannya. Contoh teks `<KODE_...>` pada fixture perlu diganti dengan pasangan kode yang sesuai sebelum diuji.
5. Periksa respons dan baca ulang resource. Untuk `400` atau `422`, telusuri `OperationOutcome.issue[]`, `expression` dan Rule Number, lalu koreksi system, code, bentuk value, satuan atau konteks. Gunakan retry setelah koreksi dengan aturan rekonsiliasi yang sesuai. [Kamus Rule Number](../validasi/kamus-rule-number.md) · [Validasi dan error](../validasi/respons-dan-error.md)

Contoh dua bentuk wire untuk kode yang sudah dipetakan. Status adalah field code primitif, sedangkan class adalah satu Coding.

```json
{
  "status": "in-progress",
  "class": {
    "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
    "code": "AMB"
  }
}
```

## Lingkup SNOMED CT dan ECL

Operator `<` memilih turunan dan `<<` menyertakan konsep fokus beserta turunannya. ECL dapat menambahkan pengecualian atau filter atribut. Pada Procedure.code, buku memberi ruang lingkup prosedur `< 71388002` dan riwayat prosedur `< 416940007` pada konteks SNOMED CT. Pada bodySite yang mengikuti lingkup Body Structure, akar yang disebut adalah `< 123037004`. Untuk AllergyIntolerance.code, ekspresi memuat gabungan dan pengecualian. Gunakan ekspresi lengkap di sumber serta pilihan KFA atau ATC pada jenis alergi yang sesuai. [Buku v12.0, bagian 4 dan 6](https://drive.google.com/file/d/1r_fHBmTYkqbaE3_g20RMcVztWHSsRHgP/preview) · [Referensi operator ECL SNOMED CT](https://docs.snomed.org/snomed-ct-specifications/snomed-ct-expression-constraint-language/appendices/appendix-d-ecl-quick-reference)

## Nilai yang dibutuhkan lintas modul

| Field atau keluarga | Nilai yang dicantumkan |
| --- | --- |
| Kelas ruang Location | `1`, `2`, `3`, `vip`, `vvip` memakai `http://terminology.kemkes.go.id/CodeSystem/locationServiceClass-Inpatient`. `reguler` dan `eksekutif` memakai `http://terminology.kemkes.go.id/CodeSystem/locationServiceClass-Outpatient`. Buku v12 juga mencatat `kris-a` dan `kris-b` dengan CodeSystem Kemenkes dasar. Lihat URI kanonis dan konteks pengisian pada [Profil dan extension FHIR R4](../payload/profil-dan-extension-fhir.md#contoh-kelas-bangsal). |
| Novelty Encounter untuk SIRS | `EncounterToFacility`, `EncounterToSpecialty` dan `EncounterToEpisode` diberi nilai `new`, `returning` dan `unknown` dalam daftar `encounter-novelty` pada buku. Field bertipe `valueCode`. Canonical URL untuk setiap extension memerlukan profil yang berlaku. |
| Penyedia signature TTE | Buku menulis `Provenance.extension.signature-provider.valueCodeableConcept.coding` dengan system `http://terminology.kemkes.go.id` dan code `BSrE`. Gunakan bila sesuai penyedia pada alur. URI extension ditentukan terpisah di profil. |
| Produk biologis | Status dasar `available` atau `unavailable`. Untuk kategori gunakan `organ`, `tissue`, `fluid`, `cells` atau `biologicalAgent` sebagaimana code pada tabel. Pada produk darah, periksa kategori dan identifier kantong sesuai data. |
| Produk darah, kuantitas dan status rinci | Kuantitas extension menggunakan UCUM `mL` sesuai bagian 52.6. Status detail SNOMED CT `117074003` dipindahkan atau `117070007` dimusnahkan sesuai kejadian. Canonical dan tipe extension mengikuti profil. |
| Alasan pemusnahan produk darah | Bagian 52.8 memuat Kemenkes `TK000771`, `TK000772`, `TK000773`, `TK000774` serta SNOMED CT `117073009` kedaluwarsa dan `74964007` lainnya. Pilih sesuai kejadian dan data produk. |
| Lateralisasi BodyStructure | Untuk `locationQualifier[]`, bagian 53.2 memuat SNOMED CT `7771000` kiri dan `24028007` kanan. Gunakan lokasi anatomis dan sisi yang tercatat. |

[Buku v12.0, bagian 2.12, 3.22–3.24, 51.9 dan 52–53](https://drive.google.com/file/d/1r_fHBmTYkqbaE3_g20RMcVztWHSsRHgP/preview) · [Kompatibilitas payload FHIR](../payload/kompatibilitas-payload-fhir.md) · [Fixture produk biologis](../payload/contoh-penunjang-dan-logistik.md#biologicallyderivedproduct)

Metta menetapkan kunjungan baru/lama berdasarkan riwayat pada bulan kalender yang sama. Pelaporan novelty memerlukan fakta per fasilitas, spesialisasi dan episode. Buktikan aturan tiap dimensi sebelum memetakan status lokal ke extension SIRS. [Pendaftaran kunjungan Metta](../../../../modules/healthcare/README.md#pendaftaran-kunjungan)

## Kriteria uji pemetaan

Uji satu kode yang tepat, code yang benar dengan system salah, ejaan URI berbeda, nilai di luar lingkup, dan data historis tanpa kode. Uji juga konversi satuan atau kode order dan hasil. Lulus ketika resource dibaca balik dengan pasangan system/code yang benar, kategori dan nilai yang sesuai, dan penolakan tercatat dengan Rule Number atau path jika server menyediakannya. Simpan kode dan rujukan publik untuk investigasi. Batasi log umum pada waktu, scope, status dan korelasi yang disamarkan. [Skenario Sandbox](../pengujian/skenario-sandbox.md) · [Monitoring dan aduan](../operasional/monitoring-dan-aduan.md)
