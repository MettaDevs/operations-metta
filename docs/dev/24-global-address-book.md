# Buku alamat: party, alamat, dan kontak

Halaman ini untuk developer yang menyentuh identitas, alamat, atau kontak sebuah pihak: organisasi tenant sendiri, vendor, pasien, dan peran lain milik Core atau module. Ia menjelaskan apa yang disimpan Core, aturan yang ditegakkan kodenya, dan mengapa identitas itu tidak boleh disalin ke tabel lain.

Kodenya di `src/platform/address-book/`. Skemanya dari baseline CoreERP, dengan perubahan di `database/migrations/0007_address_book.sql` dan sesudahnya. Layarnya di Sys Admin › Buku alamat, misalnya `/sysadmin/address-book/parties`.

## Mengapa di Core

Modelnya Global Address Book Dynamics 365 F&O, yang tinggal di lapis platform, bukan di sebuah module. **Party** adalah identitas satu pihak, orang atau organisasi. **Tempat** (`locations`) berdiri sendiri dan ditautkan ke party, sehingga satu gedung dapat dipakai beberapa pihak. Alamat pos dan kontak menempel ke tempat. **Peran** seperti vendor atau pasien berlaku per legal entity dan dimiliki fitur pemiliknya; Core menyimpan registri semua peran.

Satu orang atau organisasi sungguhan adalah satu party. Pasien dan tenaga kesehatan adalah peran party milik module layanan kesehatan, bukan identitas kedua. Legal entity dan operating unit ikut menjadi party, karena keduanya punya nama dan alamat yang tercetak di dokumen resmi.

Party di repo ini **tidak bernomor**. Orang mencari party lewat nama atau nomor perannya, misalnya nomor vendor atau nomor rekam medis. Ini keputusan pemilik produk 9 November 2026 dan berbeda dengan CoreERP, yang memberi party nomor sendiri.

## Yang disimpan

| Tabel | Isi |
| --- | --- |
| `parties` | Nama, jenis `person` atau `organization`, `search_name`, profil orang atau organisasi, dan isian identitas dari form pasien sistem lama |
| `locations` | Satu tempat, padanan `LogisticsLocation`, dengan `owner_party_id` |
| `party_locations` | Tautan party ke tempat, utama atau bukan, privat atau bukan, berlaku dari sampai |
| `party_location_purposes`, `location_purposes` | Kegunaan satu tautan, boleh lebih dari satu |
| `postal_addresses` | Alamat pos satu tempat, rujukan master wilayah, dan bentuk tercetaknya di `formatted` |
| `electronic_addresses` | Kontak satu tempat menurut jenisnya, dengan penanda utama |
| `organization_parties` | Tautan organisasi tenant ke party-nya, satu ke satu |
| `party_identifications` | Nomor identitas seperti NIK, No. KK, atau paspor |
| `party_relationships` | Hubungan berarah dan bertanggal antar party |
| `party_roles` | Registri jenis peran, pemiliknya, dan izin yang membuat party berperan itu terlihat |
| `party_role_registrations` | Peran satu party per legal entity |

Data acuan, misalnya jenis party, kegunaan alamat, dan jenis hubungan, ditulis migration, tidak pernah seeder, supaya tenant lama ikut mendapatkannya.

## Siapa melihat party mana

Keputusan pemilik produk 9 November 2026, ditegakkan `PartyAccess`:

- party yang punya peran terlihat bagi pemegang izin lihat salah satu perannya, yaitu `party_roles.view_permission_code`. Izin itu boleh milik module, misalnya izin lihat pasien;
- party tanpa peran terlihat bagi pemegang izin buku alamat;
- nomor identitas sensitif seperti NIK dan No. KK disamarkan menjadi empat angka terakhir bagi yang tidak memegang izin lihat nomor utuh;
- alamat yang ditandai privat, beserta kontak di tempatnya, hanya terlihat bagi pemegang izin lihat alamat privat.

## Peran

Peran ditulis fitur pemiliknya saat akun bisnisnya dibuat, lewat `registerPartyRole`, bukan dicentang di buku alamat. Satu party paling banyak satu peran yang sama per legal entity. Pemilik yang tercatat harus sama dengan pemilik peran di `party_roles`.

Peran Core didaftarkan `0007_address_book.sql`. Peran module didaftarkan migration module-nya, misalnya pasien dan penjamin di `modules/healthcare/database/migrations/0001_patient.sql`.

## Alamat dan kontak

Alamat dan kontak satu party dilayani `PartyAddresses`, untuk party biasa di `/api/v1/parties/{id}/...` dan untuk organisasi tenant di `/api/v1/organizations/{id}/...`. Aturannya:

- **Id alamat di API adalah id tautan, bukan id tempat.** Menautkan tempat yang sudah ada tidak membuat tempat baru, dan respons menyebut berapa pihak lain yang memakai tempat itu (`shared_with`).
- **Hanya party pemilik tempat yang dapat mengubah alamat pos dan kontak di tempat itu.** Tempat baru dimiliki party pembuatnya; menautkan tempat yang sudah ada tidak memindahkan kepemilikan. `is_location_owner` dihitung server, bukan diterima dari form.
- **Alamat pertama otomatis utama; kontak pertama satu jenis di satu tempat otomatis utama.** Penulis alamat, kontak, dan identitas satu party diantrekan dengan mengunci baris party-nya, dan indeks unik parsial tetap menolak dua utama dari penulis lain.
- **Melepas alamat hanya mengarsipkan tautannya.** Tempat, alamat pos, dan kontaknya tetap ada untuk pihak lain yang memakainya. Melepas alamat utama menaikkan alamat tertua yang tersisa.
- **Bentuk tercetak disusun saat disimpan**, oleh `formatPostalAddress`: jalan dan gedung, PO Box, RT/RW, dusun atau banjar, kelurahan, kecamatan, lalu kota, provinsi, dan kode pos. Nama negara hanya untuk alamat di luar Indonesia. Dokumen menyalin bentuk ini, jadi perubahan alamat kemudian tidak menulis ulang dokumen lama.
- **Wilayah dipilih berurutan dari master**: negara, provinsi, kabupaten atau kota, kecamatan, lalu kelurahan atau desa. Wilayah Indonesia beserta kode pos per desa diisi `0006_indonesia_regions.sql`, dengan sumber dan lisensinya tertulis di kepala berkas itu. Dusun atau banjar adalah master per tenant di `src/platform/geography/`.
- **Organisasi tenant lain dijawab 404, bukan 403**, supaya keberadaannya tidak bocor.

Party organisasi tenant dibuat saat pertama dibutuhkan, dan namanya disamakan dengan nama organisasi setiap kali dibaca. Nama organisasi tenant hanya diubah lewat layar organisasi. Party yang masih dipakai peran atau organisasi tidak dapat dihapus; nonaktifkan untuk menghentikan pemakaian baru.

## Nomor identitas dan hubungan

- NIK unik per tenant di antara baris yang belum dihapus. No. KK boleh sama, karena sekeluarga berbagi satu KK. Satu party paling banyak satu nomor per jenis. NIK pengganti dari form pasien sistem lama, `placeholderNik`, dikecualikan dari keunikan karena dipakai untuk warga negara asing.
- Hubungan party mengikuti relationship types F&O. Jenis kedua pihak harus sesuai jenis hubungannya, dan hubungan yang sama tidak boleh berlaku pada rentang tanggal yang tumpang tindih. Hubungan cabang atau anak usaha tidak menggantikan hierarchy organisasi.

## Cek data ganda

Mengikuti duplicate management Business Central. Setiap tenant menyetel Search Hit % dan baris search string di `/sysadmin/address-book/duplicate-check`. Search string disusun dari bagian depan atau belakang field setelah tanda baca dibuang, dan nomor telepon berawalan 62 atau 0 disamakan. Kandidat ganda hanya ditawarkan, tidak menghalangi penyimpanan, dan pasangan yang ditandai bukan ganda tidak muncul lagi.

Bedanya dengan Business Central: yang diperiksa party orang, bukan perusahaan. Ini keputusan pemilik produk.

## Vendor

Vendor milik Core di `src/foundation/purchasing/vendor/`, layarnya `/sysadmin/purchasing/vendors`, padanan Vendor di Business Central.

- Satu baris `vendors` adalah akun vendor per legal entity. Identitasnya party organisasi dengan peran `vendor` milik `core`. Nama diubah di party-nya, dalam transaksi yang sama dengan baris vendor.
- Nomor vendor terbit dari reference `core.vendor-number` lewat number sequence, di dalam transaksi pembuatan.
- NPWP disimpan di akun vendor.
- Vendor tidak dihapus. Vendor yang tidak dipakai lagi dibuat nonaktif, seperti Blocked di Business Central, dan tidak dapat dipilih di dokumen baru.

Di CoreERP vendor dapat dibuat dari party yang sudah ada, nomornya scope tenant, dan NPWP pindah ke party. Ketiganya berbeda di sini; acuannya di [buku alamat CoreERP](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/24-global-address-book.md#akun-vendor-per-entitas-legal).

## Data sharing antar legal entity

Legal entity yang saling melihat jenis data tertentu diatur di Sys Admin › Data sharing (`/sysadmin/data-sharing`, `src/platform/data-sharing/`). Polanya cross-company data sharing F&O, keputusan pemilik produk 11 November 2026.

- Module mendaftarkan jenis datanya di `data_sharing_types` lewat migration-nya, dengan kode stabil seperti `healthcare.patient` dan nama yang tampil di layar.
- Satu kebijakan memilih satu jenis data dan sedikitnya dua legal entity. Satu legal entity hanya boleh ikut satu kebijakan aktif per jenis data.
- Kebijakan berlaku sejak tanggal mulainya selama aktif. Legal entity yang dilepas diarsipkan, dan perubahan tercatat di change log.
- Module pemilik data membaca legal entity yang saling melihat datanya lewat `sharedLegalEntities` saat menyaring datanya sendiri. Core hanya menyimpan kebijakan; ia tidak membaca tabel module untuk ini, dan module tidak menyimpan kebijakan sharing sendiri.

Kepemilikan data tidak berubah; yang berubah hanya siapa yang melihatnya.

## Yang belum ada

Dibandingkan CoreERP: identitas cetak dan kop dokumen, kelompok buku alamat, nomor party, dan pembuatan vendor dari party yang sudah ada. API tulis party untuk sistem luar, penggabungan party, dan riwayat alamat pos juga belum dibangun.

## Lihat juga

- [Tenant dan hierarki organisasi](01a-tenant-and-org-hierarchy.md)
- [Identity dan access](09-identity-and-access.md)
- README module pemilik peran, misalnya `modules/healthcare/README.md`
