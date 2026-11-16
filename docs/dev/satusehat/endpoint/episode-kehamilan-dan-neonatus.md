# Kontrak EpisodeOfCare dan Encounter untuk ibu dan bayi

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [EpisodeOfCare](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/episode-of-care/) (disunting 2023-09-27) · [Intranatal Care (INC)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/inc/) (v2.7, rilis 2024-09-10, disunting 2025-10-02) · [Antenatal Care (ANC)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/anc/) (v2.5, rilis 2024-07-02, disunting 2025-10-02)

[Indeks SATUSEHAT](../README.md) · [Endpoint dan respons](README.md) · [ANC, INC, PNC, dan Neonatus](../alur/program-kehamilan-persalinan-dan-neonatus.md)

## Kontrak EpisodeOfCare dan Encounter

| Tahap | Request | Respons dan keputusan |
| --- | --- | --- |
| Cari episode pasien | `GET /fhir-r4/v1/EpisodeOfCare` dengan Bearer. [Kueri program](kueri-episode-of-care.md) mencatat URL koleksi ANC, PNC dan Neonatus dengan `patient`, `type` dan `status`. Katalog umum memberi `subject`. | Baca Bundle pencarian dan cocokkan Patient, `type`, `status`, `period` dan `managingOrganization`. Rekonsiliasi hasil kosong atau beberapa episode aktif yang cocok. Scope antar-Organization perlu bukti pada akun program. |
| Mulai episode sekali | `POST /fhir-r4/v1/EpisodeOfCare`. Untuk episode awal ANC dan PNC, profil menandai `status`, `type`, `patient`, `managingOrganization` dan `period`. Kirim riwayat status sesuai profil bila berlaku. | Resource dan ID EpisodeOfCare. Ikat ID pada record episode program. Status awal `active` sesuai kondisi pelayanan. |
| Daftarkan atau perbarui kunjungan | `POST /fhir-r4/v1/Encounter` atau pembaruan resource yang ada, dengan `episodeOfCare[].reference=EpisodeOfCare/{id}`. | ID Encounter. Pada kunjungan ulang, kaitkan episode aktif pasien yang sama. Satu episode bisa mencakup beberapa Encounter. |
| Akhiri episode saat pemicunya sah | `PATCH /fhir-r4/v1/EpisodeOfCare/{id}` dengan patch yang memperbarui status, masa episode dan histori. Baca dulu resource dan bentuk operasi sesuai field yang benar-benar ada. | Cocokkan `status=finished`, `period.end` dan `statusHistory[]` melalui respons dan `GET /fhir-r4/v1/EpisodeOfCare/{id}`. Pertahankan histori lama yang sah. |

Pemilihan HTTP mengikuti [Kontrak HTTP FHIR](kontrak-fhir-http.md) dan [Katalog EpisodeOfCare](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/episode-of-care/). Gunakan `period` pada JSON. Pada INC v2.7, satu kalimat masih menyebut PUT setelah GET, sementara riwayat pembaruan dan uraian penutupan pada bab 3 menggunakan PATCH. Untuk integrasi ini, gunakan PATCH dan verifikasi payload histori di Sandbox. [INC bab 3](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/inc/#_3_menutup_episode_kehamilan_anc_saat_persalinan)

| Program | Tipe episode dan aturan tanggal |
| --- | --- |
| ANC | Tipe `ANC`. Bila HPHT tersedia, gunakan sebagai `period.start`. Akhiri berdasarkan kejadian yang tercatat seperti persalinan. Bab 17 memberi ketentuan kehilangan follow-up dengan batas 44 minggu atau 308 hari dari HPHT. Catat dasar tanggal yang digunakan. |
| INC | Gunakan EpisodeOfCare ANC yang ditemukan dan tutup saat persalinan pada alur bab 3. Encounter persalinan dan pencatatan detail bayi memiliki identitas pasien dan referensi masing-masing sesuai modul. |
| PNC | Tipe `PNC` dengan system `https://terminology.kemkes.go.id/CodeSystem/episodeofcare-type`. Create saat PNC pertama, kaitkan kunjungan selanjutnya. Bab 15 memetakan penutupan nifas termasuk akhir masa 42 hari dari tanggal persalinan serta kehilangan follow-up. |
| Neonatus | Tipe `Neonate` dengan system `http://terminology.kemkes.go.id/CodeSystem/episodeofcare-type` sebagaimana tabel modul. Mulai dari tanggal lahir bila tersedia. Penutupan mengikuti akhir masa neonatus dan batas 28 hari sejak lahir pada ketentuan hilang follow-up. Catat KN sesuai visit yang memenuhi definisi, tanpa mengulang label KN hanya karena visit kuratif jatuh dalam rentang yang sama. |

[Episode ANC](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/anc/#_3_memulai_episode_kehamilan_saat_kunjungan_anc) · [Episode PNC](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pnc/#_3_memulai_episode_nifas_saat_kunjungan_pertama_kali_pnc) · [Episode Neonatus](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/neonatus/#_3_memulai_episode_neonatus_saat_kunjungan_neonatus_pertama_kali)

Contoh create episode PNC. Isi periode sesuai episode terdokumentasi. Ganti setiap placeholder dan gunakan organisasi dari akun yang berhak.

```json
{
  "resourceType": "EpisodeOfCare",
  "status": "active",
  "type": [{"coding": [{"system": "https://terminology.kemkes.go.id/CodeSystem/episodeofcare-type", "code": "PNC"}]}],
  "patient": {"reference": "Patient/<IBU>"},
  "managingOrganization": {"reference": "Organization/<FASYANKES>"},
  "period": {"start": "2026-11-10"}
}
```

Contoh JSON Patch menutup episode PNC yang sudah memiliki `period` dan `statusHistory[0]` aktif. Jika index atau struktur berbeda, gunakan hasil GET terbaru untuk memilih posisi yang benar. Contoh ini mengakhiri histori aktif dan menambahkan status `finished` sebagai entri baru.

```json
[
  {"op": "replace", "path": "/status", "value": "finished"},
  {"op": "add", "path": "/period/end", "value": "2026-12-22"},
  {"op": "add", "path": "/statusHistory/0/period/end", "value": "2026-12-22"},
  {"op": "add", "path": "/statusHistory/-", "value": {"status": "finished", "period": {"start": "2026-12-22"}}}
]
```

Potongan hasil baca balik yang perlu dikorelasikan setelah PATCH. Status selesai dicatat pada periode penutupan yang sebenarnya.

```json
{
  "resourceType": "EpisodeOfCare",
  "id": "<EPISODE>",
  "status": "finished",
  "patient": {"reference": "Patient/<IBU>"},
  "period": {"start": "2026-11-10", "end": "2026-12-22"}
}
```
