-- Obat pengganti dan penggantian obat resep saat Siapkan (Item Substitution di Business Central, tabel 5715, dan
-- Originally Ordered No. pada baris penjualan yang diganti lewat ItemSubstGet).
--
-- Sistem lama tidak mencatat penggantian. Petugas farmasi menghapus baris obat resep lalu menambah obat lain di form
-- penyerahan (views/pharmacies/form/details.php), jadi obat yang ditulis dokter dan alasannya hilang. Di Kuta 1, 192 dari
-- 36.947 penyerahan resep menyerahkan obat yang tidak ada di resepnya sebagai ganti obat resep. Master nama generik
-- (SIMmNamaGenerik, SIMdBarangGenerik) ada, tetapi tidak satu pun barang dipasangkan dengannya.
--
-- Permenkes 68/2010 Pasal 7 dan PP 51/2009 Pasal 24 huruf b: apoteker dapat mengganti obat merek dagang dengan obat
-- generik yang sama komponen aktifnya, atau obat merek dagang lain, atas persetujuan dokter dan/atau pasien. Karena itu
-- penggantian mencatat siapa yang menyetujuinya, dan izinnya milik apoteker, bukan asisten.
--
-- 1. far_m_obat_pengganti: obat yang boleh menggantikan sebuah obat, per legal entity, diisi sebagai data di kartu data
--    obat farmasi. Satu baris satu arah (No. → Substitute No. di BC); Interchangeable BC ditulis sebagai dua baris.
--    Satu satuan dasar obat pengganti menggantikan satu satuan dasar obat resep, jadi jumlah yang diserahkan tetap
--    dibatasi jumlah resep dalam satuan dasar.
-- 2. bill_farmasi_detail: barang_id adalah obat yang diserahkan, dan yang dipakai stok keluar, harga, tagihan kasir,
--    retur, dan etiket. barang_resep_id adalah obat yang ditulis dokter bila diganti (Originally Ordered No.), beserta
--    persetujuan, alasan, waktu, dan pengguna yang mengganti. Baris resep (far_tr_resep_detail) tidak berubah.
-- 3. Izin pharmacy.dispensing.substitute untuk duty apoteker (pharmacy.dispensing.manage). Role yang sudah memegang
--    duty itu langsung mendapatkannya; duty asisten (pharmacy.dispensing.prepare) tidak.
-- 4. Trigger versi, aktor, dan log perubahan (didaftarkan mati, pola 0016).

-- 1. Obat pengganti --------------------------------------------------------------------------------------------------

CREATE TABLE public.far_m_obat_pengganti (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    barang_id uuid NOT NULL,
    barang_pengganti_id uuid NOT NULL,
    keterangan character varying(100),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT far_m_obat_pengganti_pkey PRIMARY KEY (id),
    CONSTRAINT far_m_obat_pengganti_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT far_m_obat_pengganti_beda_check CHECK (barang_id <> barang_pengganti_id),
    CONSTRAINT far_m_obat_pengganti_barang_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, barang_id) REFERENCES public.gd_m_barang(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT far_m_obat_pengganti_pengganti_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, barang_pengganti_id)
        REFERENCES public.gd_m_barang(tenant_id, legal_entity_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX far_m_obat_pengganti_pasangan_unique
    ON public.far_m_obat_pengganti USING btree (tenant_id, barang_id, barang_pengganti_id) WHERE (deleted_at IS NULL);

-- 2. Baris penyerahan yang diganti -----------------------------------------------------------------------------------

ALTER TABLE public.bill_farmasi_detail
    ADD COLUMN barang_resep_id uuid,
    ADD COLUMN persetujuan_ganti character varying(20),
    ADD COLUMN alasan_ganti character varying(200),
    ADD COLUMN diganti_pada timestamp(0) without time zone,
    ADD COLUMN diganti_oleh_user_id uuid,
    ADD CONSTRAINT bill_farmasi_detail_ganti_check CHECK (
        (barang_resep_id IS NULL AND persetujuan_ganti IS NULL AND alasan_ganti IS NULL AND diganti_pada IS NULL
         AND diganti_oleh_user_id IS NULL)
        OR (barang_resep_id IS NOT NULL AND barang_resep_id <> barang_id AND persetujuan_ganti IS NOT NULL
            AND alasan_ganti IS NOT NULL AND diganti_pada IS NOT NULL AND diganti_oleh_user_id IS NOT NULL)),
    ADD CONSTRAINT bill_farmasi_detail_persetujuan_ganti_check
        CHECK (persetujuan_ganti IN ('dokter', 'pasien', 'dokter_dan_pasien')),
    ADD CONSTRAINT bill_farmasi_detail_barang_resep_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, barang_resep_id)
        REFERENCES public.gd_m_barang(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    ADD CONSTRAINT bill_farmasi_detail_diganti_oleh_foreign
        FOREIGN KEY (diganti_oleh_user_id) REFERENCES public.users(id);

-- 3. Izin ------------------------------------------------------------------------------------------------------------

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
VALUES ('pharmacy.dispensing.substitute', 'pharmacy', 'pharmacy.dispensing.form', 'update',
        'Ganti obat resep dengan obat pengganti', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
VALUES ('pharmacy.dispensing.substitution', 'pharmacy', 'Mengganti obat resep dengan obat pengganti',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('pharmacy.dispensing.substitution', 'pharmacy.prescription.read'),
       ('pharmacy.dispensing.substitution', 'pharmacy.dispensing.substitute')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('pharmacy.dispensing.manage', 'pharmacy.dispensing.substitution')
ON CONFLICT DO NOTHING;

UPDATE public.security_duties
SET name = 'Siapkan, ganti obat, panggil, serahkan, batal siapkan, retur, dan batalkan resep',
    updated_at = now() AT TIME ZONE 'utc'
WHERE code = 'pharmacy.dispensing.manage';

-- 4. Trigger dan log perubahan ---------------------------------------------------------------------------------------

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.far_m_obat_pengganti
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.far_m_obat_pengganti
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.far_m_obat_pengganti
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'far_m_obat_pengganti', 'Obat pengganti', 'none', 'none', 'none',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = 'far_m_obat_pengganti');
