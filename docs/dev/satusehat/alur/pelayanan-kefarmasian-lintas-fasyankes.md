# Pelayanan kefarmasian lintas fasyankes dan cek sisa resep

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Pelayanan Kefarmasian](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kefarmasian/) (v1.3, rilis 2024-11-28, disunting 2024-12-15)

[Indeks SATUSEHAT](../README.md) · [Alur layanan](README.md) · [Endpoint cek sisa e-Resep v2](../endpoint/e-resep.md) · [Payload kefarmasian lintas fasyankes](../payload/kefarmasian-lintas-fasyankes.md)

Playbook Kefarmasian v1.3 (28 November 2024) membahas penerbitan resep di fasyankes sampai penebusan di apotek. Ada operasi FHIR untuk resep dan catatan penyerahan, serta API e-Resep v2 tersendiri untuk membaca resep dan sisa yang dapat ditebus. Bukti Sandbox Metta untuk kedua jalur ini masih terbuka. [Playbook Kefarmasian](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kefarmasian/)

## Prasyarat dan data Metta

Dokter, pasien, fasilitas, dan lokasi harus mempunyai pemetaan yang valid. Penerbit dan penebus yang berbeda menggunakan akses masing-masing. Jalur e-Resep membutuhkan akun klien e-Resep dan Nomor Resep Nasional (NRN) yang sah. Resolve IHS dan sambungkan resep ke Encounter yang sesuai. [Onboarding FHIR](../endpoint/onboarding-fhir.md)

| Data | Sumber di Metta | Gap |
| --- | --- | --- |
| Resep, item, regimen dan racikan | `sim_tr_resep`, `sim_tr_resep_detail`, produk Core, satuan dan aturan pakai. | Simpan ID tiap MedicationRequest dan kaitkan nomor resep lokal dengan NRN dan DocumentReference. |
| Penyerahan | `bill_farmasi`, `bill_farmasi_detail` dan event `pharmacy.prescription.dispensed.v1` merekam penyerahan, jumlah, stok/batch dan petugas. | Perlu pencatatan penebusan lebih dari satu organisasi, data penyerahan parsial, izin dan alasan substitusi, serta hasil cek sisa. |
| Pembiayaan dan kontak | Tipe pasien, penjamin, biaya, data fasilitas. | Pisahkan SEP BPJS dan nomor klaim lain. Validasi kontak emergensi dan konfirmasi resep serta alamat attachment. Isi data sesuai proses fasilitas. |

Rincian field yang sudah dipetakan ada di [Matriks resep dan farmasi](../payload/matriks-farmasi.md). [Dokumen Healthcare Metta](../../../../modules/healthcare/README.md#biaya-tindakan-dan-e-resep) · [Kontrak event penyerahan](../../../../contracts/events/pharmacy.prescription.dispensed.v1.yaml)

## Flow dan operasi FHIR

| Bab | Operasi atau fungsi | Data yang diikat |
| --- | --- | --- |
| 1–2 | Resolve Patient, buat Encounter dari pintu masuk. | Simpan IHS Patient dan ID Encounter. |
| 3 | `POST /fhir-r4/v1/Observation` untuk berat/tinggi yang diperlukan peresepan. | Tautkan Patient dan Encounter. Gunakan hasil pengukuran serta unit dari profil pemeriksaan fisik. |
| 4 | `POST /fhir-r4/v1/MedicationRequest` per item dengan Medication di `contained`. | Identifier nomor dan item resep pada `.../prescription/{organization-id}` dan `.../prescription-item/{organization-id}`. Simpan ID setiap item dan kode KFA. |
| 5 | `POST /fhir-r4/v1/DocumentReference` untuk dokumen resep. Baca kembali ID dokumen dan NRN. | Kaitkan dokumen, pasien, fasilitas, Encounter dan item. Simpan `masterIdentifier` ketika diberikan server, lalu gunakan query NRN sesuai tabel di bawah. |
| 6 | Apotek membaca resep dan sisa sebelum menebus. Saat serah, `POST /fhir-r4/v1/MedicationDispense` dengan Medication aktual di `contained` dan `authorizingPrescription[]` menunjuk MedicationRequest. | Cocokkan item, jumlah, KFA produk aktual, lot bila dibutuhkan, dan petugas penyerah. Bila ada substitusi catat produk dan alasan secara terpisah, serta dosis ekuivalen jika dipakai. |
| 7 | `PUT /fhir-r4/v1/Encounter/{id}` untuk penutupan kunjungan sesuai profil. | Simpan ID yang sudah ada dan verifikasi status serta referensi. |

Gunakan OAuth Bearer untuk FHIR. Buat ulang hanya setelah rekonsiliasi identifier yang didukung. Periksa hasil baca balik `GET /fhir-r4/v1/MedicationRequest/{id}` dan `GET /fhir-r4/v1/MedicationDispense/{id}`. [Katalog HTTP](../endpoint/inventaris-operasi-http.md) · [Field wajib per bab](../payload/profil-field-layanan.md) · [Kontrak HTTP FHIR](../endpoint/kontrak-fhir-http.md)

### Dokumen dan item resep berdasarkan NRN

Koleksi publik Kemenkes mendokumentasikan operasi berikut dengan OAuth Bearer pada basis FHIR. Status ini berasal dari contoh koleksi. Izin produsen resep dan apotek serta penerimaan akun Metta perlu dibuktikan pada Sandbox.

| Operasi | Request, field dan respons |
| --- | --- |
| Terbitkan dokumen resep | `POST /fhir-r4/v1/DocumentReference`, JSON FHIR. Identifier lokal memakai `http://sys-ids.kemkes.go.id/prescription/{organization-id}`; contoh juga memuat kode jenis pembiayaan, SEP bila berlaku, `status=current`, `docStatus=final` dan LOINC `57833-6`. Gunakan data Patient, Encounter, Organization dan referensi sesuai contoh. |
| Ambil dokumen berdasarkan ID | `GET /fhir-r4/v1/DocumentReference/{id}`. Contoh balikan memakai `masterIdentifier.system=http://sys-ids.kemkes.go.id/prescription/national`. Simpan `masterIdentifier.value` sebagai NRN yang diterbitkan. |
| Ambil dokumen dan resource terkait berdasarkan NRN | `GET /fhir-r4/v1/DocumentReference`, query `identifier={token}` dan `_include=DocumentReference:related`. Token memakai system nasional dan NRN dengan pemisah yang di-encode sebagai `%7C`. Contoh sukses memberi Bundle pencarian dengan DocumentReference serta referensi yang disertakan sesuai skenario, seperti MedicationRequest, Observation dan MedicationDispense. |
| Ambil item resep berdasarkan NRN | `GET /fhir-r4/v1/MedicationRequest?identifier={token}` dengan token nasional yang sama. Cocokkan setiap item dengan Patient, dokumen dan identifier yang tepat. |
| Penebusan melalui Bundle | Koleksi menunjukkan `POST /fhir-r4/v1` dengan `Bundle.type=transaction`, termasuk Encounter apotek dan MedicationDispense yang ditautkan. Simpan `entry[].response.status` dan lokasi resource tiap entry. Ikuti contoh dan akses role penebus serta aturan media type yang berlaku sebelum mengirim. |

[Koleksi publik Farmasi](https://www.postman.com/satusehat/satusehat-public/documentation/mu7pmu7/04-pelayanan-farmasi?entity=request-30206597-3942c4f2-15d1-4624-bff4-80b4de3d5267) · [Detail DocumentReference](https://www.postman.com/satusehat/satusehat-public/request/m53jkdp/documentreference-get-by-id) · [Pencarian dokumen dengan NRN](https://www.postman.com/satusehat/satusehat-public/request/xir9sk6/documentreference-get-by-no-resep-nasional-include-related-medicationrequest-observation-and-medicationdispense-if-any) · [Pencarian item dengan NRN](https://www.postman.com/satusehat/satusehat-public/request/p17jhc3/medicationrequest-get-by-nomor-resep-nasional) · [Bundle penebusan](https://www.postman.com/satusehat/satusehat-public/request/nkhz6dw/bundle-dispensing-eresep)

```http
GET /fhir-r4/v1/DocumentReference?identifier=http%3A%2F%2Fsys-ids.kemkes.go.id%2Fprescription%2Fnational%7C<NRN_ENCODED>&_include=DocumentReference%3Arelated
Authorization: Bearer <access_token>
Accept: application/json
```

Potongan Bundle pencarian disamarkan. Bedakan entri dokumen yang cocok dari resource yang disertakan. Gunakan ID entri penyerahan untuk rekonsiliasi setelah pengiriman dan cek ulang sisa.

```json
{
  "resourceType": "Bundle",
  "type": "searchset",
  "entry": [
    {
      "search": {"mode": "match"},
      "resource": {
        "resourceType": "DocumentReference",
        "id": "<ID_DOKUMEN>",
        "masterIdentifier": {"system": "http://sys-ids.kemkes.go.id/prescription/national", "value": "<NRN>"},
        "context": {"related": [{"reference": "MedicationRequest/<ID_ITEM>"}]}
      }
    },
    {
      "search": {"mode": "include"},
      "resource": {"resourceType": "MedicationRequest", "id": "<ID_ITEM>"}
    }
  ]
}
```

Jika hasil kosong atau ambigu, cek eligibility apotek, status pasien dan namespace NRN. Untuk timeout transaksi, cari dokumen, resep dan penyerahan terkait sebelum retry. Pertahankan identifier transaksi lokal untuk rekonsiliasi.

## Error, keamanan dan skenario Sandbox

| Skenario | Kriteria lulus |
| --- | --- |
| Dokumen dan penebusan | Fasyankes penerbit mengaitkan setiap item dan dokumen ke NRN. Apotek berwenang memperoleh sisa yang konsisten dengan item resep dan mencatat MedicationDispense untuk penyerahan aktual. |
| Penebusan parsial dan persaingan | Uji penebusan parsial, sisa nol dan dua permintaan pada item yang sama. Saat respons create hilang, baca ulang ID dispensing serta sisa sebelum retry. Rekonsiliasi jumlah aktual tanpa menggandakan penyerahan. |
| Substitusi atau racikan | Hasil membaca kembali produk aktual, dosis ekuivalen bila berlaku, alasan/otorisasi dan rujukan item resep. Uji penggantian merek dan penyerahan campuran sesuai profil. |
| Akses dan payload gagal | Uji akun/regimen sah dan negatif, termasuk token e-Resep kedaluwarsa, akun apotek tanpa akses, NRN tak ditemukan, serta referensi FHIR beda lingkungan. Pahami `401`, respons validasi FHIR dan `OperationOutcome.issue[]` dari hasil aktual. |
| Privasi dan audit | Simpan status, waktu, ID korelasi dan kode error; batasi akses pada NRN, identitas pasien, rincian resep dan data kontak. Keluarkan password, header Bearer, token, dan attachment privat dari log umum. |

Jalankan retry terbatas untuk timeout atau `429`/`5xx`. Untuk operasi tulis FHIR, cocokkan hasil dengan identifier dan baca balik sebelum membuat resource baru. Error akses atau payload perlu koreksi konfigurasi/data. [Validasi dan error](../validasi/respons-dan-error.md) · [Uji farmasi Sandbox](../pengujian/skenario-sandbox.md)
