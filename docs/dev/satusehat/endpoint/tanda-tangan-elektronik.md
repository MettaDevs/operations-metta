# Endpoint dan respons tanda tangan elektronik

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Tanda Tangan Elektronik (TTE)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/tanda-tangan-elektronik/) (v1.1, rilis 2026-10-19, disunting 2026-10-30) · [Task](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/task/) (disunting 2026-10-30) · [Provenance](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/provenance/) (disunting 2026-10-30)

[Indeks SATUSEHAT](../README.md) · [Endpoint dan respons](README.md) · [Tanda tangan elektronik dan FHIR Consent](../alur/tanda-tangan-elektronik-dan-consent.md) · [Payload tanda tangan elektronik dan FHIR Consent](../payload/tanda-tangan-elektronik-dan-consent.md)

## Flow, endpoint dan respons

Gunakan host, header OAuth Bearer dan media type FHIR berdasarkan [Kontrak HTTP FHIR](kontrak-fhir-http.md). Path di bawah relatif terhadap `/fhir-r4/v1`. Kode HTTP sukses mengikuti contoh resume pada diagram v1.1. [Diagram teknis TTE](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/_images/alur-teknis-tte-antar-simrs-ss-ssp.png)

| Tahap | Pelaku dan request | Respons dan tindakan |
| --- | --- | --- |
| Siapkan dokumen | SIM `POST /Composition` untuk resume, atau buat target sesuai modul, misalnya `MedicationRequest`, `DiagnosticReport`, `DocumentReference`, `Observation`, `ServiceRequest` atau `Consent`. | `201` pada contoh. Simpan ID dokumen dan identitas revisi lokal. |
| Siapkan Provenance | SIM `POST /Provenance`; `target[]` menunjuk dokumen yang dibuat. Tetapkan waktu dan agen. | `201`, simpan `Provenance.id`. |
| Ajukan penandatanganan | SIM `POST /Task`; setiap `input[]` bertipe `document-provenance` menunjuk Provenance. SATUSEHAT mengarahkan Task ke inbox SSM. | `201`. Gunakan `Task/{id}` sebagai sumber QR sebagaimana diagram. Wire format QR dan akses aplikasi perlu diambil dari panduan onboarding; diagram tidak menentukan string yang dikodekan secara lengkap. |
| Tinjau pada perangkat | SSM `GET /Task/{id}`, `GET /Provenance/{id}` untuk tiap input dan `GET /{Resource}/{id}` untuk target. SSM menampilkan dokumen untuk ditinjau dan melakukan tanda tangan JWS di perangkat. | Resource Task, Provenance dan dokumen. SSM menggunakan otorisasi proses penanda tangan. |
| Simpan signature | SSM `PATCH /Provenance/{id}` menambahkan signature dan contained Location/Device sesuai alur. | `200` pada diagram. Setelah commit, SSM melakukan `PATCH /Task/{id}` ke `completed` disertai output, juga dengan `200` pada diagram sukses. |
| Perbarui status di SIM | SATUSEHAT memanggil webhook SIM. Hubungkan callback ke Task tersimpan dan rekonsiliasi dengan Task serta Provenance. | Lacak hasil `signed`, `rejected` atau `exception` pada `Task.output[].type`. Format webhook, autentikasi pengirim, status ack, retry, dan hak baca balik SIM perlu dibuktikan saat akses modul diaktifkan. |
