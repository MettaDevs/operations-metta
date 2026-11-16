# Payload dan pemetaan data kelahiran dan akta

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Data Kelahiran](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/data-kelahiran/) (v1.0, rilis 2026-06-26, disunting 2026-09-29)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Data kelahiran dan pengajuan akta](../alur/data-kelahiran-dan-akta.md)

## Field dan sumber di Metta

| Resource | Field dan terminologi | Sumber dan gap |
| --- | --- | --- |
| Patient | Cocokkan IHS `https://fhir.kemkes.go.id/id/ihs-number`, nomor rekam medis `http://sys-ids.kemkes.go.id/mrn/{organization-ihs-number}`, dan KK `https://fhir.kemkes.go.id/id/kk` bila digunakan. Variabel lain mencakup nama, jenis kelamin, tanggal lahir, urutan lahir, agama, dan status dalam keluarga sesuai profil. Tabel menulis `Patient.multipleBirth` bertipe integer; wire name FHIR R4 untuk tipe itu adalah `multipleBirthInteger`. | Demografi dan nomor rekam medis ada. Perlu relasi persalinan dan urutan lahir per bayi, dokumen KK yang diverifikasi, dan pemetaan keluarga. |
| Observation | Untuk bayi gunakan berat lahir LOINC `8339-4`, panjang `89269-5`, lokasi `72150-6` sesuai modul, jam lahir `57715-5`, urutan anak SNOMED CT `365475008`, golongan darah `883-9` atau ABO/Rh `882-1` sesuai data. Untuk ibu gunakan kode Kemenkes `OC000013` saat mengirim penolong persalinan. Tanggal laporan memakai code `tgl-lapor-kelahiran` dari `http://terminology.kemkes.go.id`. | Gunakan hasil lahir dan data administratif yang telah disahkan. Gap utama ialah dataset kelahiran per bayi dan siapa yang melaporkan. |
| RelatedPerson | `patient` menautkan bayi. Isi identifier NIK `https://fhir.kemkes.go.id/id/nik`, `name`, `telecom` dan `birthDate` sesuai data. Relationship ibu `NMTH` dan ayah `NFTH` dari `http://terminology.hl7.org/CodeSystem/v3-RoleCode`; pelapor/saksi `pelapor-kelahiran` dan `saksi-kelahiran` dengan system `http://terminology.kemkes.go.id/` sebagaimana tabel. Jangan mengasumsikan pelapor sekaligus saksi. | Perlu data peran, identitas dan hubungan yang dinyatakan, serta sumber kontak yang sah. |
| DocumentReference | `type.coding` menggunakan `http://terminology.kemkes.go.id` dengan `dokumen-buku-nikah`, `surat-lahir` atau `surat-kuasa`. Sertakan tanggal perkawinan, identitas dan link/lampiran sesuai konteks dokumen. Gunakan hanya dokumen yang tersedia dan wajib pada skenario. | Perlu penyimpanan dokumen terbatas, jenis dokumen, konfigurasi informasi attachment dan hak akses pembaca. |
| Task | `status=requested`, `intent=instance-order`, `priority=routine`, code SNOMED CT `444561001`, `authoredOn`, `lastModified`, `requester`/ `owner` Organization fasyankes, `for` Patient bayi, `encounter` Encounter ibu. | Perlu status pengajuan, korelasi pengajuan bayi–ibu–fasyankes, dan nomor transaksi. |

[Data bayi](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/data-kelahiran/#_1_pendaftaran_pasien) · [Data keluarga dan dokumen](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/data-kelahiran/#_5_pengiriman_data_variabel_data_kelahiran_lainnya) · [FHIR R4 Patient](https://hl7.org/fhir/R4/patient.html)

## Contoh request dan potongan balikan

```json
{
  "resourceType": "Task",
  "status": "requested",
  "intent": "instance-order",
  "priority": "routine",
  "code": {"coding": [{"system": "http://snomed.info/sct", "code": "444561001"}]},
  "authoredOn": "2026-11-16T02:00:00Z",
  "lastModified": "2026-11-16T02:00:00Z",
  "requester": {"reference": "Organization/<FASYANKES>"},
  "owner": {"reference": "Organization/<FASYANKES>"},
  "for": {"reference": "Patient/<BAYI>"},
  "encounter": {"reference": "Encounter/<PERSALINAN_IBU>"}
}
```

```json
{
  "resourceType": "Task",
  "id": "<TASK_ID>",
  "status": "requested",
  "intent": "instance-order",
  "identifier": [{"system": "http://sys-ids.kemkes.go.id/task/transaction-number", "value": "TRX-20261116-000001"}]
}
```
