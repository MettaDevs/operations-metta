-- Isian form Komponen jasa sistem lama (Admin → Setup Jasa → Komponen jasa, modules/admin/service/views/component/form.php)
-- di komponen biaya. Arahan pemilik produk 13 November 2026: jasa, komponen jasa, dan semua turunannya dipindah 1:1
-- dari sistem lama lebih dulu, perbaikan sesudahnya.
--
-- Kelompok rekening (KelompokAkun), posting ke (PostinganKe), hutang ke (HutangKe), dan kelompok jasa (KelompokJasa)
-- adalah daftar tetap di kode sistem lama (Component_model::dropdown_static), jadi di sini katalog kode
-- (charge-component.options.ts) dengan kode yang sama. Include insentif dan exclude cost RS adalah centang form itu.
-- Akun HPP dan akun lawan HPP menunggu bagan akun finance.
--
-- Nilai bawaan kolom mengikuti komponen DT76 Pelayanan Kuta (Pendapatan, GL, None, Jasa Pelayanan), padanan komponen
-- bawaan PELAYANAN dari 0033, jadi komponen yang sudah ada mendapat makna itu.

ALTER TABLE public.komponen_biaya
    ADD COLUMN kelompok_rekening character varying(20) DEFAULT 'Pendapatan' NOT NULL,
    ADD COLUMN posting_ke character varying(20) DEFAULT 'GL' NOT NULL,
    ADD COLUMN hutang_ke character varying(40) DEFAULT 'None' NOT NULL,
    ADD COLUMN kelompok_jasa character varying(20) DEFAULT 'Jasa Pelayanan' NOT NULL,
    ADD COLUMN include_insentif boolean DEFAULT false NOT NULL,
    ADD COLUMN exclude_cost_rs boolean DEFAULT false NOT NULL;
