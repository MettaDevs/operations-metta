-- Harga obat, diskon, dan biaya racik atau resep yang diubah per baris. Di beberapa klinik sistem lama (Seroja,
-- Adapotek) apoteker mengetik Harga Jual dan Diskon per baris obat (views/pharmacies/form.php), dan baris biaya racik
-- bisa diubah. Keputusan pemilik produk 17 November 2026: kemampuan ini izin tersendiri yang bawaannya tidak diberikan ke
-- role mana pun, berbeda dengan batal pembayaran kasir yang bawaannya boleh.
--
-- 1. bill_farmasi_detail: harga satuan dan % diskon hitungan sistem disimpan di samping yang dipakai. harga_satuan dan
--    persen_diskon tetap yang dipakai, jadi tagihan kasir, retur, dan total penyerahan membaca harga yang dipakai tanpa
--    berubah. Baris yang harganya berbeda dengan hitungan wajib mencatat siapa, kapan, dan alasannya; baris yang sama
--    dengan hitungan tidak mencatat apa pun. Baris yang sudah berharga diisi hitungan = yang dipakai.
-- 2. bill_farmasi_biaya: nilai hitungan disimpan di samping nilai yang dipakai, dengan catatan yang sama. Nilai yang
--    dipakai boleh 0 (biaya tidak ditagih), nilai hitungan tetap lebih dari 0.
-- 3. Izin pharmacy.line-price.override lewat duty pharmacy.line-price.manage, yang tidak diberikan ke role pemilik
--    (security_duties.diberikan_ke_pemilik, Core 0069) dan tidak ditambahkan ke role yang sudah ada.

-- 1. Harga obat --------------------------------------------------------------------------------------------------------

ALTER TABLE public.bill_farmasi_detail
    ADD COLUMN harga_satuan_hitung numeric(18,4),
    ADD COLUMN persen_diskon_hitung numeric(7,4),
    ADD COLUMN harga_diubah_pada timestamp(0) without time zone,
    ADD COLUMN harga_diubah_oleh_user_id uuid,
    ADD COLUMN alasan_ubah_harga character varying(200);

UPDATE public.bill_farmasi_detail
SET harga_satuan_hitung = harga_satuan, persen_diskon_hitung = persen_diskon
WHERE harga_satuan IS NOT NULL;

ALTER TABLE public.bill_farmasi_detail
    ADD CONSTRAINT bill_farmasi_detail_harga_hitung_check CHECK (
        (harga_satuan IS NULL) = (harga_satuan_hitung IS NULL)
        AND (persen_diskon IS NULL) = (persen_diskon_hitung IS NULL)
        AND (harga_satuan_hitung IS NULL OR harga_satuan_hitung >= 0)
        AND (persen_diskon_hitung IS NULL OR (persen_diskon_hitung >= 0 AND persen_diskon_hitung <= 100))),
    ADD CONSTRAINT bill_farmasi_detail_harga_diubah_check CHECK (
        ((harga_diubah_pada IS NULL AND harga_diubah_oleh_user_id IS NULL AND alasan_ubah_harga IS NULL)
         OR (harga_diubah_pada IS NOT NULL AND harga_diubah_oleh_user_id IS NOT NULL AND alasan_ubah_harga IS NOT NULL))
        AND (harga_diubah_pada IS NOT NULL) = (harga_satuan IS DISTINCT FROM harga_satuan_hitung
                                               OR persen_diskon IS DISTINCT FROM persen_diskon_hitung)),
    ADD CONSTRAINT bill_farmasi_detail_harga_diubah_foreign
        FOREIGN KEY (harga_diubah_oleh_user_id) REFERENCES public.users(id);

-- 2. Biaya racik dan resep ---------------------------------------------------------------------------------------------

ALTER TABLE public.bill_farmasi_biaya
    ADD COLUMN nilai_hitung numeric(19,4),
    ADD COLUMN nilai_diubah_pada timestamp(0) without time zone,
    ADD COLUMN nilai_diubah_oleh_user_id uuid,
    ADD COLUMN alasan_ubah_nilai character varying(200);

UPDATE public.bill_farmasi_biaya SET nilai_hitung = nilai;

ALTER TABLE public.bill_farmasi_biaya
    ALTER COLUMN nilai_hitung SET NOT NULL,
    DROP CONSTRAINT bill_farmasi_biaya_nilai_check,
    ADD CONSTRAINT bill_farmasi_biaya_nilai_check CHECK (nilai >= 0 AND nilai_hitung > 0),
    ADD CONSTRAINT bill_farmasi_biaya_nilai_diubah_check CHECK (
        ((nilai_diubah_pada IS NULL AND nilai_diubah_oleh_user_id IS NULL AND alasan_ubah_nilai IS NULL)
         OR (nilai_diubah_pada IS NOT NULL AND nilai_diubah_oleh_user_id IS NOT NULL AND alasan_ubah_nilai IS NOT NULL))
        AND (nilai_diubah_pada IS NOT NULL) = (nilai <> nilai_hitung)),
    ADD CONSTRAINT bill_farmasi_biaya_nilai_diubah_foreign
        FOREIGN KEY (nilai_diubah_oleh_user_id) REFERENCES public.users(id);

-- 3. Izin --------------------------------------------------------------------------------------------------------------

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
VALUES ('pharmacy.line-price.override', 'pharmacy', 'pharmacy.dispensing.form', 'correct',
        'Ubah harga obat, diskon, dan biaya racik atau resep per baris', now() AT TIME ZONE 'utc',
        now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
VALUES ('pharmacy.line-price.change', 'pharmacy', 'Mengubah harga obat, diskon, dan biaya racik atau resep per baris',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('pharmacy.line-price.change', 'pharmacy.line-price.override')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, diberikan_ke_pemilik, created_at, updated_at)
VALUES ('pharmacy.line-price.manage', 'pharmacy',
        'Ubah harga obat, diskon, dan biaya racik atau resep per baris saat menyiapkan resep dan menjual obat bebas',
        false, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('pharmacy.line-price.manage', 'pharmacy.line-price.change')
ON CONFLICT DO NOTHING;
