# Pemeriksaan kesetiaan

Daftar periksa untuk membuktikan bahwa implementasi di stack lain berperilaku sama dengan sistem ini. Sebuah module belum dianggap pindah hanya karena layarnya tampil atau test fungsionalnya lulus.

## Database

- [ ] Skema dipakai apa adanya: nama tabel, kolom, index (termasuk index unik parsial `WHERE deleted_at IS NULL`), constraint, dan trigger tidak diubah, kecuali perubahan yang membuatnya lebih baik. Perubahan itu alasannya tertulis, dikerjakan lewat migration, dan pemetaan nama lama ke nama baru tercatat di harness kesetaraan (keputusan pemilik produk 9 November 2026).
- [ ] Setiap koneksi yang menulis memasang `coreerp.user_id` lalu meresetnya bersama `coreerp.change_log` sebelum koneksi dipakai ulang. Dibuktikan dengan dua permintaan berurutan dari pengguna berbeda pada koneksi yang sama: `created_by_user_id`/`updated_by_user_id` dan `change_log_entries` mencatat pelaku yang benar.
- [ ] `version` naik lewat trigger, bukan dihitung aplikasi; klaim versi memakai `UPDATE … WHERE version = n`.
- [ ] Tidak ada `DELETE` baru pada data bisnis; Delete mengisi `deleted_at`.
- [ ] Transaksi yang menangkap pelanggaran unik (23505) di tengah jalan memakai savepoint; di PostgreSQL satu galat membatalkan seluruh transaksi.

## Isolasi dan izin

- [ ] Setiap query module menyaring `tenant_id` dari konteks tepercaya; tanpa tenant aktif hasilnya galat, bukan seluruh data.
- [ ] Saringan perusahaan aktif dan kebijakan data menghasilkan baris yang sama dengan sistem sekarang untuk kombinasi hibah: tanpa batas, per perusahaan, per unit, per unit dengan turunan, tanpa hibah.
- [ ] Rantai role → duty → privilege → permission, termasuk role anak, menghasilkan daftar izin yang sama.
- [ ] Menu Shell hanya menampilkan item yang izinnya dimiliki.
- [ ] Module tidak membaca atau menulis tabel module lain.

## Kontrak HTTP

- [ ] Kode status dan bentuk galat sama: 401, 403, 404, 409 `stale_version`/`referenced_by_children`/`idempotency_conflict`, 422 `{message, errors}` dengan kunci `details.<i>.<kolom>`, 428 `version_required`, 5xx.
- [ ] `Idempotency-Key` dihormati: kunci yang sama mengembalikan record yang sama dengan `Idempotent-Replayed: true`.
- [ ] Daftar bertahap menjawab `{data, next_cursor}`, mengurutkan NULL terakhir dengan pembeda `id`, dan tidak menghitung total.
- [ ] Route `internal/v1`, event, dan webhook tetap sesuai kontrak tertulisnya; event yang sudah terbit tidak berubah bentuk.

## Beban dan kebenaran

Syarat yang sama dengan module baru:

- [ ] 1000+ pengguna virtual serentak, 100+ tenant, 2+ instance API di belakang load balancer, database asli, 90 detik pada beban penuh.
- [ ] Nol pelanggaran lintas tenant, nol nomor dokumen ganda, nol eskalasi hak, nol error 5xx aplikasi, diverifikasi dengan SQL langsung ke database, bukan lewat API yang sedang diuji.
- [ ] Latensi diukur pada concurrency yang masih tertahan, bukan pada titik jenuh. Bandingkan dengan stack sekarang secara bergantian pada mesin yang sama.

## Layar

- [ ] Token dari `tokens.json` dipakai dengan nama yang sama; tema terang dan gelap sama dengan pratinjau.
- [ ] Setiap kartu komponen dicek terhadap keadaannya: kosong, memuat, gagal, terisi, nonaktif, baca saja, tidak valid, sedang diproses.
- [ ] Keyboard: fokus terlihat; Escape berlapis (popup dulu, lalu kartu teratas); Enter/Space membuka baris; Enter di rincian dokumen berpindah field; bantuan field bisa dibuka dengan keyboard.
- [ ] Kartu bertumpuk mempertahankan draft dan posisi gulir lapisan bawah; klik di luar tidak membuang draft.
- [ ] Teks layar memakai bahasa sehari-hari dan label perintah kanonik; tidak ada istilah arsitektur di layar bisnis; tidak ada dialog bawaan peramban.
