# Pencarian EpisodeOfCare untuk program

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [EpisodeOfCare](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/episode-of-care/) (disunting 2023-09-27)

[Indeks SATUSEHAT](../README.md) · [Endpoint dan respons](README.md)

Katalog umum dan koleksi program mendokumentasikan beberapa bentuk query untuk resource yang sama. Pada snapshot 16 November 2026, katalog API mencantumkan pencarian `subject`, atau kombinasi `subject`, `organization` dan `care-manager`. Contoh Postman program memakai `patient` dengan `type`, `status` dan, pada variasi tertentu, `organization`. Judul request dapat menyebut subject walaupun URL memakai patient. Ikuti bentuk URL sumber yang sesuai. [Katalog EpisodeOfCare](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/episode-of-care/#_pencarian_data)

## Kontrak query dan scope

Basis `/fhir-r4/v1`, HTTP GET tanpa body dan `Authorization: Bearer <access_token>`. Gunakan Patient IHS, Organization ID dan token yang dipetakan ke lingkungan sama. `type` pada contoh program memakai kode literal seperti `ANC` atau `TB-SO`. Gunakan ejaan dan huruf besar/kecil yang ditunjukkan contoh. Pastikan mode tanpa filter Organization tersedia untuk role yang digunakan. Penghilangan filter Organization tidak sendiri memberi hak membaca data lintas organisasi. [Host dan header FHIR](kontrak-fhir-http.md#host-header-dan-scope)

| Sumber atau program | Query pada bentuk publik yang diperiksa | Status bukti |
| --- | --- | --- |
| Katalog umum | `subject={patient}` atau `subject={patient}&organization={org}&care-manager={practitioner}` | Parametrik pada tabel katalog. |
| ANC dan INC | `patient={patient}&type=ANC&status=active`. Ada variasi dengan `organization={org}`. | URL contoh publik. [ANC pasien dan status](https://www.postman.com/satusehat/satusehat-public/request/ue7kvcf/get-episodeofcare-dengan-subject-patient-dan-type-anc-dengan-status-active-get-eoc-dari-any-organization) · [ANC pada INC](https://www.postman.com/satusehat/satusehat-public/request/r6ep8d1/get-episodeofcareanc-by-patient-type-status-organization) |
| PNC | `patient={patient}&type=PNC&status=active` | URL contoh publik. [Koleksi PNC](https://www.postman.com/satusehat/satusehat-public/request/bx9um5l/get-episodeofcare-type-pnc-status-active) |
| Neonatus dan MTBS | `patient={patient}&type=Neonate&status=active`. Contoh MTBS memakai `type=Neonate&patient={patient}`. | URL contoh publik. [Neonatus](https://www.postman.com/satusehat/satusehat-public/request/ru3nauq/episodeofcare-get-berdasarkan-patient-ihs-dan-type-neonate-dan-status-active) · [MTBS](https://www.postman.com/satusehat/satusehat-public/request/nuaa9oc/episodeofcare-get-episodeofcare-neonatus-sebelumnya) |
| Tuberkulosis | `patient={patient}&type=TB-SO&status=waitlist`. Contoh `active` tersedia dengan atau tanpa `organization={org}`. | URL contoh publik. `TB-RO` mengikuti tipe kasus pada Playbook dan perlu diuji dengan fixture. [Terduga TB](https://www.postman.com/satusehat/satusehat-public/request/t0hqno0/get-episodeofcare-dengan-subject-patient-dan-type-tb-so-dengan-status-waitlist-get-eoc-dari-any-organization) · [Episode aktif dengan Organization](https://www.postman.com/satusehat/satusehat-public/request/oim8c9d/get-episodeofcare-dengan-subject-patient-dan-type-tb-so-dengan-status-active-dan-organization-org-id-faskes-get-eoc-dari-faskes-sendiri) |
| Jantung | `patient={patient}&type=CAD&status=active` atau `status=waitlist`. | URL contoh publik. [Aktif](https://www.postman.com/satusehat/satusehat-public/request/fwk8q1v/get-episodeofcare-dengan-subject-patient-dan-type-cad-dengan-status-active-get-eoc-dari-any-organization) · [Terduga](https://www.postman.com/satusehat/satusehat-public/request/fjjbp68/get-episodeofcare-dengan-subject-patient-dan-type-cad-dengan-status-waitlist-get-eoc-dari-any-organization) |
| Stroke | `patient={patient}&type=CVD&status=active`, dengan atau tanpa `organization={org}`. | URL contoh publik. [Stroke](https://www.postman.com/satusehat/satusehat-public/request/pew4fak/episodeofcare-search-by-patient) · [Stroke dengan Organization](https://www.postman.com/satusehat/satusehat-public/request/5n8hug3/episodeofcare-search-by-patient-organization) |
| Uronefrologi | `type=CKD&status=active&patient={patient}`. | URL contoh publik. [Uronefrologi](https://www.postman.com/satusehat/satusehat-public/request/y92ocs6/episodeofcare-get-where-status-is-active-and-patient-patient-id) |
| Mata | `patient={patient}&type=EMC&status=active` atau `status=waitlist`. | URL contoh publik. [Aktif](https://www.postman.com/satusehat/satusehat-public/request/k1tv623/get-episodeofcare-dengan-subject-patient-dan-type-emc-dengan-status-active-get-eoc-dari-any-organization) · [Terduga](https://www.postman.com/satusehat/satusehat-public/request/z3ogh00/get-episodeofcare-dengan-subject-patient-dan-type-emc-dengan-status-waitlist-get-eoc-dari-any-organization) |
| Telinga | `patient={patient}&type=ADM&status=waitlist`, dengan atau tanpa `organization={org}`. | URL contoh publik untuk waitlist. Playbook juga menjelaskan pencarian aktif. [Koleksi Telinga](https://www.postman.com/satusehat/satusehat-public/documentation/42907689-adc25041-0e01-42ad-878e-bb613307be47?entity=request-42907689-b11e7a08-11bd-4bde-8eb4-1dd0c13be7bc) |
| Kanker dan HIV | Playbook menjelaskan pasien, tipe `cancer` atau `HIV` dan fase sesuai alur. | Semantik Playbook. URL query khusus yang merekam parameter itu belum diverifikasi dari contoh publik. [Registrasi Kanker](../alur/registrasi-jantung-stroke-kanker-uronefrologi.md#episode-per-program) · [HIV](../alur/hiv-dan-pemeriksaan-penunjang.md) |

Contoh request dan potongan balikan yang menunjukkan korelasi.

```http
GET /fhir-r4/v1/EpisodeOfCare?patient=<PATIENT_IHS>&type=TB-SO&status=active&organization=<ORGANIZATION_ID>
Authorization: Bearer <access_token>
Accept: application/json
```

```json
{
  "resourceType": "Bundle",
  "type": "searchset",
  "total": 1,
  "entry": [{
    "resource": {
      "resourceType": "EpisodeOfCare",
      "id": "<ID_EPISODE>",
      "status": "active",
      "type": [{"coding": [{"system": "https://terminology.kemkes.go.id/CodeSystem/episodeofcare-type", "code": "TB-SO"}]}],
      "patient": {"reference": "Patient/<PATIENT_IHS>"},
      "managingOrganization": {"reference": "Organization/<ORGANIZATION_ID>"}
    }
  }]
}
```

## Resolusi episode di Metta

1. Pakai ID episode yang sudah tersimpan untuk record dan lingkungan yang sama. Untuk episode baru atau ketika ID hilang, cari dengan query yang diperiksa dan pilih variasi scope yang sah.
2. Evaluasi Bundle, entri yang cocok dan link paginasi jika tersedia. Cocokkan `patient`, `type`, `status`, `period` dan `managingOrganization` dengan record program. Simpan ID EpisodeOfCare asli untuk `Encounter.episodeOfCare[]`. Simpan nomor surveilans atau register dari respons aktual sesuai program.
3. Jika tidak ada hasil atau hasilnya lebih dari satu, tinjau scope, kelompok pasien dan histori. Uji `GET /EpisodeOfCare/{id}` jika ID diketahui. Saat hasil belum pasti, selesaikan rekonsiliasi sebelum membuat episode baru.
4. Uji kasus pasien tunggal, nomor status salah, dua episode aktif yang relevan, paginasi dan perbedaan organisasi. Periksa error melalui HTTP dan `OperationOutcome.issue[]`. Lindungi IHS, nomor kasus dan klasifikasi pasien dalam bukti. [Validasi dan error](../validasi/respons-dan-error.md)

Contoh Postman menetapkan bentuk query publik. Penerimaan dengan akun Metta, scope lintas organisasi dan selector gabungan tambahan seperti beberapa status masih perlu bukti. [Status bukti](../pengujian/skenario-sandbox.md#status-bukti)
