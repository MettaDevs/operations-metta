# Integrasi sistem eksternal ke module

> **Status di repo ini:** panduan desain. Belum ada route `.integration.routes.ts` yang berisi, belum ada kontrak di `contracts/integration/`, dan autentikasi klien integrasi belum dipindah dari CoreERP. `bun run new-feature <module>/<area>/<fitur> --audience integration` membuat berkas route kosong sampai autentikasinya ada. Acuan perilaku: [halaman yang sama di CoreERP](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/12-external-module-integration.md).

Panduan ini berlaku untuk module atau fitur Core yang menerima data dari sistem eksternal milik tenant, atau mengirim data ke sana. Sistem eksternal dan runtime ini masing-masing memegang datanya sendiri. Tidak ada query atau foreign key yang menyeberang di antara keduanya.

## Di mana kodenya

| Bagian            | Tempat                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------- |
| Route             | `<fitur>.integration.routes.ts` di folder fitur pemilik datanya                           |
| Aturan bisnis     | `<fitur>.service.ts`, sama dengan yang dipakai layar                                      |
| Kontrak           | `contracts/integration/<domain>/`, ditulis tangan, satu folder per domain                |
| Test              | Folder test fitur itu, memvalidasi permintaan terhadap berkas kontrak                    |

Berkas milik satu pemanggil tidak meng-import berkas milik pemanggil lain, dan `check:boundaries` menolaknya. `.integration.routes.ts` tidak meng-import `.routes.ts` layar. Aturan bisnis yang dipakai keduanya ada di `.service.ts`.

## Tentukan pemilik data lebih dahulu

Sebelum membuat API, tulis satu kalimat: sistem mana yang menjadi pemilik fakta ini? Sistem eksternal tetap pemilik dokumen asalnya. Module hanya menyimpan referensi sumber yang dibutuhkan prosesnya. Bila kedua sistem butuh pemetaan keadaan, keadaan ulang, atau orkestrasi khusus, kebutuhan itu diputuskan dulu bersama pemilik produk sebelum dibangun.

## Setup koneksi

Administrator tenant membuat koneksi untuk integrasi. Koneksi punya kredensial mesin ke mesin, tenant tepercaya, scope seminimal mungkin, rate limit, dan batas organisasi yang diizinkan.

`tenant_id` tidak pernah diterima dari URL, query, atau body request. Ia berasal dari token koneksi yang diverifikasi runtime.

Sebelum data operasional dikirim, administrator memetakan referensi stabil sistem eksternal ke nilai yang sah di runtime ini, misalnya:

| Referensi sistem eksternal                           | Tujuan                                           |
| ---------------------------------------------------- | ------------------------------------------------ |
| `legal_entity_ref`                                   | satu `legal_entity_id`                           |
| `legal_entity_ref` bersama `operating_unit_ref`      | satu `legal_entity_id` dan satu `org_unit_id`    |
| `category_ref`, `location_ref`, atau referensi lain  | record milik module tujuan                       |

Pemetaan berlaku per koneksi. Server yang menentukan tujuan hierarki dan versi yang berlaku bila batas data butuh turunan. Pemanggil tidak mengirim induk, kedalaman, atau `hierarchy_id`.

## Pemetaan organisasi mengikuti Dynamics 365

- F&O memperlakukan company atau legal entity sebagai konteks hukum, bisnis, keamanan, dan visibilitas data. Integrasi OData memilih konteks company secara eksplisit untuk entity yang company-specific.
- Operating unit membagi sumber daya dan proses operasional. Ia bukan pengganti legal entity.
- Business unit Dataverse adalah batas kepemilikan record, bukan padanan satu banding satu untuk legal entity F&O.
- Karena itu runtime ini tidak menerima id organisasi internal dari pemanggil. Administrator memetakan referensi stabil pada koneksi, lalu server menyelesaikan dan memeriksa batas organisasi setiap request.

Akses lintas legal entity bukan bawaan. Beri koneksi hanya legal entity dan operating unit yang benar-benar diperlukan.

Sumber Microsoft:

- [Company concept in Dataverse](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/fin-ops/data-entities/company-data)
- [Open Data Protocol (OData) for Finance and Operations](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/data-entities/odata)
- [Create an operating unit](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/fin-ops/organization-administration/tasks/create-operating-unit)
- [Data events](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/business-events/data-events)

## Kontrak request

URL hanya menyatakan resource:

```http
POST /api/<awalan-integrasi>/<resource>
Authorization: Bearer <machine-token>
Idempotency-Key: <UUID>
```

`<awalan-integrasi>` belum diputuskan dan belum ada di kode. Tulis awalannya di kontrak dan di route pertama bersamaan, dan pastikan berada di bawah `/api/`, karena GET di luar `/api/` mendapat dokumen layar.

Bentuk minimum body:

```json
{
    "source": {
        "document_id": "DOC-001",
        "line_id": "1",
        "occurred_at": "2026-07-24T00:00:00Z"
    },
    "source_context": {
        "legal_entity_ref": "LEGAL-001",
        "operating_unit_ref": "UNIT-001"
    },
    "data": {}
}
```

`data` adalah schema domain milik fitur itu, didokumentasikan di kontraknya. `legal_entity_ref` wajib ketika faktanya punya konsekuensi hukum atau akuntansi. `operating_unit_ref` hanya dikirim bila prosesnya butuh unit itu.

## Validasi, jawaban, dan event

Sebelum menyimpan apa pun, server antara lain memeriksa token koneksi, tenant, pemasangan module, scope, pemetaan, batas organisasi, dan schema domain. Request yang diproses belakangan menjawab `202 Accepted` beserta resource yang dapat dibaca ulang:

```http
GET /api/<awalan-integrasi>/<resource>/{id}
Authorization: Bearer <machine-token>
```

`Idempotency-Key` wajib untuk `POST`. Selain itu, referensi sumber `(connection_id, document_id, line_id)` unik. Request ulang dengan sumber yang sama tidak membuat fakta kedua.

Setelah fakta tersimpan, fitur menerbitkan event `<module>.<aggregate>.<action>.v1` lewat `publishEvent`. Sistem eksternal kelak dapat melakukan pull atau menerima webhook bertanda tangan. Event tidak menggantikan API perintah.

| Kondisi                                            | Status | Kode error                      |
| -------------------------------------------------- | ------ | ------------------------------- |
| Token koneksi tidak ada atau tidak sah             | 401    | `unauthenticated`               |
| Koneksi tidak berhak pada organisasi hasil pemetaan | 403   | `organization_scope_forbidden`  |
| Pemetaan, field, atau nilai tidak sah              | 422    | `validation_error`              |
| Sumber sudah dipakai dengan isi berbeda            | 409    | `source_conflict`               |
| Batas request terlampaui                           | 429    | `rate_limit_exceeded`           |

Jawaban tidak pernah membawa detail internal, kredensial, atau data tenant lain.

## Lihat juga

- [API, event, dan integrasi module](04-api-and-integration.md)
- [Standar module](02-module-standard.md)
- [Feed posting finance](34-feed-posting-finance.md)
