-- Log perubahan mengikuti pola Business Central: hanya tabel keamanan dan setelan administrasi yang selalu dicatat,
-- selebihnya mati sampai tenant menyalakannya per tabel. Sebelumnya setiap migration yang menambah tabel mendaftarkannya
-- dengan insertion, modification, dan deletion = all lewat baris tanpa tenant, sehingga setiap baris dokumen transaksi
-- (registrasi, pemeriksaan, resep, tagihan, mutasi stok) menulis satu entri per field: belasan entri, sekitar 400 byte
-- masing-masing, untuk satu baris yang disimpan.
--
-- 1. Tabel yang selalu dicatat, padanan IsAlwaysLoggedTable di Change Log Management BC:
--    - setelan log perubahan itu sendiri (Change Log Setup, Change Log Setup (Table), Change Log Setup (Field));
--    - role, duty, privilege, dan rantai di antaranya (Permission Set, Permission, Tenant Permission Set,
--      Tenant Permission, Tenant Permission Set Rel.);
--    - keanggotaan pengguna di tenant dan role yang ditugaskan kepadanya, beserta batas datanya, aturan penugasan
--      otomatis, dan aturan segregation of duties (User, Access Control);
--    - hak tenant atas module (Plan);
--    - kebijakan data sharing antar legal entity, karena ia menentukan legal entity mana yang melihat data legal entity
--      lain, sama dengan hak akses;
--    - setelan retensi, karena ia menentukan kapan entri log perubahan dihapus, alasan yang sama dengan BC mencatat
--      setelan log perubahannya sendiri.
--    Entri dari tabel-tabel ini ditandai protected. BC menandai protected hanya entri G/L Entry yang diubah lewat
--    GLEntryEdit; di sini tidak ada ledger yang diubah di tempat (koreksi selalu lewat pembalikan), jadi tanda itu
--    dipakai untuk jejak keamanan, yang retensinya punya masa simpan minimum satu tahun (src/platform/retention/).
--    Keanggotaan tenant (tenant_memberships) belum punya trigger log_change, jadi trigger-nya ditambahkan di sini.
--    Mata uang, presisi, dan kurs tidak masuk: BC tidak selalu mencatat Currency maupun Currency Exchange Rate, dan kurs
--    sudah tersimpan sebagai riwayat per tanggal berlaku.
-- 2. Tabel lain hanya dicatat bila tenant punya barisnya sendiri di change_log_setup_tables, seperti Change Log Setup
--    (Table) BC yang disetel per perusahaan. Baris tanpa tenant tidak lagi dibaca trigger: ia hanya daftar tabel yang
--    bisa dicatat beserta captionnya. Migration module berjalan sesudah migration Core, dan migration yang sedang
--    dikerjakan bisa ber-nomor lebih kecil dari ini, sehingga bawaan lewat baris tanpa tenant tidak bisa dijamin mati.
-- 3. Setiap baris setelan yang ada, dengan atau tanpa tenant, ditulis ulang menjadi tidak mencatat. Entri yang sudah
--    tercatat tidak dihapus di sini; itu tugas retensi.

CREATE FUNCTION public.coreerp_change_log_always_logged(table_name text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    RETURN table_name IN (
        'change_log_setup_tables', 'change_log_setup_fields', 'roles', 'security_role_children',
        'security_role_duties', 'security_duties', 'security_duty_privileges', 'security_privileges',
        'security_privilege_permissions', 'tenant_memberships', 'role_assignments',
        'role_assignment_data_policy_scopes', 'automatic_role_assignment_rules', 'sod_rules',
        'tenant_app_entitlements', 'data_sharing_policies', 'data_sharing_policy_companies',
        'retention_policy_setups');

-- Entri lama dari tabel yang selalu dicatat ikut ditandai. ALTER COLUMN TYPE mengisi kolom baru tanpa menjalankan
-- trigger forbid_update yang menolak UPDATE pada change_log_entries, sama dengan 0003.
ALTER TABLE public.change_log_entries ADD COLUMN protected boolean;
ALTER TABLE public.change_log_entries
    ALTER COLUMN protected TYPE boolean USING public.coreerp_change_log_always_logged(table_name),
    ALTER COLUMN protected SET DEFAULT false,
    ALTER COLUMN protected SET NOT NULL;

CREATE OR REPLACE FUNCTION public.coreerp_log_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    tenant uuid;
    mode text;
    always_logged boolean;
    rec jsonb;
    old_row jsonb;
    new_row jsonb;
    record_key text;
    change_kind text;
    field text;
    i integer;
    role_ref roles.id%TYPE;
    code_ref text;
BEGIN
    IF COALESCE(current_setting('coreerp.change_log', true), '') = 'off' OR TG_TABLE_NAME = 'change_log_entries' THEN
        RETURN NULL;
    END IF;

    -- Tabel akses tanpa tenant_id: tenantnya milik peran, duty, atau privilege yang dirujuk.
    IF TG_TABLE_NAME IN ('role_assignments', 'security_role_duties') THEN
        IF TG_OP = 'DELETE' THEN role_ref := OLD.role_id; ELSE role_ref := NEW.role_id; END IF;
        SELECT r.tenant_id INTO tenant FROM roles r WHERE r.id = role_ref;
    ELSIF TG_TABLE_NAME = 'security_duty_privileges' THEN
        IF TG_OP = 'DELETE' THEN code_ref := OLD.duty_code; ELSE code_ref := NEW.duty_code; END IF;
        SELECT d.tenant_id INTO tenant FROM security_duties d WHERE d.code = code_ref;
    ELSIF TG_TABLE_NAME = 'security_privilege_permissions' THEN
        IF TG_OP = 'DELETE' THEN code_ref := OLD.privilege_code; ELSE code_ref := NEW.privilege_code; END IF;
        SELECT p.tenant_id INTO tenant FROM security_privileges p WHERE p.code = code_ref;
    ELSIF TG_OP = 'DELETE' THEN
        tenant := OLD.tenant_id;
    ELSE
        tenant := NEW.tenant_id;
    END IF;
    IF tenant IS NULL THEN
        RETURN NULL;
    END IF;

    always_logged := public.coreerp_change_log_always_logged(TG_TABLE_NAME);
    IF always_logged THEN
        mode := 'all';
    ELSE
        SELECT CASE TG_OP WHEN 'INSERT' THEN log_insertion WHEN 'UPDATE' THEN log_modification ELSE log_deletion END
          INTO mode FROM change_log_setup_tables WHERE tenant_id = tenant AND table_name = TG_TABLE_NAME;
    END IF;

    IF mode IS NULL OR mode = 'none' THEN
        RETURN NULL;
    END IF;

    IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
    IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;
    rec := COALESCE(new_row, old_row);
    change_kind := CASE TG_OP WHEN 'INSERT' THEN 'insertion' WHEN 'UPDATE' THEN 'modification' ELSE 'deletion' END;

    IF TG_NARGS = 0 THEN
        record_key := rec ->> 'id';
    ELSE
        record_key := '';
        FOR i IN 0 .. TG_NARGS - 1 LOOP
            record_key := record_key || CASE WHEN i > 0 THEN ',' ELSE '' END || COALESCE(rec ->> TG_ARGV[i], '');
        END LOOP;
    END IF;

    FOR field IN SELECT jsonb_object_keys(rec) LOOP
        CONTINUE WHEN field IN ('id', 'tenant_id', 'created_at', 'updated_at', 'created_by_user_id', 'updated_by_user_id', 'version');
        CONTINUE WHEN TG_OP = 'UPDATE' AND (old_row -> field) IS NOT DISTINCT FROM (new_row -> field);
        CONTINUE WHEN TG_OP = 'INSERT' AND (new_row -> field) = 'null'::jsonb;
        CONTINUE WHEN TG_OP = 'DELETE' AND (old_row -> field) = 'null'::jsonb;
        IF mode = 'some' AND NOT EXISTS (
            SELECT 1 FROM change_log_setup_fields f
             WHERE f.tenant_id = tenant AND f.table_name = TG_TABLE_NAME AND f.field_name = field
               AND CASE TG_OP WHEN 'INSERT' THEN f.log_insertion WHEN 'UPDATE' THEN f.log_modification ELSE f.log_deletion END
        ) THEN
            CONTINUE;
        END IF;

        INSERT INTO change_log_entries (tenant_id, table_name, record_id, field_name, change_type, old_value, new_value,
                                        protected)
        VALUES (tenant, TG_TABLE_NAME, record_key, field, change_kind, old_row ->> field, new_row ->> field,
                always_logged);
    END LOOP;

    RETURN NULL;
END
$$;

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.tenant_memberships
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

UPDATE public.change_log_setup_tables
   SET log_insertion = 'none', log_modification = 'none', log_deletion = 'none',
       updated_at = now() AT TIME ZONE 'utc'
 WHERE (log_insertion, log_modification, log_deletion) <> ('none', 'none', 'none');

UPDATE public.change_log_setup_fields
   SET log_insertion = false, log_modification = false, log_deletion = false,
       updated_at = now() AT TIME ZONE 'utc'
 WHERE log_insertion OR log_modification OR log_deletion;
