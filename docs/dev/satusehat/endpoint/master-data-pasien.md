# Master Patient Index dan identitas pasien

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [ReST API](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-patient-index/rest-api-mpi/) (disunting 2024-11-15) · [Patient](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/patient/) (disunting 2025-07-22) · [RelatedPerson](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/related-person/) (disunting 2023-11-16)

[Indeks SATUSEHAT](../README.md) · [Endpoint dan respons](README.md) · [Matriks identitas](../payload/matriks-identitas.md#patient) · [Master Wilayah](master-data-sarana-wilayah.md#master-wilayah)

Master Patient Index (MPI) memberi nomor IHS nasional untuk referensi `Patient/{id}`. Operations tetap memegang ID pasien, nomor rekam medis, dan data identitas lokal. Simpan hubungan ID pasien lokal dengan IHS setelah pencocokan, disertai environment, sumber, dan hasil verifikasinya. Gunakan `Patient.id` yang dikembalikan server sebagai string. Format ID tidak selalu UUID seperti disebut sebagian halaman katalog. Pada Sandbox, ID Patient yang sudah diuji memakai bentuk IHS berawalan huruf. [Service pasien Metta](../../../../modules/healthcare/src/patient/patient/patient.service.ts) · [Kontrak MPI](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-patient-index/rest-api-mpi/) · [Bukti Sandbox](../pengujian/backlog-rawat-jalan-tanpa-resep.md#hasil-uji-rj-00-sampai-rj-05)

[Host, metode, dan header](#host-metode-dan-header) · [Pencarian dan keputusan pemetaan](#pencarian-dan-keputusan-pemetaan) · [Registrasi dan relasi bayi](#registrasi-dan-relasi-bayi) · [Pembaruan parsial](#pembaruan-parsial) · [Penanganan hasil dan skenario uji](#penanganan-hasil-dan-skenario-uji)

## Host, metode, dan header

Gunakan host [Sandbox atau Production](host-dan-autentikasi.md#endpoint-dan-autentikasi) dengan prefix `/fhir-r4/v1`. Dapatkan token OAuth untuk Organization pada environment itu, lalu sertakan `Authorization: Bearer <access_token>` pada request berikut.

| Operasi | Metode dan path relatif terhadap prefix | Input dan respons |
| --- | --- | --- |
| Cari kandidat Patient | `GET /Patient` | Query sesuai cabang pasien. Sukses berbentuk `Bundle` dengan hasil pencarian. |
| Baca Patient berdasarkan IHS | `GET /Patient/{id}` | Path ID IHS server. Sukses berbentuk resource `Patient`. |
| Registrasi Patient baru | `POST /Patient` | JSON `Patient`, `Content-Type: application/json`. Jalankan setelah pencarian dan validasi sesuai cabang registrasi. Simpan `Patient.id` balikan. |
| Pembaruan parsial Patient | `PATCH /Patient/{id}` | Katalog MPI menyebut `Content-Type: application/json` dan body berupa array operasi patch. Verifikasi path yang diizinkan pada skenario MPI. |
| Cari atau baca hubungan keluarga | `GET /RelatedPerson`, `GET /RelatedPerson/{id}` | Ikuti filter endpoint saat memeriksa relasi bayi dan ibu. Baca resource dan kaitannya ke Patient yang benar. |

Pada sebagian bagian MPI path ditulis `Patient:id` atau `Patient:`. Bentuk request di sini memakai slash sebelum ID dan path koleksi tanpa titik dua, sesuai contoh HTTP resmi dan baca balik Sandbox. [Kontrak Patient](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/onboardings/apis/patient/) · [Kontrak RelatedPerson](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/integrations/apis/related-person/)

## Pencarian dan keputusan pemetaan

| Data tersedia | Query | Keputusan |
| --- | --- | --- |
| IHS sudah dikenal | Baca `GET /Patient/{id}`. | Cocokkan ID, pasien lokal, dan scope. Data demografi pada respons dapat terbatas. |
| NIK diketahui | `identifier=https://fhir.kemkes.go.id/id/nik\|<nik>`. URL-encode seluruh nilai query. | Gunakan data identitas yang sudah dicatat untuk memeriksa hasil. |
| NIK, nama, dan tanggal lahir | Katalog mendokumentasikan `nik`, `name`, dan `birthdate`. Uji Sandbox Metta memakai `identifier`, `name`, dan `birthdate` dan menghasilkan kecocokan tunggal pada fixture yang diuji. | Baca balik IHS yang cocok. Jaga varian query yang berhasil dalam bukti uji sebelum mengadopsi untuk semua pasien. |
| Pasien tanpa NIK | `name`, `birthdate`, `gender`. Panduan tanpa NIK menjelaskan nama minimal tiga karakter dengan kecocokan serupa, tanggal lahir lengkap `YYYY-MM-DD`, dan gender `male` atau `female`. | Periksa kandidat secara hati-hati karena pencarian nama dapat menghasilkan beberapa pasien. Panduan tanpa NIK yang dirujuk menjelaskan pencarian, sehingga cabang registrasi lain perlu kontrak terpisah jika tidak ada hasil. |
| Bayi dengan NIK ibu | `identifier=https://fhir.kemkes.go.id/id/nik-ibu\|<nik-ibu>`. | Cocokkan anak dan urutan kelahiran pada hasil. Pada kelahiran kembar, hasil memang dapat memuat lebih dari satu bayi. |

Contoh URL untuk pencarian dengan filter gabungan, dengan nilai query disandikan.

```http
GET /fhir-r4/v1/Patient?identifier=https%3A%2F%2Ffhir.kemkes.go.id%2Fid%2Fnik%7C<NIK-UJI>&name=<nama-uji-url-encoded>&birthdate=<YYYY-MM-DD>
Authorization: Bearer <access_token>
Accept: application/json
```

Contoh respons pencarian yang disederhanakan.

```json
{
  "resourceType": "Bundle",
  "type": "searchset",
  "total": 1,
  "entry": [
    {"resource": {"resourceType": "Patient", "id": "<patient-ihs>", "active": true}}
  ]
}
```

Hitung kandidat yang cocok pada hasil dan periksa pagination dari `Bundle.link`. `2xx` berarti pencarian berhasil diproses. Pemetaan baru dibuat setelah satu kandidat terverifikasi. Bila ambigu, minta data pembeda sesuai alur. Hasil kosong berarti perlu pemeriksaan query atau alur registrasi yang tepat. Baca balik IHS pada host yang sama sebelum memakai referensi. [MPI pasien dengan NIK](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-patient-index/pasien-nik/) · [MPI tanpa NIK](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-patient-index/pasien-no-nik/) · [MPI bayi](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-patient-index/pasien-bayi/)

## Registrasi dan relasi bayi

Kemenkes mendokumentasikan lookup lebih dulu, validasi data identitas menurut cabang pasien, lalu POST Patient jika syarat registrasi terpenuhi. Untuk pasien dengan NIK, cocokkan NIK, nama, tanggal lahir, gender, dan kode wilayah dengan data yang berwenang diverifikasi. Registrasi menggunakan identifier dengan sistem `https://fhir.kemkes.go.id/id/nik`. Panduan mencantumkan data tambahan seperti tempat lahir, kontak, dan alamat dengan ketentuan yang berbeda antara tabel minimum dan alur pembuatan. Validasi kebutuhan field tiap cabang saat uji kontrak. [Pembuatan Patient dengan NIK](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-patient-index/pasien-nik/)

Untuk bayi baru lahir, tentukan apakah bayi sudah memiliki NIK. Untuk cabang NIK ibu, gunakan `https://fhir.kemkes.go.id/id/nik-ibu`, nama dan tanggal lahir bayi, gender, kode wilayah, alamat, dan `multipleBirthInteger`. Panduan memakai `0` untuk kelahiran tunggal dan angka urut untuk kelahiran kembar. Gunakan data yang sudah diidentifikasi pada ibu dan bayi, serta konfirmasi persyaratan verifikasi MPI pada kasus tersebut. [Pembuatan Patient bayi](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-patient-index/pasien-bayi/#pasien-bayi-create)

Contoh potongan body bayi dengan NIK ibu. Lengkapi data alamat dan field lain yang berlaku.

```json
{
  "resourceType": "Patient",
  "identifier": [{"use": "official", "system": "https://fhir.kemkes.go.id/id/nik-ibu", "value": "<nik-ibu-uji>"}],
  "name": [{"use": "official", "text": "<nama-bayi-uji>"}],
  "birthDate": "<YYYY-MM-DD>",
  "gender": "<gender-bayi>",
  "multipleBirthInteger": 0
}
```

Alur MPI juga menjelaskan penautan ibu melalui `RelatedPerson` setelah IHS bayi tersedia. Relasi `MTH` merujuk ibu dan mengikat Patient bayi yang sesuai. Bedakan data yang dibentuk oleh layanan MPI dari operasi yang memang perlu dijalankan klien Metta. Sebelum membuat relasi, periksa hasil registrasi dan baca balik relasi yang sudah terbentuk. Kontrak dasar RelatedPerson memiliki endpoint POST; kebutuhan, urutan, dan otorisasi pemanggilan mandiri pada cabang MPI perlu dibuktikan sebelum implementasi. [Relasi bayi dan ibu](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-patient-index/pasien-bayi/#pasien-bayi-get) · [Profil RelatedPerson](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/related-person/)

## Pembaruan parsial

Baca Patient dari IHS yang sudah dipetakan dan periksa nilai saat ini sebelum membentuk PATCH. Katalog API Patient/MPI mendokumentasikan `replace` pada path yang didukung. Template berikut menunjukkan bentuk array JSON Patch, bukan penetapan daftar field yang boleh diubah.

```json
[
  {"op": "replace", "path": "<path-yang-didukung-MPI>", "value": "<nilai-baru-sesuai-tipe-field>"}
]
```

Untuk pembaruan data bayi, panduan meminta konteks data lama seperti nama, tanggal lahir, dan gender untuk validasi. Jika memasukkan NIK baru, verifikasi ke Dukcapil sesuai cabang. Pahami bagian payload yang membawa data lama pada implementasi endpoint sebelum menyalakan pembaruan identitas. Contoh umum MPI memberi path ilustratif. Pakai path yang telah diterima untuk field aktual, lalu baca balik IHS yang sama. [Kontrak PATCH MPI](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-patient-index/rest-api-mpi/#_pembaruan_sebagian_data) · [Pembaruan data bayi](https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-patient-index/pasien-bayi/#pasien-bayi-update)

## Penanganan hasil dan skenario uji

| Hasil | Penanganan |
| --- | --- |
| Satu kandidat yang terverifikasi | Simpan pasangan ID pasien lokal dan IHS. Jangan mengganti nomor rekam medis. |
| Kandidat kosong atau ambigu | Periksa scope, filter, dan identitas yang diketahui. Untuk bayi, periksa urutan kelahiran. Catat status pemetaan sebelum meneruskan transaksi yang perlu Patient. |
| `4xx` / `OperationOutcome` | Periksa referensi, otorisasi, payload, dan ketentuan verifikasi Dukcapil dari respons. Koreksi data yang ditemukan salah dengan sumber yang berwenang. |
| POST tanpa kepastian hasil | Periksa kembali lookup dalam scope pasien yang sama dan rekonsiliasi sebelum mencoba create lagi. |
| PATCH sukses | Baca resource yang sama dan cocokkan nilai yang diubah sebelum memperbarui catatan integrasi. |

Uji satu kecocokan, kandidat ganda, hasil kosong, nama dan tanggal lahir saja sesuai cabang tanpa NIK, bayi kembar dengan NIK ibu yang sama, pembaruan NIK, dan POST dengan hasil belum pasti pada fixture yang diizinkan. Untuk tahap yang membutuhkan create atau patch, simpan bukti khusus per cabang dan saring NIK, NIK ibu, demografi, serta token dari log umum. Sandbox Metta sudah membuktikan pencarian gabungan dan baca balik Patient dummy. Registrasi dan PATCH Patient, skenario bayi, serta integrasi penyimpanan IHS produk masih menjadi backlog. [Bukti akses dan identitas](../pengujian/backlog-rawat-jalan-tanpa-resep.md#hasil-uji-rj-00-sampai-rj-05) · [Validasi dan error](../validasi/respons-dan-error.md)
