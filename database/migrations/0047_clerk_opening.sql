-- Uang awal laci saat Clerk Start (src/foundation/billing/clerk/). Perilaku baru, bukan port 1:1: SIMtrClerk sistem lama
-- tidak punya uang awal, jadi uang yang sudah ada di laci saat sesi dimulai tidak tercatat di mana pun. Akibatnya
-- kembalian rupiah untuk tunai valuta yang lebih besar dari rupiah yang diterima membuat tunai rupiah sistem negatif, dan
-- Clerk End menampilkan selisih palsu sebesar kembalian itu, karena jumlah fisik tidak bisa negatif. Polanya mengikuti
-- starting amount dan float entry Commerce F&O: uang awal dihitung saat sesi dimulai, per jenis bayar tunai dalam mata
-- uangnya, lalu masuk ke jumlah yang diharapkan saat tender declaration.
--
-- 1. Tabel clerk_uang_awal: satu baris per jenis bayar tunai yang diisi uang awalnya saat Clerk Start, dalam mata uang
--    jenis bayar itu. Hanya uang awal bukan nol yang ditulis.
-- 2. clerk_detail.uang_awal: salinan uang awal saat Clerk End, supaya baris hasil Clerk End lengkap sendiri seperti
--    jumlah_sistem. jumlah_sistem tetap penjualan sesi itu, dan jumlah_selisih = jumlah_total - uang_awal -
--    jumlah_sistem.
-- 3. clerk.jumlah_uang_awal: uang awal semua jenis bayar dalam mata uang lokal, dinilai dengan kurs hari Clerk End
--    seperti jumlah_total_clerk, diisi saat Clerk End.

-- 1. Uang awal ------------------------------------------------------------------------------------------------------

CREATE TABLE public.clerk_uang_awal (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    clerk_id uuid NOT NULL,
    jenis_bayar_id uuid NOT NULL,
    mata_uang character(3) NOT NULL,
    jumlah numeric(19,4) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    CONSTRAINT clerk_uang_awal_pkey PRIMARY KEY (id),
    CONSTRAINT clerk_uang_awal_jenis_bayar_unique UNIQUE (clerk_id, jenis_bayar_id),
    CONSTRAINT clerk_uang_awal_jumlah_check CHECK (jumlah > 0),
    CONSTRAINT clerk_uang_awal_clerk_foreign
        FOREIGN KEY (tenant_id, clerk_id) REFERENCES public.clerk(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT clerk_uang_awal_jenis_bayar_foreign
        FOREIGN KEY (tenant_id, jenis_bayar_id) REFERENCES public.jenis_bayar(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT clerk_uang_awal_mata_uang_foreign FOREIGN KEY (tenant_id, mata_uang)
        REFERENCES public.currency_precisions(tenant_id, currency_code) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.clerk_uang_awal
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();

-- 2. Uang awal di hasil Clerk End -----------------------------------------------------------------------------------

ALTER TABLE public.clerk_detail DROP COLUMN jumlah_selisih;
ALTER TABLE public.clerk_detail
    ADD COLUMN uang_awal numeric(19,4) DEFAULT 0 NOT NULL,
    ADD CONSTRAINT clerk_detail_uang_awal_check CHECK (uang_awal >= 0);
ALTER TABLE public.clerk_detail
    ADD COLUMN jumlah_selisih numeric(19,4) GENERATED ALWAYS AS (jumlah_total - uang_awal - jumlah_sistem) STORED;

-- 3. Uang awal di header --------------------------------------------------------------------------------------------

ALTER TABLE public.clerk ADD COLUMN jumlah_uang_awal numeric(19,4) DEFAULT 0 NOT NULL;
