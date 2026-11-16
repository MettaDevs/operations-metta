# Payload kefarmasian lintas fasyankes

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Pelayanan Kefarmasian](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kefarmasian/) (v1.3, rilis 2024-11-28, disunting 2024-12-15)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Pelayanan kefarmasian lintas fasyankes dan cek sisa resep](../alur/pelayanan-kefarmasian-lintas-fasyankes.md) · [Endpoint cek sisa e-Resep v2](../endpoint/e-resep.md)

## Dokumen resep, biaya dan substitusi

| Fakta | Path, kode dan batas penggunaan |
| --- | --- |
| Dokumen terbit | `DocumentReference.identifier[]` dan `status` ditandai wajib pada bab 5. Tautkan pihak pengelola pada `custodian` ke Organization. Gunakan `subject`, `context` serta `content[]` sesuai dokumen aktual. Model resep pada panduan TTE memberi LOINC `57833-6` untuk `DocumentReference.type`. |
| Jenis pembiayaan | `DocumentReference.identifier[]` dan `MedicationDispense.identifier[]` memakai system `http://terminology.kemkes.go.id/CodeSystem/coverage-type` dengan value `BPJS-K`, `Biaya-Sendiri`, `Biaya-Perusahaan` atau `Asuransi-Swasta`. |
| SEP untuk BPJS | `MedicationDispense.identifier[]` memakai `http://sys-ids.kemkes.go.id/claim-number/{organization-id}` pada tabel kefarmasian. Masukkan SEP saat pembiayaan `BPJS-K`. Tabel DocumentReference menempatkan nilai SEP di baris system; validasi struktur identifier dokumen terhadap contoh resmi. [Pola SEP klaim BPJS](klaim-bpjs.md#payload-dan-terminologi) memakai system respons eligibilitas sendiri. |
| Kontak resep | Pada `DocumentReference.content[]` gunakan `attachment.title` dan `attachment.url` serta `format` dengan system `http://terminology.kemkes.go.id/CodeSystem/documentformat`. Kode `DF000001` untuk homepage, `DF000002` untuk kontak emergensi, `DF000003` untuk konfirmasi resep. |
| Harga obat yang dilaporkan | `MedicationDispense.contained[]` dapat memuat ChargeItemDefinition dengan ID lokal, status `active`, `propertyGroup[].priceComponent[].type=base` dan `amount` dalam IDR sesuai skenario modul. Path dalam tabel dengan `type.amount` dibaca sebagai `priceComponent[].amount` terpisah dari `type` sesuai FHIR. Konfirmasi referensi dan kelengkapan contained yang diterima sebelum kirim. |
| Substitusi | `MedicationDispense.substitution.wasSubstituted` adalah boolean. Jenis pada `type.coding` memakai `http://terminology.hl7.org/CodeSystem/v3-substanceAdminSubstitution` dengan `G` generik, `BC` merek, `TG` terapeutik generik, `TB` terapeutik merek. Gunakan fakta produk dan kebijakan resep yang sah. |
| Alasan substitusi dan penanggung jawab | Isi `reason[].coding` dengan `OS` stok kosong atau `FP` formularium dari `http://terminology.hl7.org/CodeSystem/v3-ActReason`; `TK000017` interaksi obat atau `TK000018` persetujuan pasien dari `http://terminology.kemkes.go.id`; serta `661000124108` kesalahan resep dari SNOMED CT. `responsibleParty[]` merujuk dokter yang menyetujui dan apoteker pelaksana sesuai modul. |
| Dosis konsumsi ekuivalen | Baca `GET /fhir-r4/v1/MedicationRequest/{id}`; Playbook menyatakan perhitungan tersimpan sebagai QuestionnaireResponse di `contained`. Item `equivalentBoolean` memakai boolean; anak `equivalentQuantity` memakai `valueQuantity`. Item `dispensedReferences` merujuk MedicationDispense. Tabel menulis tipe boolean untuk kolom quantity; bentuk JSON perlu mengikuti tipe `valueQuantity` dan verifikasi fixture. |

Saat satu item diresepkan kemudian dipecah menjadi beberapa produk, bandingkan bahan aktif, kekuatan dan ekuivalensi regimen. Pertahankan item resep asal dan jumlah yang benar-benar ditebus untuk tiap produk. Pada racikan, bedakan d.t.d. dari pembagian rata, kode setiap bahan, dan dosis akhir. [Playbook Kefarmasian bab 5–6](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kefarmasian/#_5_pengiriman_data_dokumen_resep) · [Substitusi obat](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kefarmasian/#_ketentuan_substitusi_obat) · [TTE untuk resep](tanda-tangan-elektronik-dan-consent.md#jenis-dokumen-dan-penanda-tangan)
