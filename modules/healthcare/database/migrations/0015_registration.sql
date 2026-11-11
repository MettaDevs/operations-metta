-- Pendaftaran kunjungan rawat jalan (R4): petugas mendaftarkan pasien ke satu section dan satu nakes yang punya jadwal
-- praktik hari itu. Kunjungan mendapat nomor registrasi (NoReg), nomor bukti pemeriksaan (NoBukti), dan nomor antrean,
-- dan cara bayarnya ditulis balik ke cara bayar utama pasien seperti sistem lama. Keputusan pemilik produk,
-- 11 November 2026.
--
-- Bentuknya mengikuti sistem lama: kepala SIMtrRegistrasi dan tujuan per section SIMtrDataRegPasien. Padanan
-- Microsoft: Encounter di Cloud for Healthcare. Yang sengaja berbeda dari sistem lama:
-- - Kunci relasi uuid. NoReg dan NoBukti nomor bisnis dari Nomor dokumen, unik per tenant, bukan foreign key.
-- - Nomor antrean diterbitkan server dari penghitung atomik, tidak pernah diterima dari klien. Sistem lama mengirim
--   nomornya dari layar, dan 15-23% kunjungannya bernomor antrean kembar.
-- - Kuota jadwal diperiksa dan jumlah terdaftar dinaikkan di bawah kunci baris jadwal.
--
-- 1. Katalog izin: permission read/create/cancel, privilege lihat/daftarkan/batalkan, duty "Lihat kunjungan" dan
--    "Daftarkan kunjungan". Role pemilik tenant yang sudah memasang module ini mendapat keduanya; tenant yang memasang
--    sesudahnya mendapatkannya dari installModule. Permission kunjungan ikut dilindungi kebijakan data per unit pasien,
--    karena kunjungan milik satu operating unit.
-- 2. Reference nomor: healthcare.visit-number (NoReg) dan healthcare.examination-number (NoBukti), satu sequence per
--    operating unit. Nomornya unik per tenant (numbers_unique_per_scope false), jadi format bawaan mencetak nomor unit:
--    <nomor unit>-REG-00000001 dan <nomor unit>-RJ-00000001. Unit tanpa nomor unit ditolak NumberIssuer saat
--    menerbitkan, dengan pesan untuk mengisinya.
-- 3. Data acuan per tenant: keadaan pasien dan skrining visual (kategori beserta tandanya). Isinya baris database,
--    bukan daftar di kode, dan tenant boleh mengubahnya.
-- 4. Tabel kunjungan, tujuan, keadaan dan skrining kunjungan, serta penghitung antrean.
-- 5. Change log.
-- 6. Sequence nomor dan data acuan untuk tenant yang sudah memasang module ini. Tenant yang memasang sesudahnya:
--    sequence dari Core (default_per_operating_unit, lewat installModule dan organisasi baru), data acuan dari trigger
--    pada catatan pemasangan.
--
-- Belum ada menu: layar pendaftaran menyusul (R5). Event healthcare.visit.registered.v1 juga belum diterbitkan, karena
-- repo ini belum punya penerbit event maupun kontrak event.

-- 1. Katalog izin --------------------------------------------------------------------------------------------------

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('healthcare.visit.form', 'healthcare', 'Layar pendaftaran kunjungan', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
VALUES ('healthcare.visit.read', 'healthcare', 'healthcare.visit.form', 'read', 'Lihat kunjungan',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.visit.create', 'healthcare', 'healthcare.visit.form', 'create', 'Daftarkan kunjungan',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.visit.cancel', 'healthcare', 'healthcare.visit.form', 'delete', 'Batalkan kunjungan',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
VALUES ('healthcare.visit.view', 'healthcare', 'Melihat kunjungan', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.visit.register', 'healthcare', 'Mendaftarkan kunjungan',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.visit.void', 'healthcare', 'Membatalkan kunjungan',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('healthcare.visit.view', 'healthcare.visit.read'),
       ('healthcare.visit.register', 'healthcare.visit.read'),
       ('healthcare.visit.register', 'healthcare.visit.create'),
       ('healthcare.visit.void', 'healthcare.visit.read'),
       ('healthcare.visit.void', 'healthcare.visit.cancel')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
VALUES ('healthcare.visit.inquire', 'healthcare', 'Lihat kunjungan', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.visit.manage', 'healthcare', 'Daftarkan dan batalkan kunjungan',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('healthcare.visit.inquire', 'healthcare.visit.view'),
       ('healthcare.visit.manage', 'healthcare.visit.register'),
       ('healthcare.visit.manage', 'healthcare.visit.void')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT r.id, d.code
FROM public.roles r
CROSS JOIN (VALUES ('healthcare.visit.inquire'), ('healthcare.visit.manage')) AS d(code)
WHERE r.is_owner AND r.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM public.core_module_installations i
              WHERE i.tenant_id = r.tenant_id AND i.module_id = 'healthcare' AND i.status = 'installed')
ON CONFLICT DO NOTHING;

-- Kunjungan milik satu operating unit, sama dengan pasien milik unit pendaftarnya: unit yang diberikan kepada pengguna
-- lewat kebijakan data pasien juga membatasi kunjungan yang boleh ia daftarkan dan lihat.
UPDATE public.app_data_policies
SET name = 'Akses pasien dan kunjungan menurut unit kerja',
    protected_permissions = (
        SELECT json_agg(code ORDER BY code)
        FROM (SELECT jsonb_array_elements_text(protected_permissions::jsonb) AS code
              UNION
              SELECT unnest(ARRAY['healthcare.visit.read', 'healthcare.visit.create', 'healthcare.visit.cancel'])) codes),
    updated_at = now() AT TIME ZONE 'utc'
WHERE code = 'healthcare.patient-unit';

-- 2. Reference nomor -----------------------------------------------------------------------------------------------

-- Delapan digit: 300 kunjungan sehari per unit baru menghabiskannya setelah ratusan tahun, jadi nomor tidak perlu
-- direset per tahun. Admin bebas mengubah formatnya di Nomor dokumen sebelum nomor pertama terbit.
INSERT INTO public.app_number_sequence_references (id, app_id, code, name, allowed_scopes, default_prefix,
                                                  default_settings, default_per_operating_unit,
                                                  numbers_unique_per_scope, created_at, updated_at)
VALUES ('019a7a10-5c00-7000-8000-000000000001', 'healthcare', 'healthcare.visit-number',
        'Nomor registrasi kunjungan (NoReg)', '["operating_unit"]', NULL,
        '{"minimum_number":1,"maximum_number":99999999,"segments":[{"type":"scope"},{"type":"constant","value":"-REG-"},{"type":"number","length":8}]}',
        true, false, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('019a7a10-5c00-7000-8000-000000000002', 'healthcare', 'healthcare.examination-number',
        'Nomor bukti pemeriksaan (NoBukti)', '["operating_unit"]', NULL,
        '{"minimum_number":1,"maximum_number":99999999,"segments":[{"type":"scope"},{"type":"constant","value":"-RJ-"},{"type":"number","length":8}]}',
        true, false, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

-- 3. Data acuan ----------------------------------------------------------------------------------------------------

-- Keadaan atau kelainan pasien yang dicentang saat pendaftaran, misalnya Difabel atau Lansia.
CREATE TABLE public.sim_m_keadaan_pasien (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    nama character varying(100) NOT NULL,
    urutan smallint DEFAULT 0 NOT NULL,
    aktif boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_keadaan_pasien_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_keadaan_pasien_tenant_id_id_unique UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX sim_m_keadaan_pasien_nama_unique
    ON public.sim_m_keadaan_pasien USING btree (tenant_id, lower((nama)::text)) WHERE (deleted_at IS NULL);

-- Kategori skrining visual. tingkat 1 paling gawat; kategori kunjungan adalah kategori paling gawat di antara tanda
-- yang dicentang. warna adalah nama token warna layar, misalnya triage-red.
CREATE TABLE public.sim_m_skrining_kategori (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    nama character varying(50) NOT NULL,
    tingkat smallint NOT NULL,
    warna character varying(40) NOT NULL,
    aktif boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_skrining_kategori_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_skrining_kategori_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT sim_m_skrining_kategori_tingkat_check CHECK (tingkat > 0)
);
CREATE UNIQUE INDEX sim_m_skrining_kategori_nama_unique
    ON public.sim_m_skrining_kategori USING btree (tenant_id, lower((nama)::text)) WHERE (deleted_at IS NULL);

CREATE TABLE public.sim_m_skrining_tanda (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kategori_id uuid NOT NULL,
    nama character varying(150) NOT NULL,
    urutan smallint DEFAULT 0 NOT NULL,
    aktif boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_skrining_tanda_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_skrining_tanda_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT sim_m_skrining_tanda_kategori_foreign
        FOREIGN KEY (tenant_id, kategori_id) REFERENCES public.sim_m_skrining_kategori(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_m_skrining_tanda_nama_unique
    ON public.sim_m_skrining_tanda USING btree (tenant_id, kategori_id, lower((nama)::text)) WHERE (deleted_at IS NULL);

-- Isi bawaan untuk satu tenant. Setiap tabel diisi hanya bila tenant belum punya baris sama sekali di tabel itu,
-- termasuk yang sudah dihapus, sehingga pemasangan ulang tidak mengembalikan pilihan yang sengaja dihapus tenant.
CREATE FUNCTION public.sim_isi_acuan_registrasi(p_tenant uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.sim_m_keadaan_pasien WHERE tenant_id = p_tenant) THEN
        INSERT INTO public.sim_m_keadaan_pasien (id, tenant_id, nama, urutan, created_at, updated_at)
        SELECT gen_random_uuid(), p_tenant, k.nama, k.urutan, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
        FROM (VALUES ('Handaya', 1), ('Difabel', 2), ('Lansia', 3), ('Lain-lain', 4)) AS k(nama, urutan);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sim_m_skrining_kategori WHERE tenant_id = p_tenant) THEN
        INSERT INTO public.sim_m_skrining_kategori (id, tenant_id, nama, tingkat, warna, created_at, updated_at)
        SELECT gen_random_uuid(), p_tenant, k.nama, k.tingkat, k.warna,
               now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
        FROM (VALUES ('Merah', 1, 'triage-red'), ('Oranye', 2, 'triage-orange'), ('Kuning', 3, 'triage-yellow'),
                     ('Hijau', 4, 'triage-green')) AS k(nama, tingkat, warna);
        INSERT INTO public.sim_m_skrining_tanda (id, tenant_id, kategori_id, nama, urutan, created_at, updated_at)
        SELECT gen_random_uuid(), p_tenant, k.id, t.nama, t.urutan, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
        FROM (VALUES ('Merah', 'Tidak sadarkan diri / pingsan', 1),
                     ('Merah', 'Nadi tidak teraba / henti jantung', 2),
                     ('Merah', 'Tidak bernapas / kesulitan bernapas', 3),
                     ('Merah', 'Kejang berulang / kejang lama', 4),
                     ('Oranye', 'Nyeri hebat', 1),
                     ('Oranye', 'Nyeri dada', 2),
                     ('Kuning', 'Tampak pucat', 1),
                     ('Kuning', 'Sempoyongan', 2),
                     ('Kuning', 'Lemas', 3),
                     ('Hijau', 'Kondisi stabil', 1)) AS t(kategori, nama, urutan)
        JOIN public.sim_m_skrining_kategori k ON k.tenant_id = p_tenant AND k.nama = t.kategori;
    END IF;
END;
$$;

-- Tenant yang memasang module ini sesudah migration ini mendapat data acuan saat catatan pemasangannya ditulis
-- (installModule), di transaksi yang sama. Migration module berjalan sekali per database, sedangkan di database bersama
-- tenant lain dapat memasang module jauh sesudahnya; catatan pemasangan adalah satu-satunya titik yang dilewati setiap
-- jalur pemasangan (sync_entitlements, dev:setup, dan test).
CREATE FUNCTION public.sim_isi_acuan_registrasi_saat_dipasang() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM public.sim_isi_acuan_registrasi(NEW.tenant_id);
    RETURN NULL;
END;
$$;
CREATE TRIGGER sim_isi_acuan_registrasi AFTER INSERT OR UPDATE OF status ON public.core_module_installations
    FOR EACH ROW WHEN (NEW.module_id = 'healthcare' AND NEW.status = 'installed')
    EXECUTE FUNCTION public.sim_isi_acuan_registrasi_saat_dipasang();

-- 4. Kunjungan -----------------------------------------------------------------------------------------------------

-- Kepala kunjungan. Legal entity dan unit ditulis sekali dari tempat kerja dan section tujuan. Cara bayar, umur, dan
-- kategori skrining adalah salinan saat mendaftar. status: terdaftar -> diperiksa -> selesai, atau terdaftar -> batal;
-- perpindahannya dijaga service. jenis_kunjungan lama bila pasien sudah punya kunjungan yang tidak batal di bulan
-- kalender yang sama, aturan sistem lama.
CREATE TABLE public.sim_tr_registrasi (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    no_reg character varying(50) NOT NULL,
    creation_key character varying(160) NOT NULL,
    legal_entity_id uuid NOT NULL,
    operating_unit_id uuid NOT NULL,
    pasien_id uuid NOT NULL,
    tanggal date NOT NULL,
    didaftarkan_pada timestamp(0) without time zone NOT NULL,
    tipe_pasien_id uuid NOT NULL,
    penjamin_id uuid,
    no_kartu character varying(50),
    tinggi_badan numeric(5,1),
    berat_badan numeric(5,1),
    status_kunjungan character varying(10) NOT NULL,
    umur_tahun smallint,
    umur_bulan smallint,
    umur_hari smallint,
    jenis_kunjungan character varying(10) NOT NULL,
    kategori_skrining_id uuid,
    status character varying(20) DEFAULT 'terdaftar' NOT NULL,
    batal_oleh uuid,
    batal_pada timestamp(0) without time zone,
    alasan_batal character varying(200),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_tr_registrasi_pkey PRIMARY KEY (id),
    CONSTRAINT sim_tr_registrasi_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT sim_tr_registrasi_creation_key_unique UNIQUE (tenant_id, creation_key),
    CONSTRAINT sim_tr_registrasi_status_kunjungan_check CHECK (status_kunjungan IN ('sakit', 'sehat')),
    CONSTRAINT sim_tr_registrasi_jenis_kunjungan_check CHECK (jenis_kunjungan IN ('baru', 'lama')),
    CONSTRAINT sim_tr_registrasi_status_check CHECK (status IN ('terdaftar', 'diperiksa', 'selesai', 'batal')),
    CONSTRAINT sim_tr_registrasi_batal_check
        CHECK ((status = 'batal') = (batal_pada IS NOT NULL AND alasan_batal IS NOT NULL)),
    CONSTRAINT sim_tr_registrasi_tinggi_check CHECK (tinggi_badan IS NULL OR tinggi_badan > 0),
    CONSTRAINT sim_tr_registrasi_berat_check CHECK (berat_badan IS NULL OR berat_badan > 0),
    CONSTRAINT sim_tr_registrasi_pasien_foreign
        FOREIGN KEY (tenant_id, pasien_id) REFERENCES public.sim_m_pasien(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_registrasi_tipe_pasien_foreign
        FOREIGN KEY (tenant_id, tipe_pasien_id) REFERENCES public.sim_m_tipe_pasien(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_registrasi_penjamin_foreign
        FOREIGN KEY (tenant_id, penjamin_id) REFERENCES public.sim_m_penjamin(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_registrasi_kategori_skrining_foreign
        FOREIGN KEY (tenant_id, kategori_skrining_id)
        REFERENCES public.sim_m_skrining_kategori(tenant_id, id) ON DELETE RESTRICT
);
-- NoReg unik per tenant, bukan per unit (rencana registrasi bagian 3): menyalakan sharing pemeriksaan antar legal
-- entity kelak tidak memerlukan penomoran ulang.
CREATE UNIQUE INDEX sim_tr_registrasi_no_reg_unique
    ON public.sim_tr_registrasi USING btree (tenant_id, no_reg) WHERE (deleted_at IS NULL);
CREATE INDEX sim_tr_registrasi_tanggal_index
    ON public.sim_tr_registrasi USING btree (tenant_id, tanggal, operating_unit_id) WHERE (deleted_at IS NULL);
CREATE INDEX sim_tr_registrasi_pasien_index
    ON public.sim_tr_registrasi USING btree (tenant_id, pasien_id, tanggal) WHERE (deleted_at IS NULL);

-- Tujuan kunjungan per section. Pendaftaran sekarang menulis tepat satu tujuan (urutan 1); kunjungan lewat lebih dari
-- satu section menyusul. nakes_id adalah nakes yang benar-benar praktik di jadwal itu, yaitu pengganti bila ada.
-- jadwal_praktik_id dan nakes_id kosong hanya untuk section yang tidak punya jadwal apa pun hari itu. ruangan_id diisi
-- kelak saat ruangan memanggil pasien.
CREATE TABLE public.sim_tr_registrasi_tujuan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    registrasi_id uuid NOT NULL,
    urutan smallint NOT NULL,
    section_id uuid NOT NULL,
    jadwal_praktik_id uuid,
    nakes_id uuid,
    no_antrean integer NOT NULL,
    kode_antrean character varying(20) NOT NULL,
    no_bukti character varying(50) NOT NULL,
    status character varying(20) DEFAULT 'menunggu' NOT NULL,
    ruangan_id uuid,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_tr_registrasi_tujuan_pkey PRIMARY KEY (id),
    CONSTRAINT sim_tr_registrasi_tujuan_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT sim_tr_registrasi_tujuan_status_check
        CHECK (status IN ('menunggu', 'dipanggil', 'diperiksa', 'selesai', 'batal')),
    CONSTRAINT sim_tr_registrasi_tujuan_antrean_check CHECK (no_antrean > 0),
    CONSTRAINT sim_tr_registrasi_tujuan_jadwal_check CHECK ((jadwal_praktik_id IS NULL) = (nakes_id IS NULL)),
    CONSTRAINT sim_tr_registrasi_tujuan_registrasi_foreign
        FOREIGN KEY (tenant_id, registrasi_id) REFERENCES public.sim_tr_registrasi(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_registrasi_tujuan_section_foreign
        FOREIGN KEY (tenant_id, section_id) REFERENCES public.sim_m_section(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_registrasi_tujuan_jadwal_foreign
        FOREIGN KEY (tenant_id, jadwal_praktik_id)
        REFERENCES public.sim_tr_jadwal_praktik(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_registrasi_tujuan_nakes_foreign
        FOREIGN KEY (tenant_id, nakes_id) REFERENCES public.sim_m_nakes(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_registrasi_tujuan_ruangan_foreign
        FOREIGN KEY (tenant_id, ruangan_id) REFERENCES public.sim_m_ruangan(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_tr_registrasi_tujuan_urutan_unique
    ON public.sim_tr_registrasi_tujuan USING btree (tenant_id, registrasi_id, urutan) WHERE (deleted_at IS NULL);
-- NoBukti unik per tenant, alasannya sama dengan NoReg.
CREATE UNIQUE INDEX sim_tr_registrasi_tujuan_no_bukti_unique
    ON public.sim_tr_registrasi_tujuan USING btree (tenant_id, no_bukti) WHERE (deleted_at IS NULL);
CREATE INDEX sim_tr_registrasi_tujuan_section_index
    ON public.sim_tr_registrasi_tujuan USING btree (tenant_id, section_id) WHERE (deleted_at IS NULL);

CREATE TABLE public.sim_tr_registrasi_keadaan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    registrasi_id uuid NOT NULL,
    keadaan_id uuid NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_tr_registrasi_keadaan_pkey PRIMARY KEY (id),
    CONSTRAINT sim_tr_registrasi_keadaan_registrasi_foreign
        FOREIGN KEY (tenant_id, registrasi_id) REFERENCES public.sim_tr_registrasi(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_registrasi_keadaan_keadaan_foreign
        FOREIGN KEY (tenant_id, keadaan_id) REFERENCES public.sim_m_keadaan_pasien(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_tr_registrasi_keadaan_unique
    ON public.sim_tr_registrasi_keadaan USING btree (tenant_id, registrasi_id, keadaan_id) WHERE (deleted_at IS NULL);

CREATE TABLE public.sim_tr_registrasi_skrining (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    registrasi_id uuid NOT NULL,
    tanda_id uuid NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_tr_registrasi_skrining_pkey PRIMARY KEY (id),
    CONSTRAINT sim_tr_registrasi_skrining_registrasi_foreign
        FOREIGN KEY (tenant_id, registrasi_id) REFERENCES public.sim_tr_registrasi(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_registrasi_skrining_tanda_foreign
        FOREIGN KEY (tenant_id, tanda_id) REFERENCES public.sim_m_skrining_tanda(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_tr_registrasi_skrining_unique
    ON public.sim_tr_registrasi_skrining USING btree (tenant_id, registrasi_id, tanda_id) WHERE (deleted_at IS NULL);

-- Penghitung antrean: nomor terakhir per section per hari (mode bersama), atau per jadwal praktik (mode per_jadwal).
-- Pendaftaran menaikkannya dengan INSERT ... ON CONFLICT DO UPDATE ... RETURNING di transaksi kunjungan, jadi dua
-- pendaftaran serentak tidak pernah mendapat nomor yang sama dan nomor kembali bila pendaftaran gagal. Baris penghitung
-- tidak pernah dihapus atau diubah tangan, jadi ia tidak membawa deleted_at maupun version.
CREATE TABLE public.sim_tr_antrean_penghitung (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    section_id uuid NOT NULL,
    tanggal date NOT NULL,
    jadwal_praktik_id uuid,
    nomor_terakhir integer NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT sim_tr_antrean_penghitung_pkey PRIMARY KEY (id),
    CONSTRAINT sim_tr_antrean_penghitung_unique UNIQUE NULLS NOT DISTINCT (tenant_id, section_id, tanggal, jadwal_praktik_id),
    CONSTRAINT sim_tr_antrean_penghitung_section_foreign
        FOREIGN KEY (tenant_id, section_id) REFERENCES public.sim_m_section(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_antrean_penghitung_jadwal_foreign
        FOREIGN KEY (tenant_id, jadwal_praktik_id)
        REFERENCES public.sim_tr_jadwal_praktik(tenant_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.sim_m_keadaan_pasien
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.sim_m_skrining_kategori
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.sim_m_skrining_tanda
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.sim_tr_registrasi
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.sim_tr_registrasi_tujuan
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.sim_tr_registrasi_keadaan
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.sim_tr_registrasi_skrining
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.sim_m_keadaan_pasien
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.sim_m_skrining_kategori
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.sim_m_skrining_tanda
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.sim_tr_registrasi
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.sim_tr_registrasi_tujuan
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.sim_tr_registrasi_keadaan
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.sim_tr_registrasi_skrining
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.sim_m_keadaan_pasien
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.sim_m_skrining_kategori
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.sim_m_skrining_tanda
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.sim_tr_registrasi
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.sim_tr_registrasi_tujuan
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.sim_tr_registrasi_keadaan
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.sim_tr_registrasi_skrining
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

-- 5. Change log ----------------------------------------------------------------------------------------------------

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, t.table_name, t.caption, 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('sim_m_keadaan_pasien', 'Keadaan pasien'),
             ('sim_m_skrining_kategori', 'Kategori skrining'),
             ('sim_m_skrining_tanda', 'Tanda skrining'),
             ('sim_tr_registrasi', 'Kunjungan'),
             ('sim_tr_registrasi_tujuan', 'Tujuan kunjungan'),
             ('sim_tr_registrasi_keadaan', 'Keadaan pasien pada kunjungan'),
             ('sim_tr_registrasi_skrining', 'Skrining pada kunjungan')) AS t(table_name, caption)
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = t.table_name);

-- 6. Tenant yang sudah memasang module ini --------------------------------------------------------------------------

SELECT public.sim_isi_acuan_registrasi(i.tenant_id)
FROM (SELECT DISTINCT tenant_id FROM public.core_module_installations
      WHERE module_id = 'healthcare' AND status = 'installed') i;

-- Setelan sama dengan yang dibuat NumberSequences.createUnitDefaults: bawaan skill number-sequence-design ditimpa
-- default_settings reference. Hanya untuk tenant yang berhak memakai module ini, seperti 0004.
INSERT INTO public.tenant_number_sequences (
    id, tenant_id, reference_id, scope_type, operating_unit_id, status, is_continuous, allow_automatic, allow_manual,
    allow_lower_number, allow_higher_number, reset_period, preallocation_enabled, preallocation_quantity,
    minimum_number, maximum_number, segments, created_at, updated_at)
SELECT gen_random_uuid(), u.tenant_id, r.id, 'operating_unit', u.organization_id, 'active', false, true, false,
       false, false, 'never', true, 20, 1, 99999999,
       (r.default_settings -> 'segments')::json, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM public.operating_units u
JOIN public.organizations o ON o.id = u.organization_id AND o.tenant_id = u.tenant_id
CROSS JOIN public.app_number_sequence_references r
WHERE r.code IN ('healthcare.visit-number', 'healthcare.examination-number')
  AND EXISTS (SELECT 1 FROM public.tenant_app_entitlements e
              WHERE e.tenant_id = u.tenant_id AND e.app_id = r.app_id AND e.status = 'active'
                AND (e.ends_at IS NULL OR e.ends_at > current_timestamp))
  AND NOT EXISTS (SELECT 1 FROM public.tenant_number_sequences s
                  WHERE s.tenant_id = u.tenant_id AND s.reference_id = r.id
                    AND s.scope_type = 'operating_unit' AND s.operating_unit_id = u.organization_id);
