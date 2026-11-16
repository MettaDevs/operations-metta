# Matriks resource resep dan farmasi

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Resume Medis - Rawat Jalan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/) (v7.0, rilis 2026-01-10, disunting 2026-08-04) · [Medication](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/medication/) (disunting 2024-12-15) · [MedicationRequest](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/medication-request/) (disunting 2024-12-15)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md)

Matriks mencakup obat, resep dokter, pengkajian, dan penyerahan. [Urutan implementasi farmasi](../pengujian/prioritas-implementasi.md#3-resep-pengkajian-dan-penyerahan) · [Cara membaca matriks](aturan-field-fhir.md#cara-membaca-matriks)

Untuk dokumen resep, Nomor Resep Nasional, API e-Resep cek sisa, substitusi, dan penebusan lintas fasyankes, lanjutkan ke [Panduan Pelayanan Kefarmasian](../alur/pelayanan-kefarmasian-lintas-fasyankes.md).

[Medication](#medication) · [MedicationRequest](#medicationrequest) · [QuestionnaireResponse](#questionnaireresponse) · [MedicationDispense](#medicationdispense)

## Medication

Pada desain ini `Medication` diletakkan di `contained` milik resep atau penyerahan. `id` contained hanya berlaku di payload tersebut. [Playbook obat dan KFA](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_16_pengiriman_data_peresepan_obat) · [Profil Medication](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/medication/)

| Field | Aturan | Sumber di Operations Metta | Celah |
| --- | --- | --- | --- |
| `id` | W saat dirujuk sebagai `#id` dalam `contained` | ID item, baris resep, atau item aktual sesuai konteks | Bentuk ID lokal dalam payload dan validasi referensi `#id`. |
| `identifier[]`, `.system`, `.value` | W | `gd_m_barang.kode` untuk nonracikan, identitas kepala racikan dari `sim_tr_resep_detail` | Setujui kunci stabil dan namespace obat per organisasi. |
| `extension:medicationType` | W | Jenis baris resep serta `sim_tr_resep_detail.dtd` | Pemetaan nonracikan `NC`, racikan `SD` atau `EP`. |
| `code.coding` | W untuk nonracikan. K menurut ketentuan racikan | `gd_m_barang.kode_kfa` | Kolom bisa kosong. Resep memakai `92` atau `93` sesuai skenario dan produk aktual yang dikeluarkan memakai `93`. Validasi KFA dan kode produk aktual. |
| `form.coding` | K sesuai jenis obat dan ketentuan profil | Kepala racikan `bentuk_sediaan_id` ke `sim_m_bentuk_sediaan.kode_kemkes` | Master bisa belum berkode. Periksa sumber bentuk sediaan untuk produk nonracikan. |
| `ingredient[].item[x]`, `.strength` | K untuk skenario racikan; nonracikan mengikuti aturan Playbook | Komponen racikan, jumlah komponen, dan `jumlah_permintaan` kepala racikan | Lengkapi KFA komponen dan pemetaan pembilang/penyebut d.t.d. versus dibagi rata. |
| `batch.lotNumber`, `.expirationDate` | K bila batch aktual dilaporkan pada penyerahan | Potongan pengeluaran stok dari `issuedSlices`; event penyerahan membawa batch | Tentukan pemetaan untuk baris dengan beberapa batch tanpa menggandakan jumlah penyerahan. |

## MedicationRequest

`POST /MedicationRequest` ketika dokter mengirim resep ke farmasi. Contoh JSON ada di [bagian resep dan penyerahan](contoh-rawat-jalan-dan-farmasi.md#resep-dan-penyerahan-obat). [Playbook Peresepan](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_16_pengiriman_data_peresepan_obat) · [Kontrak event resep Metta](../../../../contracts/events/healthcare.prescription.issued.v1.yaml) · [Profil MedicationRequest](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/medication-request/)

| Field | Aturan | Sumber di Operations Metta | Celah |
| --- | --- | --- | --- |
| `identifier[]` untuk nomor resep dan baris | W | `sim_tr_resep.nomor`, `sim_tr_resep_detail.id` dan `urutan` | Tetapkan dua identifier stabil dengan sistem `prescription` dan `prescription-item` per organisasi. |
| `status`, `intent` | W | `sim_tr_resep.status`, tindakan kirim resep | Tetapkan pemetaan status aktif, batal, dan koreksi; intent resep dokter mengikuti use case. |
| `medicationReference.reference` | W | Baris obat atau kepala racikan untuk `Medication` | Arahkan ke `#id` yang dibuat untuk contained. |
| `subject.reference` | W | Pasien dari pemeriksaan resep | Resolve Patient IHS. |
| `encounter.reference`, `requester.reference`, `authoredOn` | K sesuai profil dan skenario; isi pada alur rawat jalan yang dirancang | Kunjungan pada pemeriksaan, `sim_tr_resep.dokter_id`, `dikirim_pada` | Resolve Encounter dan IHS. Konfirmasi waktu penulisan resep versus waktu kirim jika berbeda. |
| `dosageInstruction[].timing.repeat`, `.route` | W pada peresepan yang dicakup Playbook | `frekuensi`, `lama_hari`, `rute_id`, aturan pakai | Lengkapi pemetaan interval/durasi dan kode rute. Data resep lama bisa kosong. |
| `dosageInstruction[].doseAndRate[].doseQuantity`, `.sequence`, `.additionalInstruction` | K sesuai aturan regimen pada Playbook | `dosis`, `dosis_satuan_id`, `signa`, `aturan_pakai_id`, `keterangan` | Standarkan satuan dan urutan aturan pakai. Regimen bertahap atau obat kronis perlu diverifikasi tersendiri. |
| `dispenseRequest.quantity` | K sesuai jumlah yang diminta | `jumlah` obat tunggal, `jumlah_permintaan` kepala racikan, satuan baris | Validasi kode satuan pengeluaran dan bedakan dengan satuan dosis. |
| `reasonReference[]`, `note[]` | K bila ada diagnosis atau catatan | `sim_tr_resep_detail.diagnosa_id`, `sim_tr_resep.catatan` | Tunggu ID Condition yang sah jika dirujuk. Tautan diagnosis lokal opsional. |
| `substitution.allowed[x]` | W pada pemetaan Playbook | Belum ditemukan keputusan substitusi resep yang tersimpan | Tentukan kebijakan yang sah dan simpan keputusan bila perlu. Jangan menyimpulkan izin dari keterbatasan layar Farmasi. |

## QuestionnaireResponse

`POST /QuestionnaireResponse` untuk pengkajian resep memakai formulir Q0007. Pengkajian administratif, farmasetik, dan klinis perlu jawaban petugas, termasuk referensi resep yang dinilai. [Playbook Pengkajian Resep](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_17_pengiriman_data_pengkajian_resep) · [Profil QuestionnaireResponse](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/questionnaire-response/)

| Field | Aturan | Sumber di Operations Metta | Celah |
| --- | --- | --- | --- |
| `questionnaire` | W untuk pemetaan formulir Q0007 | Konstanta `https://fhir.kemkes.go.id/Questionnaire/Q0007` | Simpan versi formulir yang diuji. |
| `status` | W | Belum ditemukan status pengkajian Q0007 | Perlu fakta pengkajian selesai atau dikoreksi. |
| `subject.reference`, `encounter.reference` | W | Pasien dan kunjungan resep | Resolve Patient dan Encounter. |
| `author.reference`, `source.reference` | W pada pemetaan pengkajian | Pelaku penyerahan ada, tetapi pelaku pengkajian belum tersimpan | Catat siapa mengisi dan siapa memberi jawaban sesuai profil, serta IHS yang diperlukan. |
| `item[].linkId`, `item[].item[].linkId`, `answer.value[x]` | W sesuai struktur dan tipe jawaban Q0007 | Belum ditemukan record jawaban pengkajian | Perlu pencatatan tiap jawaban. Jangan menurunkan jawaban dari status penyiapan atau penyerahan. |
| `item[].answer.valueReference` | W untuk butir referensi resep yang dikaji | Resep lokal dan ID hasil kirim `MedicationRequest` | Tetapkan kaitan ke baris resep yang dinilai dan tunggu ID SATUSEHAT. |
| `authored` | K/P sesuai profil dan peristiwa pengkajian | Belum ditemukan waktu pengkajian khusus | Catat waktu pengkajian aktual. |

## MedicationDispense

`POST /MedicationDispense` saat obat benar-benar diserahkan. Penyiapan menyimpan stok dan waktu, sedangkan kejadian serah menjadi pemicu pengeluaran klinis pada desain ini. [Playbook Pengeluaran Obat](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/#_18_pengiriman_data_pengeluaran_obat) · [Kontrak event penyerahan](../../../../contracts/events/pharmacy.prescription.dispensed.v1.yaml) · [Migration penerima obat](../../../../modules/pharmacy/database/migrations/0011_dispensing_receiver.sql)

| Field | Aturan | Sumber di Operations Metta | Celah |
| --- | --- | --- | --- |
| `identifier[]` | W | Resep asal, `bill_farmasi.resep_id`, `bill_farmasi_detail.resep_detail_id` | Peta nomor resep dan baris sesuai Playbook. Kunci pengiriman lokal tetap membedakan penyerahan atau koreksi yang berbeda. |
| `status` | W | `bill_farmasi.status` | `completed` untuk serah yang selesai. Perilaku SATUSEHAT untuk koreksi/retur harus dikonfirmasi. |
| `medicationReference.reference` | W | `bill_farmasi_detail.barang_id`, satuan, dan stok aktual | Susun `Medication` dengan KFA aktual `93xxxxxx` untuk nonracikan, serta batch jika berlaku. |
| `subject.reference`, `context.reference` | W | Pasien dan kunjungan dari resep asal | Resolve IHS dan Encounter. |
| `authorizingPrescription[]` | K bila pengeluaran berdasarkan resep; berlaku untuk alur ini | `bill_farmasi_detail.resep_detail_id` | Tunggu ID MedicationRequest per baris. |
| `performer[].actor`, `location.reference` | K menurut pelaku dan tempat pada profil | `bill_farmasi.apoteker_user_id`, snapshot nakes yang diterima Healthcare, dan `bill_farmasi.lokasi_id` | Resolve IHS dan lokasi. Jangan otomatis memakai pembuat transaksi sebagai apoteker. |
| `quantity.value`, `.unit`, `.system`, `.code`, `daysSupply` | K sesuai data jumlah dan lama persediaan obat | `bill_farmasi_detail.jumlah`, `satuan_id`, `konversi`; `lama_hari` dari resep bila berlaku | Jaga jumlah aktual dalam satuan yang dikirim. Bedakan lama yang direncanakan dari jumlah yang benar-benar diserahkan. |
| `whenPrepared`, `whenHandedOver` | K sesuai tahap pengeluaran | `bill_farmasi.disiapkan_pada`, `diserahkan_pada` | Tersimpan. Pastikan waktu tersebut dipakai dalam UTC. |
| `receiver[]` | K sesuai profil dan penerima aktual | `bill_farmasi.diterima_pasien`, `nama_penerima` | Untuk pasien gunakan referensi pasien. Untuk penerima lain, konfirmasi bentuk data yang diterima SATUSEHAT sebelum membentuk referensi. |
| `dosageInstruction[]` | K menurut aturan pakai pada pengeluaran | Snapshot dosis, signa, rute, dan lama dari resep yang diterima Farmasi | Petakan urutan aturan pakai dan kode satuan, terutama resep historis. |
| `substitution.wasSubstituted` | K jika blok `substitution` dikirim. Field ditandai wajib di blok itu pada profil resource | Belum ditemukan fakta substitusi yang dicatat saat pengeluaran | Uji profil dan catat fakta penggantian obat bila layanan mendukungnya. |
