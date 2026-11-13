-- Clerk End per mata uang (src/foundation/billing/clerk/). Jenis bayar bermata uang asing (jenis_bayar.mata_uang, 0045)
-- dihitung dalam mata uang itu: kasir menghitung lembar valuta di laci, bukan nilai rupiahnya. Perilaku baru, bukan
-- port 1:1: SIMtrClerkDetail sistem lama hanya mengenal rupiah.
--
-- clerk_detail kini membawa:
-- - mata_uang: mata uang jenis bayar itu. jumlah_sistem, jumlah_total, dan jumlah_selisih dalam mata uang ini;
-- - jumlah_sistem_lokal: jumlah sistem dalam mata uang lokal, yaitu nilai yang tersimpan di pembayaran dengan kurs
--   masing-masing;
-- - kurs: kurs Sys Admin › Kurs untuk tanggal Clerk End, 1 untuk mata uang lokal;
-- - selisih_lokal: selisih dalam mata uang lokal, jumlah_selisih x kurs dibulatkan ke presisi jumlah mata uang lokal.
-- Angka header clerk tetap mata uang lokal: jumlah total sistem, jumlah fisik dinilai dengan kurs itu, dan jumlah
-- selisih lokal. Baris yang sudah ada adalah hitungan mata uang lokal.

ALTER TABLE public.clerk_detail
    ADD COLUMN mata_uang character(3),
    ADD COLUMN jumlah_sistem_lokal numeric(19,4) DEFAULT 0 NOT NULL,
    ADD COLUMN kurs numeric(19,6) DEFAULT 1 NOT NULL,
    ADD COLUMN selisih_lokal numeric(19,4) DEFAULT 0 NOT NULL;

UPDATE public.clerk_detail
SET mata_uang = 'IDR', jumlah_sistem_lokal = jumlah_sistem, selisih_lokal = jumlah_selisih;

ALTER TABLE public.clerk_detail
    ALTER COLUMN mata_uang SET NOT NULL,
    ADD CONSTRAINT clerk_detail_kurs_check CHECK (kurs > 0),
    ADD CONSTRAINT clerk_detail_mata_uang_foreign FOREIGN KEY (tenant_id, mata_uang)
        REFERENCES public.currency_precisions(tenant_id, currency_code) ON DELETE RESTRICT ON UPDATE CASCADE;
