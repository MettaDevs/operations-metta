-- Opname stok (src/foundation/inventory/stock-count/), pola Physical Inventory Order Business Central. Nama tabel
-- mengikuti nama legacy (GD_trOpname, GD_trOpnameDetail). Di sistem lama opname dipakai untuk menghitung cepat beberapa
-- barang lalu mengoreksi stoknya; di sini satu dokumen per lokasi, barisnya per barang dan batch.
--
-- 1. Opname: lokasi, tanggal hitung, tanggal posting (tanggal pengakuan di sistem lama), dan status draf, dihitung,
--    diposting, atau dibatalkan. mulai_hitung_pada dicatat saat dokumen pertama kali punya baris.
-- 2. Baris opname: barang, batch, jumlah tercatat (potret saat baris dibuat), jumlah dihitung, dan satuan isiannya.
--    Semua jumlah dalam satuan dasar.
-- 3. Reference nomor opname per legal entity.
-- 4. Trigger versi, aktor, dan change log.
-- 5. Katalog izin: melihat, menghitung, dan mengelola (posting serta batal posting). Role pemilik tenant yang sudah ada
--    mendapat duty kelola.
--
-- Stok tidak dibekukan selama opname. Saat posting, jumlah tercatat dihitung ulang per barang dan batch di lokasi itu
-- sampai tanggal posting, di bawah kunci mesin posting, dan selisihnya ditulis sebagai penyesuaian di kartu gudang
-- (sumber_jenis 'opname'). BC mengizinkan beberapa pencatatan per opname; di sini satu.

-- 1. Opname ----------------------------------------------------------------------------------------------------------

-- Dokumen tidak dihapus: draf yang tidak jadi dibatalkan, jadi nomornya unik penuh.
CREATE TABLE public.gd_tr_opname (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    operating_unit_id uuid NOT NULL,
    lokasi_id uuid NOT NULL,
    nomor character varying(60) NOT NULL,
    tanggal date NOT NULL,
    tanggal_posting date NOT NULL,
    keterangan character varying(200),
    status character varying(15) DEFAULT 'draf' NOT NULL,
    mulai_hitung_pada timestamp(0) without time zone,
    selesai_hitung_pada timestamp(0) without time zone,
    selesai_hitung_oleh_user_id uuid,
    diposting_pada timestamp(0) without time zone,
    diposting_oleh_user_id uuid,
    dibatalkan_pada timestamp(0) without time zone,
    dibatalkan_oleh_user_id uuid,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT gd_tr_opname_pkey PRIMARY KEY (id),
    CONSTRAINT gd_tr_opname_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT gd_tr_opname_nomor_unique UNIQUE (tenant_id, legal_entity_id, nomor),
    CONSTRAINT gd_tr_opname_status_check CHECK (status IN ('draf', 'dihitung', 'diposting', 'dibatalkan')),
    CONSTRAINT gd_tr_opname_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_tr_opname_operating_unit_foreign
        FOREIGN KEY (tenant_id, operating_unit_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_tr_opname_lokasi_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, lokasi_id) REFERENCES public.gd_m_lokasi(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT
);
CREATE INDEX gd_tr_opname_lokasi_index ON public.gd_tr_opname USING btree (tenant_id, lokasi_id);

-- 2. Baris opname ----------------------------------------------------------------------------------------------------

-- Batch yang sudah tercatat ditunjuk lewat batch_id. Batch temuan yang belum pernah tercatat membawa no_batch dan
-- kedaluwarsa, lalu dicatat mesin posting saat selisihnya masuk. jumlah_dihitung kosong berarti belum dihitung.
-- jumlah_tercatat_posting dan bergerak_setelah_mulai diisi saat posting: jumlah tercatat yang dihitung ulang, dan ada
-- tidaknya gerak stok barang dan batch itu sesudah hitung dimulai.
CREATE TABLE public.gd_tr_opname_detail (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    opname_id uuid NOT NULL,
    urutan smallint NOT NULL,
    barang_id uuid NOT NULL,
    batch_id uuid,
    no_batch character varying(50),
    kedaluwarsa date,
    satuan_id uuid NOT NULL,
    konversi numeric(18,4) NOT NULL,
    jumlah_tercatat numeric(18,4) NOT NULL,
    jumlah_dihitung numeric(18,4),
    jumlah_tercatat_posting numeric(18,4),
    bergerak_setelah_mulai boolean,
    keterangan character varying(200),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT gd_tr_opname_detail_pkey PRIMARY KEY (id),
    CONSTRAINT gd_tr_opname_detail_konversi_check CHECK (konversi > 0),
    CONSTRAINT gd_tr_opname_detail_dihitung_check CHECK (jumlah_dihitung >= 0),
    CONSTRAINT gd_tr_opname_detail_bentuk_check CHECK (batch_id IS NULL OR (no_batch IS NULL AND kedaluwarsa IS NULL)),
    CONSTRAINT gd_tr_opname_detail_kedaluwarsa_check CHECK (kedaluwarsa IS NULL OR no_batch IS NOT NULL),
    CONSTRAINT gd_tr_opname_detail_opname_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, opname_id)
        REFERENCES public.gd_tr_opname(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_tr_opname_detail_barang_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, barang_id) REFERENCES public.gd_m_barang(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT gd_tr_opname_detail_batch_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, batch_id) REFERENCES public.gd_m_batch(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT gd_tr_opname_detail_satuan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, satuan_id) REFERENCES public.gd_m_satuan(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT
);
-- Satu baris per barang dan batch dalam satu opname.
CREATE UNIQUE INDEX gd_tr_opname_detail_posisi_unique
    ON public.gd_tr_opname_detail USING btree (tenant_id, opname_id, barang_id,
                                               (coalesce(batch_id::text, 'baru:' || no_batch, '')))
    WHERE (deleted_at IS NULL);
CREATE INDEX gd_tr_opname_detail_opname_index
    ON public.gd_tr_opname_detail USING btree (tenant_id, opname_id) WHERE (deleted_at IS NULL);
CREATE INDEX gd_tr_opname_detail_barang_index
    ON public.gd_tr_opname_detail USING btree (tenant_id, barang_id) WHERE (deleted_at IS NULL);

-- 3. Reference nomor -------------------------------------------------------------------------------------------------

-- Satu sequence per legal entity, dibuat NumberSequences.createLegalEntityDefaults saat legal entity lahir; legal entity
-- yang sudah ada mendapatnya di bawah dengan setelan yang sama.
INSERT INTO public.app_number_sequence_references (id, app_id, code, name, allowed_scopes, default_prefix,
                                                  default_settings, default_per_legal_entity,
                                                  numbers_unique_per_scope, created_at, updated_at)
VALUES ('01a1d130-96cf-766f-a22b-d7fc02d80da0', 'core', 'core.inventory-count-number', 'Nomor opname stok',
        '["legal_entity"]', NULL,
        '{"minimum_number":1,"maximum_number":99999999,"segments":[{"type":"constant","value":"OPN-"},{"type":"number","length":8}]}',
        true, false, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

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
WHERE r.code = 'core.inventory-count-number'
  AND NOT EXISTS (SELECT 1 FROM public.tenant_number_sequences s
                  WHERE s.tenant_id = l.tenant_id AND s.reference_id = r.id
                    AND s.scope_type = 'legal_entity' AND s.legal_entity_id = l.organization_id);

-- 4. Trigger versi, aktor, dan change log ----------------------------------------------------------------------------

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['gd_tr_opname', 'gd_tr_opname_detail']
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
FROM (VALUES ('gd_tr_opname', 'Opname stok'),
             ('gd_tr_opname_detail', 'Baris opname stok')) AS t(table_name, caption)
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = t.table_name);

-- 5. Katalog izin ----------------------------------------------------------------------------------------------------

-- Petugas hitung membuat opname, mengisi jumlah dihitung, dan menyelesaikan hitungan; posting dan batal posting hak
-- terpisah, seperti BC yang memisahkan pencatatan dari posting.
INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('core.inventory-count.form', 'core', 'Layar opname stok', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'core', 'core.inventory-count.form', p.level, p.name, now() AT TIME ZONE 'utc',
       now() AT TIME ZONE 'utc'
FROM (VALUES ('core.inventory-count.read', 'read', 'Lihat opname stok'),
             ('core.inventory-count.update', 'update', 'Buat, hitung, dan batalkan opname stok'),
             ('core.inventory-count.post', 'invoke', 'Posting opname stok'),
             ('core.inventory-count.reverse', 'correct', 'Batalkan posting opname stok')) AS p(code, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'core', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.inventory-count.view', 'Melihat opname stok'),
             ('core.inventory-count.maintain', 'Membuat opname stok dan mengisi hitungannya'),
             ('core.inventory-count.posting', 'Memposting opname stok'),
             ('core.inventory-count.correction', 'Membatalkan posting opname stok')) AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('core.inventory-count.view', 'core.inventory-count.read'),
       ('core.inventory-count.maintain', 'core.inventory-count.read'),
       ('core.inventory-count.maintain', 'core.inventory-count.update'),
       ('core.inventory-count.posting', 'core.inventory-count.read'),
       ('core.inventory-count.posting', 'core.inventory-count.post'),
       ('core.inventory-count.correction', 'core.inventory-count.read'),
       ('core.inventory-count.correction', 'core.inventory-count.reverse')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
SELECT d.code, 'core', d.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.inventory-count.inquire', 'Lihat opname stok'),
             ('core.inventory-count.count', 'Hitung stok lewat opname'),
             ('core.inventory-count.manage', 'Kelola opname stok, posting, dan pembatalan postingnya')) AS d(code, name)
ON CONFLICT (code) DO NOTHING;

-- Layar opname membaca barang, kategori, lokasi, satuan, dan stok yang dirujuknya, jadi setiap duty ikut membawa hak
-- lihatnya.
INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
SELECT d.duty, p.privilege
FROM (VALUES ('core.inventory-count.inquire'), ('core.inventory-count.count'),
             ('core.inventory-count.manage')) AS d(duty)
CROSS JOIN (VALUES ('core.inventory-count.view'), ('core.inventory-item.view'), ('core.inventory-category.view'),
                   ('core.inventory-location.view'), ('core.inventory-unit.view'),
                   ('core.inventory-stock.view')) AS p(privilege)
UNION ALL
SELECT d.duty, d.privilege
FROM (VALUES ('core.inventory-count.count', 'core.inventory-count.maintain'),
             ('core.inventory-count.manage', 'core.inventory-count.maintain'),
             ('core.inventory-count.manage', 'core.inventory-count.posting'),
             ('core.inventory-count.manage', 'core.inventory-count.correction')) AS d(duty, privilege)
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT r.id, 'core.inventory-count.manage'
FROM public.roles r
WHERE r.is_owner AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
