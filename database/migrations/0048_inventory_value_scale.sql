-- Nilai persediaan mengikuti presisi jumlah mata uang tenant (Sys Admin › Mata uang), bukan dua angka di belakang koma
-- yang ditulis mati di kode. Kolom nilai kartu gudang dan mutasi dilebarkan ke numeric(19,4), skala terbesar presisi
-- jumlah, sama dengan kolom uang kasir dan tarif. Pembulatannya tetap di kode (src/foundation/inventory/quantity.ts),
-- seperti Round di BC; kolom hanya harus cukup lebar untuk menyimpan hasilnya. Baris yang ada tidak berubah nilainya.

ALTER TABLE public.gd_tr_kartu_gudang ALTER COLUMN nilai TYPE numeric(19,4);
ALTER TABLE public.gd_tr_mutasi_detail ALTER COLUMN nilai TYPE numeric(19,4);
ALTER TABLE public.gd_tr_mutasi_terima_detail ALTER COLUMN nilai TYPE numeric(19,4);
