# ANC, INC, PNC, dan Neonatus

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Antenatal Care (ANC)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/anc/) (v2.5, rilis 2024-07-02, disunting 2025-10-02) · [Intranatal Care (INC)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/inc/) (v2.7, rilis 2024-09-10, disunting 2025-10-02) · [Postnatal Care (PNC)](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pnc/) (v3.5, rilis 2024-07-19, disunting 2025-10-02)

[Indeks SATUSEHAT](../README.md) · [Alur layanan](README.md) · [Kontrak EpisodeOfCare dan Encounter untuk ibu dan bayi](../endpoint/episode-kehamilan-dan-neonatus.md)

Panduan ini meliputi pelayanan kehamilan, persalinan, nifas, dan neonatus. Setiap kunjungan memakai Encounter sesuai pintu masuk, lalu alur program menautkannya ke EpisodeOfCare yang sesuai. Pemicu program berasal dari pelayanan yang terjadi dan identitas pasien yang bersangkutan. [ANC v2.5](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/anc/) · [INC v2.7](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/inc/) · [PNC v3.5](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/pnc/) · [Neonatus v2.6](https://satusehat.kemkes.go.id/platform/docs/id/interoperability/neonatus/)

## Prasyarat dan data Metta

| Data | Sumber dan gap |
| --- | --- |
| Identitas | Siapkan IHS ibu, bayi dan nakes serta Organization dan Location. Saat bayi belum ber-NIK, jalankan proses MPI bayi dengan identitas ibu sesuai skenario, lalu simpan IHS bayi. [Master Patient Index](../endpoint/master-data-pasien.md) |
| Kunjungan | Registrasi dan pemeriksaan tersedia. Klasifikasi ILP menyimpan `status_hamil`, `siklus_hidup_id`, dan `klaster_id` pada `sim_tr_registrasi`. Klasifikasi membantu pemilihan program, sementara HPHT, usia gestasi, kunjungan berulang dan episode tertentu memerlukan data program tersendiri. [Siklus hidup ILP](../../../../modules/healthcare/README.md#klaster-dan-siklus-hidup-ilp) |
| Data klinis | Tanda vital, diagnosis, alergi, tindakan, obat dan status pulang ada pada panel Healthcare. Perlu pencatatan terstruktur mengenai HPHT, status obstetri, janin, persalinan, hasil APGAR per bayi dan per waktu, nifas, serta tindak lanjut. [Rekam medis Metta](../../../../modules/healthcare/README.md#rekam-medis-pemeriksaan) |
| Hubungan episode dan kelahiran | Simpan ID SATUSEHAT per pasien, program, episode, Encounter dan lingkungan. Pisahkan relasi ibu–bayi, urutan bayi kembar, dan hasil tiap bayi. [Data Kelahiran dan akta](data-kelahiran-dan-akta.md) |

## Pemetaan klinis dan urutan kirim

| Modul dan bab | Isi, resource, dan kondisi |
| --- | --- |
| ANC 1–3 | Resolve ibu dan buat atau temukan episode yang aktif. Tautkan Encounter ANC. |
| ANC 4–6 | Kirim status obstetri, riwayat kehamilan dan pemeriksaan ibu/janin sebagai Observation menurut tabel. Laporan ultrasound dan pemeriksaan 10T mengikuti jenis data masing-masing. Untuk usia gestasi pada Observation, LOINC `18185-9` dan coding WHO `ANC.B6.DE17` dari `http://fhir.org/guides/who/anc-cds/CodeSystem/anc-custom-codes`. Untuk trimester, LOINC `32418-6` serta `ANC.SS.DE13` dari `http://terminology.kemkes.go.id/CodeSystem/anc-custom-codes`. Isi nilai dan satuan sesuai definisi variabel. |
| ANC 7–17 | Hasil penunjang menurut order dan fakta yang dilakukan, kemudian Condition, Procedure, edukasi/tindak lanjut, farmasi dan data pulang. Gunakan ServiceRequest untuk layanan yang diminta, lalu finalisasi Encounter. Penutupan episode menunggu kejadian akhir kehamilan. |
| INC 1–4 | Resolve ibu dan Encounter persalinan. Temukan dan tutup ANC sesuai bab 3. Observation persalinan dapat mencatat usia gestasi `18185-9`, waktu persalinan `93857-1`, gravida `11996-6`, partus `11977-6`, abortus `69043-8`, seluruhnya LOINC. |
| INC 5–11 | Pisahkan hasil ibu dan hasil bayi. Observation pelaksanaan dapat membawa LOINC `57071-3` untuk cara persalinan dan `OC000013` dari terminologi modul untuk penolong. Untuk bayi, skor total APGAR menit pertama, kelima, kesepuluh memakai LOINC `9272-6`, `9274-2`, `9271-8`. Laporkan komponen APGAR sesuai menit jika dinilai, berat lahir `8339-4`, panjang lahir `89269-5`, lokasi `72150-6` dan IMD sesuai fakta. Diagnosis, tindakan, obat dan pulang mengikuti resource layanan. |
| PNC 1–5 | Resolve pasien, Encounter dan EpisodeOfCare PNC. Catat ulang fakta persalinan serta status obstetri yang diperlukan, dan pemeriksaan pelayanan nifas sebagai Observation sesuai bab 4–5. Bedakan hasil ukur dari jawaban klinis serta data dari episode persalinan. |
| PNC 6–15 | Kirim penunjang dan Diagnosis/Procedure/obat saat berlaku. Kaitkan rencana, rujukan dan instruksi, lalu finalisasi Encounter dan tutup episode nifas saat selesai. |
| Neonatus 1–7 | Resolve IHS bayi, Encounter dan EpisodeOfCare. Catat jam lahir `57715-5` (LOINC), urutan anak `365475008` (SNOMED CT), serta data neonatal dan pemeriksaan head to toe menurut bab. Pelayanan esensial mencakup antropometri, vital, APGAR, IMD, dan prosedur/obat bila dilakukan. |
| Neonatus 8–12 | Laporkan SHK bila ada dan kirim Observation pertumbuhan/ASI sesuai bab 9. Diagnosis, tindakan, farmasi memakai konteks pasien bayi. [SHK dan tes konfirmasi](skrining-hipotiroid-kongenital.md) |
| Neonatus 13–18 | Rencana, rujukan dan instruksi sesuai fakta. Finalisasi Encounter lalu tutup EpisodeOfCare saat program selesai. |

Kirim resource dasar melalui `POST /fhir-r4/v1/{Resource}` untuk operasi yang didukung. Tunggu ID order, pemeriksaan dan hasil sebelum dipakai sebagai referensi. Untuk laboratorium, ikuti [Kontrak Lab](laboratorium-rujukan-spesimen.md). Untuk obat, pakai [Matriks Farmasi](../payload/matriks-farmasi.md). Pemetaan field bertanda wajib per bab ada pada [Profil program ibu dan bayi](../payload/profil-field-program-ibu-dan-bayi.md).

## Error, rekonsiliasi dan Sandbox

- Saat create timeout, cari episode aktif yang cocok, periksa ID dan catatan pemicu lokal, lalu lanjutkan resource berikut berdasarkan hasil. Referensi bagi ibu tidak boleh menggantikan Patient bayi saat mengirim hasil bayi.
- Untuk `400`/`422` baca `OperationOutcome.issue[]` dan kode validasi aktual. Untuk `401`/`403`, periksa peran dan Organization. Gunakan retry terbatas untuk error sementara setelah rekonsiliasi. [Penanganan error](../validasi/respons-dan-error.md)
- Simpan korelasi fixture, jenis operasi, waktu, status dan kode hasil. HPHT, persalinan, riwayat keluarga, pengenal pasien dan payload klinis disimpan pada akses terbatas.

| Skenario | Kriteria lulus |
| --- | --- |
| ANC berulang | Dua kunjungan ANC pasien yang sama menunjuk satu episode aktif. Data gestasi dan tanggal cocok dengan rujukan klinis. Simulasikan respons create hilang dan pastikan integrasi tidak menggandakan episode. |
| Persalinan dan bayi kembar | Episode ANC selesai melalui PATCH. Encounter persalinan berkonteks ibu, tiap hasil bayi dapat dibaca dengan Patient dan referensi yang semestinya. |
| Nifas dan neonatal | Episode PNC mengikat pasien ibu dan episode Neonate mengikat pasien bayi. Riwayat kunjungan dan tanggal penutupan bisa direkonsiliasi per program. |
| Kegagalan | Uji profil salah, hasil pencarian multi-episode, ID beda lingkungan dan akses organisasi yang tidak berhak. Buktikan status, penolakan, dan alur koreksi. |

Belum ada bukti langsung Sandbox Metta untuk keempat program. [Status bukti](../pengujian/skenario-sandbox.md#status-bukti)
