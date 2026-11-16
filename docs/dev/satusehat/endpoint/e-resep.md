# Endpoint cek sisa e-Resep v2

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Pelayanan Kefarmasian](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kefarmasian/) (v1.3, rilis 2024-11-28, disunting 2024-12-15)

[Indeks SATUSEHAT](../README.md) · [Endpoint dan respons](README.md) · [Pelayanan kefarmasian lintas fasyankes dan cek sisa resep](../alur/pelayanan-kefarmasian-lintas-fasyankes.md) · [Payload kefarmasian lintas fasyankes](../payload/kefarmasian-lintas-fasyankes.md)

## API e-Resep v2 untuk cek sisa

| Environment | Base URL |
| --- | --- |
| Sandbox | `https://api-stg.dto.kemkes.go.id/eresep/v2` |
| Production | `https://api.kemkes.go.id/eresep/v2` |

| Operasi | Request | Respons |
| --- | --- | --- |
| Login klien | `POST /sign/in`, body JSON `user` dan `password` dari akun klien e-Resep. | HTTP `200` dengan `status: 200`, `error: false`, `message`, `data.token`, `data.expired` pada contoh sukses. `401` dicantumkan untuk akses tidak sah. `expired` pada contoh berupa timestamp epoch. |
| Baca resep dan sisa | `GET /prescriptions/{nrn}` memakai `Authorization: Bearer <access_token>` dari `data.token`. Path variable `nrn` wajib, tanpa body. | HTTP `200` memberi identitas fasyankes dan pasien, kontak, obat dan metadata. Per item periksa `id`, `code`, `iteration`, `package_unit`, `package_amount`, `package_remain`, `package_total`, `has_redeemed`, `validity_start`, `validity_end`, dosis serta rincian bahan jika ada. |

Kedua operasi memakai envelope JSON `status`, `error`, `message`, `data`. Tabel sumber memberi uraian flag `error` yang bertentangan dengan contoh sukses. Perlakukan HTTP status dan isi `data` sebagai pemeriksaan pertama. Uji bentuk `401`, NRN salah, kedaluwarsa dan resep sengaja tidak dapat diakses dengan akun resmi sebelum menetapkan penanganan error per kode lokal. Pada dokumentasi, item `has_redeemed=true` sudah tidak dapat ditebus. Cek sisa dan masa berlaku terhadap data terbaru sebelum proses serah. [API cek sisa dalam Playbook](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kefarmasian/#_dokumentasi_perhitungan_sisa_obat)

Contoh request login memakai placeholder konfigurasi rahasia.

```json
{"user": "<AKUN_KLIEN_ERESEP>", "password": "<PASSWORD_DARI_SECRET_STORE>"}
```

Potongan respons cek sisa yang aman untuk fixture. Kontrak aktual turut mengembalikan atribut pasien, organisasi, kontak dan obat yang tidak diperlukan untuk contoh rekonsiliasi.

```json
{
  "status": 200,
  "error": false,
  "message": "Success",
  "data": {
    "medicines": [{
      "id": "<ID_ITEM_RESEP>",
      "code": "<KODE_KFA>",
      "iteration": 0,
      "package_unit": "Tablet",
      "package_amount": 10,
      "package_remain": 4,
      "package_total": 10,
      "has_redeemed": false
    }],
    "meta": {"medicine": {"item_count": 1}}
  }
}
```
