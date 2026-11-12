-- Persediaan dasar milik Core (src/foundation/inventory/), pola Business Central: satu buku besar stok (Item Ledger
-- Entry) dengan sisa per baris, satu mesin posting untuk semua dokumen, dan setelan per legal entity yang bisa ditimpa
-- per operating unit dan per lokasi. Farmasi dan layanan kesehatan sama-sama module, dan module tidak boleh menyentuh
-- tabel module lain, jadi stok tinggal di Core. Nama tabel mengikuti nama legacy (GD_trKartuGudang menjadi
-- gd_tr_kartu_gudang). Belum ada layar; layar menyusul di PR berikutnya.
--
-- 1. Master: setelan (Inventory Setup) per legal entity dan timpaannya per operating unit, lokasi (Location), satuan
--    (Unit of Measure), kategori (Item Category), profil pelacakan (Item Tracking Code), barang (Item), batch (Lot No.
--    Information), dan alasan penyesuaian (Reason Code). Semuanya per legal entity, seperti company di BC.
-- 2. Buku besar: gd_tr_kartu_gudang dan gd_tr_kartu_gudang_aplikasi (Item Application Entry). Tidak ada kolom saldo
--    berjalan; saldo adalah SUM. Baris tidak pernah diubah kecuali `sisa`, dan dijaga trigger.
-- 3. Dokumen penyesuaian (Invt. Document): satu tabel untuk masuk dan keluar, beserta barisnya.
-- 4. Reference nomor penyesuaian per legal entity.
-- 5. Trigger versi, aktor, dan change log untuk master dan dokumen. Buku besar tidak dicatat di change log karena setiap
--    barisnya sendiri sudah catatan.
-- 6. Data acuan per legal entity: baris setelan dan alasan bawaan, untuk legal entity yang sudah ada dan lewat trigger
--    untuk legal entity sesudahnya. Core selalu terpasang, jadi pemicunya lahirnya legal entity, bukan pemasangan
--    module.
-- 7. Katalog izin: permission, privilege, duty. Role pemilik tenant yang sudah ada mendapat duty kelola, sama dengan
--    role pemilik yang lahir sesudah migration ini.

-- 1. Master ----------------------------------------------------------------------------------------------------------

CREATE TABLE public.gd_m_parameter (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    metode_pengambilan character varying(10) DEFAULT 'fefo' NOT NULL,
    tolak_stok_minus boolean DEFAULT true NOT NULL,
    cara_mutasi character varying(15) DEFAULT 'langsung' NOT NULL,
    -- Tahap ini hanya FIFO; kolomnya ada supaya rata-rata kelak tidak mengubah bentuk tabel.
    metode_harga_pokok character varying(10) DEFAULT 'fifo' NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT gd_m_parameter_pkey PRIMARY KEY (id),
    CONSTRAINT gd_m_parameter_legal_entity_unique UNIQUE (tenant_id, legal_entity_id),
    CONSTRAINT gd_m_parameter_metode_pengambilan_check CHECK (metode_pengambilan IN ('fefo', 'fifo', 'manual')),
    CONSTRAINT gd_m_parameter_cara_mutasi_check CHECK (cara_mutasi IN ('langsung', 'kirim_terima')),
    CONSTRAINT gd_m_parameter_metode_harga_pokok_check CHECK (metode_harga_pokok IN ('fifo')),
    CONSTRAINT gd_m_parameter_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT
);

-- Kolom kosong berarti mengikuti legal entity.
CREATE TABLE public.gd_m_parameter_unit (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    operating_unit_id uuid NOT NULL,
    metode_pengambilan character varying(10),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT gd_m_parameter_unit_pkey PRIMARY KEY (id),
    CONSTRAINT gd_m_parameter_unit_unique UNIQUE (tenant_id, legal_entity_id, operating_unit_id),
    CONSTRAINT gd_m_parameter_unit_metode_pengambilan_check
        CHECK (metode_pengambilan IN ('fefo', 'fifo', 'manual')),
    CONSTRAINT gd_m_parameter_unit_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_m_parameter_unit_operating_unit_foreign
        FOREIGN KEY (tenant_id, operating_unit_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT
);

-- Lokasi stok satu operating unit, misalnya gudang, apotek, pustu, atau posyandu. Lokasi transit dipakai mutasi dua
-- langkah dan tidak bisa dipilih di dokumen penyesuaian, seperti Use As In-Transit di BC.
CREATE TABLE public.gd_m_lokasi (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    operating_unit_id uuid NOT NULL,
    kode character varying(20) NOT NULL,
    nama character varying(150) NOT NULL,
    transit boolean DEFAULT false NOT NULL,
    metode_pengambilan character varying(10),
    cara_mutasi character varying(15),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT gd_m_lokasi_pkey PRIMARY KEY (id),
    CONSTRAINT gd_m_lokasi_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT gd_m_lokasi_metode_pengambilan_check CHECK (metode_pengambilan IN ('fefo', 'fifo', 'manual')),
    CONSTRAINT gd_m_lokasi_cara_mutasi_check CHECK (cara_mutasi IN ('langsung', 'kirim_terima')),
    CONSTRAINT gd_m_lokasi_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_m_lokasi_operating_unit_foreign
        FOREIGN KEY (tenant_id, operating_unit_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX gd_m_lokasi_kode_unique
    ON public.gd_m_lokasi USING btree (tenant_id, legal_entity_id, kode) WHERE (deleted_at IS NULL);

CREATE TABLE public.gd_m_satuan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    kode character varying(20) NOT NULL,
    nama character varying(100) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT gd_m_satuan_pkey PRIMARY KEY (id),
    CONSTRAINT gd_m_satuan_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT gd_m_satuan_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX gd_m_satuan_kode_unique
    ON public.gd_m_satuan USING btree (tenant_id, legal_entity_id, kode) WHERE (deleted_at IS NULL);

-- Kedaluwarsa dicatat per batch, jadi profil yang mewajibkan kedaluwarsa juga mewajibkan batch. tolak_kedaluwarsa
-- (Strict Expiration Posting di BC) menolak batch yang sudah kedaluwarsa keluar.
CREATE TABLE public.gd_m_profil_pelacakan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    kode character varying(20) NOT NULL,
    nama character varying(100) NOT NULL,
    wajib_batch boolean DEFAULT false NOT NULL,
    wajib_kedaluwarsa boolean DEFAULT false NOT NULL,
    tolak_kedaluwarsa boolean DEFAULT false NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT gd_m_profil_pelacakan_pkey PRIMARY KEY (id),
    CONSTRAINT gd_m_profil_pelacakan_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT gd_m_profil_pelacakan_kedaluwarsa_check CHECK (wajib_batch OR NOT wajib_kedaluwarsa),
    CONSTRAINT gd_m_profil_pelacakan_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX gd_m_profil_pelacakan_kode_unique
    ON public.gd_m_profil_pelacakan USING btree (tenant_id, legal_entity_id, kode) WHERE (deleted_at IS NULL);

-- Pohon kategori lewat parent_id. Profil pelacakan kategori hanya bawaan: disalin ke barang saat barang dibuat.
CREATE TABLE public.gd_m_kategori (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    parent_id uuid,
    kode character varying(20) NOT NULL,
    nama character varying(100) NOT NULL,
    profil_pelacakan_id uuid,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT gd_m_kategori_pkey PRIMARY KEY (id),
    CONSTRAINT gd_m_kategori_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT gd_m_kategori_parent_not_self CHECK (parent_id <> id),
    CONSTRAINT gd_m_kategori_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_m_kategori_parent_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, parent_id) REFERENCES public.gd_m_kategori(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT gd_m_kategori_profil_pelacakan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, profil_pelacakan_id)
        REFERENCES public.gd_m_profil_pelacakan(tenant_id, legal_entity_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX gd_m_kategori_kode_unique
    ON public.gd_m_kategori USING btree (tenant_id, legal_entity_id, kode) WHERE (deleted_at IS NULL);

-- Barang tanpa profil pelacakan tidak wajib batch. tolak_stok_minus kosong berarti mengikuti legal entity. Profil
-- pelacakan dan satuan dasar terkunci oleh layanan begitu barang punya baris kartu gudang, seperti di BC.
CREATE TABLE public.gd_m_barang (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    kode character varying(20) NOT NULL,
    nama character varying(200) NOT NULL,
    satuan_dasar_id uuid NOT NULL,
    kategori_id uuid,
    profil_pelacakan_id uuid,
    tolak_stok_minus boolean,
    diblokir boolean DEFAULT false NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT gd_m_barang_pkey PRIMARY KEY (id),
    CONSTRAINT gd_m_barang_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT gd_m_barang_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_m_barang_satuan_dasar_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, satuan_dasar_id) REFERENCES public.gd_m_satuan(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT gd_m_barang_kategori_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, kategori_id) REFERENCES public.gd_m_kategori(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT gd_m_barang_profil_pelacakan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, profil_pelacakan_id)
        REFERENCES public.gd_m_profil_pelacakan(tenant_id, legal_entity_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX gd_m_barang_kode_unique
    ON public.gd_m_barang USING btree (tenant_id, legal_entity_id, kode) WHERE (deleted_at IS NULL);
CREATE INDEX gd_m_barang_kategori_index
    ON public.gd_m_barang USING btree (tenant_id, kategori_id) WHERE (deleted_at IS NULL);

-- Satu nomor batch per barang, dengan satu tanggal kedaluwarsa yang tidak berubah: kartu gudang menyalin tanggal itu
-- untuk urutan FEFO. Dibuat mesin posting saat batch pertama kali masuk. Sumber dana, program, dan tahun anggaran
-- menyusul bersama penerimaan.
CREATE TABLE public.gd_m_batch (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    barang_id uuid NOT NULL,
    no_batch character varying(50) NOT NULL,
    kedaluwarsa date,
    created_at timestamp(0) without time zone NOT NULL,
    created_by_user_id uuid,
    CONSTRAINT gd_m_batch_pkey PRIMARY KEY (id),
    CONSTRAINT gd_m_batch_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT gd_m_batch_no_batch_unique UNIQUE (tenant_id, barang_id, no_batch),
    CONSTRAINT gd_m_batch_barang_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, barang_id) REFERENCES public.gd_m_barang(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT
);

-- Alasan dokumen penyesuaian, misalnya saldo awal atau pemusnahan. Datanya milik tenant; mesin posting tidak pernah
-- membaca kodenya.
CREATE TABLE public.gd_m_alasan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    kode character varying(20) NOT NULL,
    nama character varying(100) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT gd_m_alasan_pkey PRIMARY KEY (id),
    CONSTRAINT gd_m_alasan_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT gd_m_alasan_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX gd_m_alasan_kode_unique
    ON public.gd_m_alasan USING btree (tenant_id, legal_entity_id, kode) WHERE (deleted_at IS NULL);

-- 2. Buku besar ------------------------------------------------------------------------------------------------------

-- Satu baris per gerak per batch. jumlah bertanda dalam satuan dasar: positif masuk, negatif keluar. sisa adalah
-- bagian yang belum diterapkan: pada baris masuk, stok yang masih ada (0 sampai jumlah); pada baris keluar, bagian
-- yang belum mendapat stok saat stok minus diizinkan (jumlah sampai 0). Stok = SUM(sisa) baris terbuka, dan untuk satu
-- barang dan lokasi selalu sama dengan SUM(jumlah). Baris pembalik menunjuk baris aslinya lewat dibalik_dari dan
-- memakai jenis yang sama dengan tanda kebalikan, seperti entri koreksi BC.
CREATE TABLE public.gd_tr_kartu_gudang (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    operating_unit_id uuid NOT NULL,
    lokasi_id uuid NOT NULL,
    barang_id uuid NOT NULL,
    batch_id uuid,
    kedaluwarsa date,
    jenis character varying(30) NOT NULL,
    tanggal_posting date NOT NULL,
    jumlah numeric(18,4) NOT NULL,
    sisa numeric(18,4) NOT NULL,
    harga_satuan numeric(18,4),
    nilai numeric(18,2) NOT NULL,
    sumber_jenis character varying(40) NOT NULL,
    sumber_id uuid NOT NULL,
    sumber_baris_id uuid,
    sumber_nomor character varying(60),
    kunci_idempoten character varying(200) NOT NULL,
    dibalik_dari uuid,
    created_by_user_id uuid,
    created_at timestamp(0) without time zone NOT NULL,
    CONSTRAINT gd_tr_kartu_gudang_pkey PRIMARY KEY (id),
    CONSTRAINT gd_tr_kartu_gudang_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT gd_tr_kartu_gudang_jenis_check
        CHECK (jenis IN ('penerimaan', 'penyerahan', 'penyesuaian_tambah', 'penyesuaian_kurang', 'transfer', 'pemakaian')),
    CONSTRAINT gd_tr_kartu_gudang_jumlah_check CHECK (jumlah <> 0),
    CONSTRAINT gd_tr_kartu_gudang_sisa_check
        CHECK ((jumlah > 0 AND sisa >= 0 AND sisa <= jumlah) OR (jumlah < 0 AND sisa <= 0 AND sisa >= jumlah)),
    CONSTRAINT gd_tr_kartu_gudang_harga_satuan_check CHECK (jumlah < 0 OR harga_satuan IS NOT NULL),
    CONSTRAINT gd_tr_kartu_gudang_kedaluwarsa_check CHECK (batch_id IS NOT NULL OR kedaluwarsa IS NULL),
    CONSTRAINT gd_tr_kartu_gudang_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_tr_kartu_gudang_operating_unit_foreign
        FOREIGN KEY (tenant_id, operating_unit_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_tr_kartu_gudang_lokasi_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, lokasi_id) REFERENCES public.gd_m_lokasi(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT gd_tr_kartu_gudang_barang_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, barang_id) REFERENCES public.gd_m_barang(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT gd_tr_kartu_gudang_batch_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, batch_id) REFERENCES public.gd_m_batch(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT gd_tr_kartu_gudang_dibalik_dari_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, dibalik_dari)
        REFERENCES public.gd_tr_kartu_gudang(tenant_id, legal_entity_id, id) ON DELETE RESTRICT
);
-- Posting yang diulang menabrak kunci yang sama, sehingga tidak ada baris ganda walau penjaga status dokumen lolos.
CREATE UNIQUE INDEX gd_tr_kartu_gudang_kunci_idempoten_unique
    ON public.gd_tr_kartu_gudang USING btree (tenant_id, kunci_idempoten);
CREATE INDEX gd_tr_kartu_gudang_terbuka_index
    ON public.gd_tr_kartu_gudang USING btree (tenant_id, barang_id, lokasi_id) WHERE (sisa <> 0);
CREATE INDEX gd_tr_kartu_gudang_kartu_stok_index
    ON public.gd_tr_kartu_gudang USING btree (tenant_id, barang_id, lokasi_id, tanggal_posting, id);
CREATE INDEX gd_tr_kartu_gudang_sumber_index
    ON public.gd_tr_kartu_gudang USING btree (tenant_id, sumber_jenis, sumber_id);
CREATE INDEX gd_tr_kartu_gudang_dibalik_dari_index
    ON public.gd_tr_kartu_gudang USING btree (tenant_id, dibalik_dari) WHERE (dibalik_dari IS NOT NULL);
CREATE INDEX gd_tr_kartu_gudang_batch_index
    ON public.gd_tr_kartu_gudang USING btree (tenant_id, batch_id) WHERE (batch_id IS NOT NULL);

-- Berapa dari baris masuk yang dipakai baris keluar.
CREATE TABLE public.gd_tr_kartu_gudang_aplikasi (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    entri_masuk_id uuid NOT NULL,
    entri_keluar_id uuid NOT NULL,
    jumlah numeric(18,4) NOT NULL,
    created_at timestamp(0) without time zone NOT NULL,
    CONSTRAINT gd_tr_kartu_gudang_aplikasi_pkey PRIMARY KEY (id),
    CONSTRAINT gd_tr_kartu_gudang_aplikasi_jumlah_check CHECK (jumlah > 0),
    CONSTRAINT gd_tr_kartu_gudang_aplikasi_masuk_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, entri_masuk_id)
        REFERENCES public.gd_tr_kartu_gudang(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_tr_kartu_gudang_aplikasi_keluar_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, entri_keluar_id)
        REFERENCES public.gd_tr_kartu_gudang(tenant_id, legal_entity_id, id) ON DELETE RESTRICT
);
CREATE INDEX gd_tr_kartu_gudang_aplikasi_masuk_index
    ON public.gd_tr_kartu_gudang_aplikasi USING btree (tenant_id, entri_masuk_id);
CREATE INDEX gd_tr_kartu_gudang_aplikasi_keluar_index
    ON public.gd_tr_kartu_gudang_aplikasi USING btree (tenant_id, entri_keluar_id);

-- Penjaga, bukan logika stok: koreksi selalu baris baru, jadi isi baris lama tidak pernah berubah selain sisa.
CREATE FUNCTION public.gd_kartu_gudang_hanya_sisa() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Baris kartu gudang tidak dapat dihapus.';
    END IF;
    IF (to_jsonb(NEW) - 'sisa') <> (to_jsonb(OLD) - 'sisa') THEN
        RAISE EXCEPTION 'Baris kartu gudang hanya boleh diubah sisanya.';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER hanya_sisa BEFORE UPDATE OR DELETE ON public.gd_tr_kartu_gudang
    FOR EACH ROW EXECUTE FUNCTION public.gd_kartu_gudang_hanya_sisa();

CREATE FUNCTION public.gd_tolak_ubah() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION '% hanya boleh ditambah, tidak diubah atau dihapus.', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER tolak_ubah BEFORE UPDATE OR DELETE ON public.gd_tr_kartu_gudang_aplikasi
    FOR EACH ROW EXECUTE FUNCTION public.gd_tolak_ubah();

-- 3. Dokumen penyesuaian ---------------------------------------------------------------------------------------------

-- Satu dokumen untuk stok masuk atau keluar dengan alasan, misalnya saldo awal, pemakaian unit, atau pemusnahan.
-- Draf boleh diubah dan dihapus; dokumen yang sudah diposting hanya bisa dibatalkan postingnya, yang menulis baris
-- pembalik di kartu gudang dan menutup dokumen sebagai dibatalkan.
CREATE TABLE public.gd_tr_penyesuaian (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    operating_unit_id uuid NOT NULL,
    lokasi_id uuid NOT NULL,
    nomor character varying(60) NOT NULL,
    arah character varying(10) NOT NULL,
    tanggal date NOT NULL,
    alasan_id uuid NOT NULL,
    status character varying(15) DEFAULT 'draf' NOT NULL,
    diposting_pada timestamp(0) without time zone,
    diposting_oleh_user_id uuid,
    dibatalkan_pada timestamp(0) without time zone,
    dibatalkan_oleh_user_id uuid,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT gd_tr_penyesuaian_pkey PRIMARY KEY (id),
    CONSTRAINT gd_tr_penyesuaian_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT gd_tr_penyesuaian_arah_check CHECK (arah IN ('masuk', 'keluar')),
    CONSTRAINT gd_tr_penyesuaian_status_check CHECK (status IN ('draf', 'diposting', 'dibatalkan')),
    CONSTRAINT gd_tr_penyesuaian_hapus_check CHECK (deleted_at IS NULL OR status = 'draf'),
    CONSTRAINT gd_tr_penyesuaian_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_tr_penyesuaian_operating_unit_foreign
        FOREIGN KEY (tenant_id, operating_unit_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_tr_penyesuaian_lokasi_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, lokasi_id) REFERENCES public.gd_m_lokasi(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT gd_tr_penyesuaian_alasan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, alasan_id) REFERENCES public.gd_m_alasan(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT
);
-- Nomor per legal entity, sama dengan scope reference nomornya.
CREATE UNIQUE INDEX gd_tr_penyesuaian_nomor_unique
    ON public.gd_tr_penyesuaian USING btree (tenant_id, legal_entity_id, nomor) WHERE (deleted_at IS NULL);
CREATE INDEX gd_tr_penyesuaian_alasan_index
    ON public.gd_tr_penyesuaian USING btree (tenant_id, alasan_id) WHERE (deleted_at IS NULL);

-- Baris masuk membawa nomor batch, kedaluwarsa, dan harga satuan; batch dibuat saat posting bila belum ada. Baris
-- keluar boleh menunjuk batch yang diambil.
CREATE TABLE public.gd_tr_penyesuaian_detail (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    penyesuaian_id uuid NOT NULL,
    urutan smallint NOT NULL,
    barang_id uuid NOT NULL,
    jumlah numeric(18,4) NOT NULL,
    no_batch character varying(50),
    kedaluwarsa date,
    harga_satuan numeric(18,4),
    batch_id uuid,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT gd_tr_penyesuaian_detail_pkey PRIMARY KEY (id),
    CONSTRAINT gd_tr_penyesuaian_detail_jumlah_check CHECK (jumlah > 0),
    CONSTRAINT gd_tr_penyesuaian_detail_harga_satuan_check CHECK (harga_satuan >= 0),
    CONSTRAINT gd_tr_penyesuaian_detail_bentuk_check
        CHECK (batch_id IS NULL OR (no_batch IS NULL AND kedaluwarsa IS NULL AND harga_satuan IS NULL)),
    CONSTRAINT gd_tr_penyesuaian_detail_kedaluwarsa_check CHECK (kedaluwarsa IS NULL OR no_batch IS NOT NULL),
    CONSTRAINT gd_tr_penyesuaian_detail_penyesuaian_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, penyesuaian_id)
        REFERENCES public.gd_tr_penyesuaian(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_tr_penyesuaian_detail_barang_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, barang_id) REFERENCES public.gd_m_barang(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT gd_tr_penyesuaian_detail_batch_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, batch_id) REFERENCES public.gd_m_batch(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT
);
CREATE INDEX gd_tr_penyesuaian_detail_penyesuaian_index
    ON public.gd_tr_penyesuaian_detail USING btree (tenant_id, penyesuaian_id) WHERE (deleted_at IS NULL);
CREATE INDEX gd_tr_penyesuaian_detail_barang_index
    ON public.gd_tr_penyesuaian_detail USING btree (tenant_id, barang_id) WHERE (deleted_at IS NULL);

-- 4. Reference nomor penyesuaian -------------------------------------------------------------------------------------

-- Satu sequence per legal entity, dibuat NumberSequences.createLegalEntityDefaults saat legal entity lahir. Admin bebas
-- mengubah formatnya di Nomor dokumen sebelum nomor pertama terbit.
INSERT INTO public.app_number_sequence_references (id, app_id, code, name, allowed_scopes, default_prefix,
                                                  default_settings, default_per_legal_entity,
                                                  numbers_unique_per_scope, created_at, updated_at)
VALUES ('01a1d087-9e31-70ec-adae-3711c612de59', 'core', 'core.inventory-adjustment-number',
        'Nomor penyesuaian stok', '["legal_entity"]', NULL,
        '{"minimum_number":1,"maximum_number":99999999,"segments":[{"type":"constant","value":"PNY-"},{"type":"number","length":8}]}',
        true, false, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

-- Setelan sama dengan yang dibuat NumberSequences.createLegalEntityDefaults.
INSERT INTO public.tenant_number_sequences (
    id, tenant_id, reference_id, scope_type, legal_entity_id, status, is_continuous, allow_automatic, allow_manual,
    allow_lower_number, allow_higher_number, reset_period, preallocation_enabled, preallocation_quantity,
    minimum_number, maximum_number, segments, created_at, updated_at)
SELECT gen_random_uuid(), l.tenant_id, r.id, 'legal_entity', l.organization_id, 'active', false, true, false,
       false, false, 'never', true, 20, 1, 99999999,
       (r.default_settings -> 'segments')::json, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM public.legal_entities l
JOIN public.organizations o ON o.id = l.organization_id AND o.tenant_id = l.tenant_id
CROSS JOIN public.app_number_sequence_references r
WHERE r.code = 'core.inventory-adjustment-number'
  AND NOT EXISTS (SELECT 1 FROM public.tenant_number_sequences s
                  WHERE s.tenant_id = l.tenant_id AND s.reference_id = r.id
                    AND s.scope_type = 'legal_entity' AND s.legal_entity_id = l.organization_id);

-- 5. Trigger versi, aktor, dan change log ----------------------------------------------------------------------------

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['gd_m_parameter', 'gd_m_parameter_unit', 'gd_m_lokasi', 'gd_m_satuan',
                             'gd_m_profil_pelacakan', 'gd_m_kategori', 'gd_m_barang', 'gd_m_alasan',
                             'gd_tr_penyesuaian', 'gd_tr_penyesuaian_detail']
    LOOP
        EXECUTE format('CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.%I
                            FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version()', t);
        EXECUTE format('CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.%I
                            FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor()', t);
        EXECUTE format('CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.%I
                            FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change()', t);
    END LOOP;
END;
$$;

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, t.table_name, t.caption, 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('gd_m_parameter', 'Parameter persediaan'),
             ('gd_m_parameter_unit', 'Parameter persediaan unit'),
             ('gd_m_lokasi', 'Lokasi stok'),
             ('gd_m_satuan', 'Satuan'),
             ('gd_m_profil_pelacakan', 'Profil pelacakan'),
             ('gd_m_kategori', 'Kategori barang'),
             ('gd_m_barang', 'Barang'),
             ('gd_m_alasan', 'Alasan penyesuaian'),
             ('gd_tr_penyesuaian', 'Penyesuaian stok'),
             ('gd_tr_penyesuaian_detail', 'Baris penyesuaian stok')) AS t(table_name, caption)
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = t.table_name);

-- 6. Data acuan per legal entity -------------------------------------------------------------------------------------

-- Baris setelan dengan nilai bawaan kolomnya, dan empat alasan penyesuaian. Alasan diisi hanya bila legal entity
-- belum punya alasan sama sekali, termasuk yang sudah dihapus, sehingga pengisian ulang tidak mengembalikan alasan
-- yang sengaja dihapus.
CREATE FUNCTION public.gd_isi_acuan(p_tenant uuid, p_legal_entity uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO public.gd_m_parameter (id, tenant_id, legal_entity_id, created_at, updated_at)
    VALUES (gen_random_uuid(), p_tenant, p_legal_entity, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
    ON CONFLICT (tenant_id, legal_entity_id) DO NOTHING;
    IF NOT EXISTS (SELECT 1 FROM public.gd_m_alasan WHERE tenant_id = p_tenant AND legal_entity_id = p_legal_entity) THEN
        INSERT INTO public.gd_m_alasan (id, tenant_id, legal_entity_id, kode, nama, created_at, updated_at)
        SELECT gen_random_uuid(), p_tenant, p_legal_entity, v.kode, v.nama, now() AT TIME ZONE 'utc',
               now() AT TIME ZONE 'utc'
        FROM (VALUES ('SALDO-AWAL', 'Saldo awal'),
                     ('PEMAKAIAN', 'Pemakaian unit'),
                     ('PEMUSNAHAN', 'Pemusnahan'),
                     ('KEDALUWARSA', 'Kedaluwarsa')) AS v(kode, nama);
    END IF;
END;
$$;

CREATE FUNCTION public.gd_isi_acuan_saat_legal_entity_lahir() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM public.gd_isi_acuan(NEW.tenant_id, NEW.organization_id);
    RETURN NULL;
END;
$$;
CREATE TRIGGER gd_isi_acuan AFTER INSERT ON public.legal_entities
    FOR EACH ROW EXECUTE FUNCTION public.gd_isi_acuan_saat_legal_entity_lahir();

SELECT public.gd_isi_acuan(l.tenant_id, l.organization_id)
FROM public.legal_entities l
JOIN public.organizations o ON o.id = l.organization_id AND o.tenant_id = l.tenant_id;

-- 7. Katalog izin ----------------------------------------------------------------------------------------------------

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
SELECT e.code, 'core', e.name, 'form', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.inventory-setup.form', 'Layar parameter persediaan'),
             ('core.inventory-location.form', 'Layar lokasi stok'),
             ('core.inventory-unit.form', 'Layar satuan'),
             ('core.inventory-category.form', 'Layar kategori barang'),
             ('core.inventory-tracking.form', 'Layar profil pelacakan'),
             ('core.inventory-reason.form', 'Layar alasan penyesuaian'),
             ('core.inventory-item.form', 'Layar barang'),
             ('core.inventory-stock.form', 'Layar stok dan kartu stok'),
             ('core.inventory-adjustment.form', 'Layar penyesuaian stok')) AS e(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'core', p.entry_point, p.level, p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.inventory-setup.read', 'core.inventory-setup.form', 'read', 'Lihat parameter persediaan'),
             ('core.inventory-setup.update', 'core.inventory-setup.form', 'update', 'Ubah parameter persediaan'),
             ('core.inventory-location.read', 'core.inventory-location.form', 'read', 'Lihat lokasi stok'),
             ('core.inventory-location.update', 'core.inventory-location.form', 'update', 'Ubah lokasi stok'),
             ('core.inventory-unit.read', 'core.inventory-unit.form', 'read', 'Lihat satuan'),
             ('core.inventory-unit.update', 'core.inventory-unit.form', 'update', 'Ubah satuan'),
             ('core.inventory-category.read', 'core.inventory-category.form', 'read', 'Lihat kategori barang'),
             ('core.inventory-category.update', 'core.inventory-category.form', 'update', 'Ubah kategori barang'),
             ('core.inventory-tracking.read', 'core.inventory-tracking.form', 'read', 'Lihat profil pelacakan'),
             ('core.inventory-tracking.update', 'core.inventory-tracking.form', 'update', 'Ubah profil pelacakan'),
             ('core.inventory-reason.read', 'core.inventory-reason.form', 'read', 'Lihat alasan penyesuaian'),
             ('core.inventory-reason.update', 'core.inventory-reason.form', 'update', 'Ubah alasan penyesuaian'),
             ('core.inventory-item.read', 'core.inventory-item.form', 'read', 'Lihat barang'),
             ('core.inventory-item.update', 'core.inventory-item.form', 'update', 'Ubah barang'),
             ('core.inventory-stock.read', 'core.inventory-stock.form', 'read', 'Lihat stok dan kartu stok'),
             ('core.inventory-adjustment.read', 'core.inventory-adjustment.form', 'read', 'Lihat penyesuaian stok'),
             ('core.inventory-adjustment.update', 'core.inventory-adjustment.form', 'update',
              'Ubah draf penyesuaian stok'),
             ('core.inventory-adjustment.post', 'core.inventory-adjustment.form', 'invoke', 'Posting penyesuaian stok'),
             ('core.inventory-adjustment.reverse', 'core.inventory-adjustment.form', 'correct',
              'Batalkan posting penyesuaian stok')) AS p(code, entry_point, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'core', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.inventory-setup.view', 'Melihat parameter persediaan'),
             ('core.inventory-setup.maintain', 'Memelihara parameter persediaan'),
             ('core.inventory-location.view', 'Melihat lokasi stok'),
             ('core.inventory-location.maintain', 'Memelihara lokasi stok'),
             ('core.inventory-unit.view', 'Melihat satuan'),
             ('core.inventory-unit.maintain', 'Memelihara satuan'),
             ('core.inventory-category.view', 'Melihat kategori barang'),
             ('core.inventory-category.maintain', 'Memelihara kategori barang'),
             ('core.inventory-tracking.view', 'Melihat profil pelacakan'),
             ('core.inventory-tracking.maintain', 'Memelihara profil pelacakan'),
             ('core.inventory-reason.view', 'Melihat alasan penyesuaian'),
             ('core.inventory-reason.maintain', 'Memelihara alasan penyesuaian'),
             ('core.inventory-item.view', 'Melihat barang'),
             ('core.inventory-item.maintain', 'Memelihara barang'),
             ('core.inventory-stock.view', 'Melihat stok dan kartu stok'),
             ('core.inventory-adjustment.view', 'Melihat penyesuaian stok'),
             ('core.inventory-adjustment.maintain', 'Membuat dan mengubah draf penyesuaian stok'),
             ('core.inventory-adjustment.posting', 'Memposting penyesuaian stok'),
             ('core.inventory-adjustment.correction', 'Membatalkan posting penyesuaian stok')) AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('core.inventory-setup.view', 'core.inventory-setup.read'),
       ('core.inventory-setup.maintain', 'core.inventory-setup.read'),
       ('core.inventory-setup.maintain', 'core.inventory-setup.update'),
       ('core.inventory-location.view', 'core.inventory-location.read'),
       ('core.inventory-location.maintain', 'core.inventory-location.read'),
       ('core.inventory-location.maintain', 'core.inventory-location.update'),
       ('core.inventory-unit.view', 'core.inventory-unit.read'),
       ('core.inventory-unit.maintain', 'core.inventory-unit.read'),
       ('core.inventory-unit.maintain', 'core.inventory-unit.update'),
       ('core.inventory-category.view', 'core.inventory-category.read'),
       ('core.inventory-category.maintain', 'core.inventory-category.read'),
       ('core.inventory-category.maintain', 'core.inventory-category.update'),
       ('core.inventory-tracking.view', 'core.inventory-tracking.read'),
       ('core.inventory-tracking.maintain', 'core.inventory-tracking.read'),
       ('core.inventory-tracking.maintain', 'core.inventory-tracking.update'),
       ('core.inventory-reason.view', 'core.inventory-reason.read'),
       ('core.inventory-reason.maintain', 'core.inventory-reason.read'),
       ('core.inventory-reason.maintain', 'core.inventory-reason.update'),
       ('core.inventory-item.view', 'core.inventory-item.read'),
       ('core.inventory-item.maintain', 'core.inventory-item.read'),
       ('core.inventory-item.maintain', 'core.inventory-item.update'),
       ('core.inventory-stock.view', 'core.inventory-stock.read'),
       ('core.inventory-adjustment.view', 'core.inventory-adjustment.read'),
       ('core.inventory-adjustment.maintain', 'core.inventory-adjustment.read'),
       ('core.inventory-adjustment.maintain', 'core.inventory-adjustment.update'),
       ('core.inventory-adjustment.posting', 'core.inventory-adjustment.read'),
       ('core.inventory-adjustment.posting', 'core.inventory-adjustment.post'),
       ('core.inventory-adjustment.correction', 'core.inventory-adjustment.read'),
       ('core.inventory-adjustment.correction', 'core.inventory-adjustment.reverse')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
SELECT d.code, 'core', d.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.inventory-setup.inquire', 'Lihat setelan dan master persediaan'),
             ('core.inventory-setup.manage', 'Kelola setelan dan master persediaan'),
             ('core.inventory-item.inquire', 'Lihat barang dan stoknya'),
             ('core.inventory-item.manage', 'Kelola barang'),
             ('core.inventory-adjustment.inquire', 'Lihat penyesuaian stok'),
             ('core.inventory-adjustment.manage', 'Kelola dan posting penyesuaian stok')) AS d(code, name)
ON CONFLICT (code) DO NOTHING;

-- Pemilih di layar barang dan penyesuaian membaca master yang dirujuknya, jadi duty itu ikut membawa hak lihatnya.
INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('core.inventory-setup.inquire', 'core.inventory-setup.view'),
       ('core.inventory-setup.inquire', 'core.inventory-location.view'),
       ('core.inventory-setup.inquire', 'core.inventory-unit.view'),
       ('core.inventory-setup.inquire', 'core.inventory-category.view'),
       ('core.inventory-setup.inquire', 'core.inventory-tracking.view'),
       ('core.inventory-setup.inquire', 'core.inventory-reason.view'),
       ('core.inventory-setup.manage', 'core.inventory-setup.maintain'),
       ('core.inventory-setup.manage', 'core.inventory-location.maintain'),
       ('core.inventory-setup.manage', 'core.inventory-unit.maintain'),
       ('core.inventory-setup.manage', 'core.inventory-category.maintain'),
       ('core.inventory-setup.manage', 'core.inventory-tracking.maintain'),
       ('core.inventory-setup.manage', 'core.inventory-reason.maintain'),
       ('core.inventory-item.inquire', 'core.inventory-item.view'),
       ('core.inventory-item.inquire', 'core.inventory-stock.view'),
       ('core.inventory-item.inquire', 'core.inventory-unit.view'),
       ('core.inventory-item.inquire', 'core.inventory-category.view'),
       ('core.inventory-item.inquire', 'core.inventory-tracking.view'),
       ('core.inventory-item.manage', 'core.inventory-item.maintain'),
       ('core.inventory-item.manage', 'core.inventory-stock.view'),
       ('core.inventory-item.manage', 'core.inventory-unit.view'),
       ('core.inventory-item.manage', 'core.inventory-category.view'),
       ('core.inventory-item.manage', 'core.inventory-tracking.view'),
       ('core.inventory-adjustment.inquire', 'core.inventory-adjustment.view'),
       ('core.inventory-adjustment.inquire', 'core.inventory-stock.view'),
       ('core.inventory-adjustment.inquire', 'core.inventory-item.view'),
       ('core.inventory-adjustment.inquire', 'core.inventory-location.view'),
       ('core.inventory-adjustment.inquire', 'core.inventory-reason.view'),
       ('core.inventory-adjustment.manage', 'core.inventory-adjustment.maintain'),
       ('core.inventory-adjustment.manage', 'core.inventory-adjustment.posting'),
       ('core.inventory-adjustment.manage', 'core.inventory-adjustment.correction'),
       ('core.inventory-adjustment.manage', 'core.inventory-stock.view'),
       ('core.inventory-adjustment.manage', 'core.inventory-item.view'),
       ('core.inventory-adjustment.manage', 'core.inventory-location.view'),
       ('core.inventory-adjustment.manage', 'core.inventory-reason.view')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT r.id, d.code
FROM public.roles r
CROSS JOIN (VALUES ('core.inventory-setup.manage'), ('core.inventory-item.manage'),
                   ('core.inventory-adjustment.manage')) AS d(code)
WHERE r.is_owner AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
