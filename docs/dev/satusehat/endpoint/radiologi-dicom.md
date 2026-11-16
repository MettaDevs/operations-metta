# Endpoint dan respons radiologi dan DICOM

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Resume Medis - Rawat Jalan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/) (v7.0, rilis 2026-01-10, disunting 2026-08-04) · [ImagingStudy](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/imaging-study/) (disunting 2023-09-27) · [ServiceRequest](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/service-request/) (disunting 2023-09-27)

[Indeks SATUSEHAT](../README.md) · [Endpoint dan respons](README.md) · [Radiologi, DICOM Router, dan NIDR](../alur/radiologi-dicom.md) · [Payload dan pemetaan radiologi dan DICOM](../payload/radiologi-dicom.md)

## Endpoint dan respons

| Operasi | Request | Respons atau keluaran |
| --- | --- | --- |
| Buat order radiologi | `POST /fhir-r4/v1/ServiceRequest`, OAuth Bearer, JSON FHIR | Resource dan ID ServiceRequest. Simpan ID bersama ACSN lokal. |
| Cari order | `GET /fhir-r4/v1/ServiceRequest?identifier={token}`, OAuth Bearer | Bundle pencarian. Cocokkan namespace identifier, ACSN dan subjek sebelum memproses citra. |
| Buat metadata citra | `POST /fhir-r4/v1/ImagingStudy`, OAuth Bearer, JSON FHIR, dikirim komponen yang ditetapkan pada flow | Resource dan ID ImagingStudy. `GET /fhir-r4/v1/ImagingStudy?identifier={token}` membaca hasil berdasarkan ACSN. Katalog menyediakan `PUT /fhir-r4/v1/ImagingStudy/{id}` untuk pembaruan. |
| Kirim laporan | `POST /fhir-r4/v1/DiagnosticReport`, OAuth Bearer, JSON FHIR | Resource dan ID DiagnosticReport. Baca `GET /fhir-r4/v1/DiagnosticReport/{id}` lalu verifikasi referensi order, pasien, serta studi jika dikirim. |
| Unduh installer Windows | `GET /dicom-router-installer` pada host API Sandbox atau Production, OAuth Bearer | Arsip ZIP yang berisi installer. Ikuti distribusi dan ketentuan akses yang diberikan Kemenkes. |
| Kirim objek citra | C-STORE masuk ke router, STOW-RS melalui HTTPS dari router ke layanan DICOMweb | Status penerimaan objek. Pantau hasil akhir melalui webhook atau log router. Konfigurasikan URL layanan sesuai distribusi router dan lingkungan yang diberikan. |
| Baca citra rendered | `GET {dicomweb-base}/dicomWeb/studies/{studyUID}/series/{seriesUID}/instances/{sopUID}/rendered` | Representasi visual citra. Pembacaan byte dan tipe konten mengikuti respons layanan DICOMweb. |
| Terima hasil router | `POST {webhook_url}` ke endpoint internal fasyankes dengan Basic auth, header `request-type: dicom-router`, dan JSON | Endpoint memberi JSON `status`, `message`, `data.id` untuk hasil sukses dan array `error`. Untuk request yang ditolak, isi `status=false` dan alasan pada `error`. |

Pada ServiceRequest, identifier nomor order memakai `http://sys-ids.kemkes.go.id/servicerequest/{organization-id}`. ACSN memakai `http://sys-ids.kemkes.go.id/acsn/{organization-id}` dengan tipe `ACSN` dari `http://terminology.hl7.org/CodeSystem/v2-0203`. Kategori order radiologi menggunakan SNOMED CT `363679005`. Pencarian ImagingStudy memakai namespace ACSN yang berbeda, yaitu `http://sys-ids.kemkes.go.id/acsn/{patient-id}|{accession-number}` pada definisi query katalog. Beberapa contoh katalog menulis `https` untuk system yang sama. Kirim nilai system persis seperti yang tertera pada identifier ImagingStudy yang diterbitkan rilis router. Dalam URL, encode pemisah `|` sebagai `%7C`. [Pemetaan order radiologi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_11_pengiriman_data_pemeriksaan_penunjang_radiologi) · [Pencarian ImagingStudy](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/imaging-study/#_pencarian_data)

Gunakan host dan encoding token pada [Kontrak HTTP FHIR](kontrak-fhir-http.md) untuk operasi FHIR. Panduan radiologi menunjukkan path WADO-RS relatif terhadap base DICOMweb. Base dan akses lingkungan uji DICOM perlu dibuktikan saat onboarding. [Katalog ImagingStudy](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/imaging-study/) · [Katalog ServiceRequest](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/service-request/) · [Katalog DiagnosticReport](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/diagnostic-report/) · [Panduan teknis radiologi, hlm. 10–17](https://drive.google.com/file/d/1KgEIaPOsPNIYvJe4snEe0vWjppE0SBBe/preview)
