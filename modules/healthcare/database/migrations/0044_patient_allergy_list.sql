-- Alergi pasien menjadi daftar: satu baris per alergi, masing-masing dengan jenis, alergen, reaksi, status, pemeriksaan
-- tempat ia dicatat, serta waktu dan pencatatnya. Keputusan pemilik produk, 14 November 2026: setiap nilai yang kelak
-- dibutuhkan AllergyIntolerance SATUSEHAT dicatat di sumbernya saat terjadi, dan catatan alergi tidak ditimpa.
--
-- Sebelumnya sim_m_pasien_alergi memegang satu baris per pasien (tidak ada, satu alergi makanan, satu alergi udara, teks
-- alergi lainnya) yang ditimpa setiap Simpan, jadi alergi makanan kedua tidak bisa dicatat dan mengubahnya menghapus
-- yang lama. Alergi obat per barang ada di tabel kedua, sim_m_pasien_alergi_obat.
--
-- Sistem lama klinik:
-- - SIMtrRJRiwayatPenyakit menyimpan pernyataan alergi per kunjungan dan tidak pernah menimpanya: AlergiPasienTidakAda,
--   AlergiMakanan, AlergiUdara, dan AlergiObat (kode mAlergi), serta AlergiLainnya (teks). Di Kuta 1, 8.291 dari 22.922
--   baris mencatat Tidak Ada; kode makanan selain 00 ada di 65 baris.
-- - SIMtrRiwayatAlergiObat menyimpan daftar obat per NRM. Simpan menandai semua baris pasien Batal = 1 lalu menyisipkan
--   daftar yang berlaku, jadi baris lama tetap ada (945 dari 1.102 baris Batal).
-- - mAlergi (= sim_m_alergi, kode PCare) berisi Makanan 00..05, Obat 00..07 (golongan obat), dan Udara 00..03. Kode 00
--   "Tidak Ada" di setiap jenis berarti pasien tidak punya alergi jenis itu, bukan alergen, jadi ia tidak menjadi baris.
-- - Reaksi dan status selain Batal tidak ada di sistem lama. Keduanya ditambahkan untuk SATUSEHAT.
--
-- Di sini:
-- - kategori: makanan dan udara membawa alergi_id (sim_m_alergi jenis yang sama, diperiksa service). obat membawa tepat
--   satu dari obat_id (obat tertentu, SIMtrRiwayatAlergiObat) atau alergi_id (golongan obat, mAlergi jenis Obat).
--   lainnya membawa nama. E-Resep hanya menolak obat dari baris obat_id yang aktif; golongan obat tidak menolak resep,
--   karena tidak ada pemetaan golongan ke obat.
-- - Jenis dan alergen, pemeriksaan_id, dicatat_pada, dan dicatat_oleh tidak berubah sesudah baris dicatat. Yang bisa
--   diubah hanya reaksi dan status. Baris yang dibuang pengguna diberi deleted_at, artinya salah catat.
-- - Pencatat dicatat sebagai pengguna, seperti diukur_oleh (0039). Nakes-nya didapat lewat sim_m_nakes.user_id.
-- - Tidak ada alergi kembali menjadi pernyataan per pemeriksaan, di tabel tempat ia tinggal di sistem lama:
--   sim_tr_pemeriksaan_riwayat_penyakit.alergi_tidak_ada.
--
-- Pemetaan ke AllergyIntolerance SATUSEHAT: makanan -> category food, udara -> environment, obat -> medication, lainnya
-- -> kategori diputuskan saat dikirim; obat_id -> code KFA, alergi_id dan nama -> code (SNOMED kelak); status ->
-- clinicalStatus (aktif active, tidak_aktif inactive, sembuh resolved); pemeriksaan_id -> encounter; dicatat_pada dan
-- dicatat_oleh -> recordedDate dan recorder; reaksi -> teks sumber reaction.manifestation; baris ber-deleted_at ->
-- verificationStatus entered-in-error.
--
-- 1. Tidak ada alergi per pemeriksaan.
-- 2. Baris lama dipindah ke tabel sementara, dua tabel lama dibuang, lalu tabel daftar dibuat dan diisi. Barisnya tetap
--    ada; yang berubah hanya bentuk tabelnya. Baris alergi obat mempertahankan id-nya.
-- 3. Trigger versi, aktor, dan change log, dipasang sesudah pengisian supaya pindahan tidak tercatat sebagai perubahan
--    pengguna. Baris change_log_setup_tables sim_m_pasien_alergi sudah berjudul "Alergi pasien"; baris
--    sim_m_pasien_alergi_obat dibiarkan tanpa tabel, karena change_log_setup_tables tidak punya deleted_at.

-- 1. Tidak ada alergi --------------------------------------------------------------------------------------------

ALTER TABLE public.sim_tr_pemeriksaan_riwayat_penyakit ADD COLUMN alergi_tidak_ada boolean DEFAULT false NOT NULL;

-- Tidak ada pasien berpindah ke pemeriksaan yang terakhir menyimpannya. Pemeriksaan yang belum punya baris riwayat
-- penyakit mendapat baris yang hanya berisi pernyataan itu.
UPDATE public.sim_tr_pemeriksaan_riwayat_penyakit r
SET alergi_tidak_ada = true
FROM public.sim_m_pasien_alergi a
WHERE a.tenant_id = r.tenant_id AND a.pemeriksaan_id = r.pemeriksaan_id
  AND a.tidak_ada AND a.deleted_at IS NULL AND r.deleted_at IS NULL;

INSERT INTO public.sim_tr_pemeriksaan_riwayat_penyakit (id, tenant_id, pemeriksaan_id, alergi_tidak_ada, created_at,
                                                         updated_at, created_by_user_id, updated_by_user_id)
SELECT gen_random_uuid(), a.tenant_id, a.pemeriksaan_id, true, a.created_at, a.updated_at, a.created_by_user_id,
       a.updated_by_user_id
FROM public.sim_m_pasien_alergi a
JOIN public.sim_tr_pemeriksaan p ON p.tenant_id = a.tenant_id AND p.id = a.pemeriksaan_id
WHERE a.tidak_ada AND a.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.sim_tr_pemeriksaan_riwayat_penyakit r
                  WHERE r.tenant_id = a.tenant_id AND r.pemeriksaan_id = a.pemeriksaan_id AND r.deleted_at IS NULL);

-- 2. Daftar alergi -----------------------------------------------------------------------------------------------

-- Satu baris lama per pasien menjadi sampai tiga baris: makanan, udara, dan lainnya. Waktu dan pencatatnya adalah
-- perubahan terakhir baris lama, satu-satunya yang tercatat. Baris lama yang mencentang Tidak ada tidak menghasilkan
-- baris alergi, karena layar lama menyembunyikan isian alergi selama Tidak ada dicentang. Baris alergi obat hanya pernah
-- disisipkan lalu diberi deleted_at, jadi waktu dan pencatatnya adalah pembuatannya.
CREATE TEMP TABLE pindahan_alergi ON COMMIT DROP AS
SELECT gen_random_uuid() AS id, a.tenant_id, a.pasien_id, k.kategori, k.alergi_id, NULL::uuid AS obat_id, k.nama,
       a.pemeriksaan_id, coalesce(a.updated_at, a.created_at, now() AT TIME ZONE 'utc') AS dicatat_pada,
       coalesce(a.updated_by_user_id, a.created_by_user_id) AS dicatat_oleh, a.created_at, a.updated_at, a.deleted_at,
       a.created_by_user_id, a.updated_by_user_id, 1 AS version
FROM public.sim_m_pasien_alergi a
CROSS JOIN LATERAL (VALUES ('makanan', a.alergi_makanan_id, NULL),
                           ('udara', a.alergi_udara_id, NULL),
                           ('lainnya', NULL, nullif(btrim(a.alergi_lainnya), ''))) AS k(kategori, alergi_id, nama)
LEFT JOIN public.sim_m_alergi m ON m.tenant_id = a.tenant_id AND m.id = k.alergi_id
WHERE NOT a.tidak_ada AND (m.kode <> '00' OR k.nama IS NOT NULL)
UNION ALL
SELECT o.id, o.tenant_id, o.pasien_id, 'obat', NULL, o.obat_id, NULL, o.pemeriksaan_id,
       coalesce(o.created_at, o.updated_at, now() AT TIME ZONE 'utc'),
       coalesce(o.created_by_user_id, o.updated_by_user_id), o.created_at, o.updated_at, o.deleted_at,
       o.created_by_user_id, o.updated_by_user_id, o.version
FROM public.sim_m_pasien_alergi_obat o;

DROP TABLE public.sim_m_pasien_alergi_obat;
DROP TABLE public.sim_m_pasien_alergi;

CREATE TABLE public.sim_m_pasien_alergi (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    pasien_id uuid NOT NULL,
    kategori character varying(20) NOT NULL,
    alergi_id uuid,
    obat_id uuid,
    nama character varying(500),
    reaksi character varying(500),
    status character varying(20) DEFAULT 'aktif' NOT NULL,
    pemeriksaan_id uuid,
    dicatat_pada timestamp(0) without time zone NOT NULL,
    dicatat_oleh uuid,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_pasien_alergi_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_pasien_alergi_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT sim_m_pasien_alergi_kategori_check CHECK (kategori IN ('makanan', 'udara', 'obat', 'lainnya')),
    CONSTRAINT sim_m_pasien_alergi_status_check CHECK (status IN ('aktif', 'tidak_aktif', 'sembuh')),
    CONSTRAINT sim_m_pasien_alergi_alergen_check CHECK (CASE kategori
        WHEN 'obat' THEN (alergi_id IS NULL) <> (obat_id IS NULL) AND nama IS NULL
        WHEN 'lainnya' THEN alergi_id IS NULL AND obat_id IS NULL AND nama IS NOT NULL
        ELSE alergi_id IS NOT NULL AND obat_id IS NULL AND nama IS NULL
    END),
    CONSTRAINT sim_m_pasien_alergi_pasien_foreign
        FOREIGN KEY (tenant_id, pasien_id) REFERENCES public.sim_m_pasien(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_m_pasien_alergi_alergi_foreign
        FOREIGN KEY (tenant_id, alergi_id) REFERENCES public.sim_m_alergi(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_m_pasien_alergi_obat_foreign
        FOREIGN KEY (tenant_id, obat_id) REFERENCES public.sim_m_obat(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_m_pasien_alergi_pemeriksaan_foreign
        FOREIGN KEY (tenant_id, pemeriksaan_id) REFERENCES public.sim_tr_pemeriksaan(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX sim_m_pasien_alergi_pasien_index
    ON public.sim_m_pasien_alergi USING btree (tenant_id, pasien_id) WHERE (deleted_at IS NULL);
CREATE UNIQUE INDEX sim_m_pasien_alergi_obat_unique
    ON public.sim_m_pasien_alergi USING btree (tenant_id, pasien_id, obat_id)
    WHERE (obat_id IS NOT NULL AND deleted_at IS NULL);
CREATE UNIQUE INDEX sim_m_pasien_alergi_alergen_unique
    ON public.sim_m_pasien_alergi USING btree (tenant_id, pasien_id, kategori, alergi_id)
    WHERE (alergi_id IS NOT NULL AND deleted_at IS NULL);
-- Obat yang dipakai alergi pasien tidak bisa dihapus dari kartu obat.
CREATE INDEX sim_m_pasien_alergi_obat_index
    ON public.sim_m_pasien_alergi USING btree (tenant_id, obat_id) WHERE (obat_id IS NOT NULL AND deleted_at IS NULL);

INSERT INTO public.sim_m_pasien_alergi (id, tenant_id, pasien_id, kategori, alergi_id, obat_id, nama, pemeriksaan_id,
                                        dicatat_pada, dicatat_oleh, created_at, updated_at, deleted_at,
                                        created_by_user_id, updated_by_user_id, version)
SELECT id, tenant_id, pasien_id, kategori, alergi_id, obat_id, nama, pemeriksaan_id, dicatat_pada, dicatat_oleh,
       created_at, updated_at, deleted_at, created_by_user_id, updated_by_user_id, version
FROM pindahan_alergi;

-- 3. Trigger -----------------------------------------------------------------------------------------------------

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.sim_m_pasien_alergi
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.sim_m_pasien_alergi
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.sim_m_pasien_alergi
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();
