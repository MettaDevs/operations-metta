-- Id ULID menjadi uuid native. Keputusan pemilik produk 9 November 2026: setiap kolom id ULID (character(26),
-- 27 byte, dibandingkan dengan collation en_US.utf8) menjadi uuid (16 byte, dibandingkan per byte) dengan nilai
-- 128 bit yang sama.
--
-- Kolom character(26) dicari dari katalog, sehingga berkas yang sama mengonversi skema kosong dan database hasil
-- pemulihan dump CoreERP yang lebih baru. Teks dan JSON yang menyimpan id ikut ditulis ulang ke teks uuid, karena
-- aplikasi menyusun kunci itu dari id dan tidak akan menemukan bentuk ULID lama. Untuk dump yang lebih baru,
-- jalankan database/find-ulid-text.sql sebelum dan sesudah migration ini untuk melihat kolom teks yang terlewat.

CREATE OR REPLACE FUNCTION public.ulid_to_uuid(ulid text) RETURNS uuid
    LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
    AS $$
DECLARE
    digits CONSTANT text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    letters CONSTANT text := upper(ulid);
    hex text;
    part bigint;
BEGIN
    IF ulid !~ '^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$' THEN
        RAISE EXCEPTION 'Bukan ULID: "%"', ulid USING ERRCODE = 'invalid_text_representation';
    END IF;
    -- 26 karakter x 5 bit = 130 bit dengan dua bit teratas nol. Karakter 1-2 menjadi byte pertama, lalu setiap
    -- 8 karakter (40 bit) menjadi 10 digit hex.
    hex := lpad(to_hex((strpos(digits, substr(letters, 1, 1)) - 1) * 32 + strpos(digits, substr(letters, 2, 1)) - 1), 2, '0');
    FOR chunk_start IN 3..19 BY 8 LOOP
        part := 0;
        FOR i IN chunk_start..chunk_start + 7 LOOP
            part := part * 32 + strpos(digits, substr(letters, i, 1)) - 1;
        END LOOP;
        hex := hex || lpad(to_hex(part), 10, '0');
    END LOOP;
    RETURN hex::uuid;
END $$;

CREATE OR REPLACE FUNCTION public.uuid_to_ulid(id uuid) RETURNS text
    LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
    AS $$
DECLARE
    digits CONSTANT text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    hex CONSTANT text := replace(id::text, '-', '');
    head CONSTANT integer := ('x' || substr(hex, 1, 2))::bit(8)::integer;
    ulid text := substr(digits, head / 32 + 1, 1) || substr(digits, head % 32 + 1, 1);
    part bigint;
BEGIN
    FOR chunk_start IN 3..23 BY 10 LOOP
        part := ('x' || lpad(substr(hex, chunk_start, 10), 16, '0'))::bit(64)::bigint;
        FOR shift IN REVERSE 35..0 BY 5 LOOP
            ulid := ulid || substr(digits, ((part >> shift) & 31)::integer + 1, 1);
        END LOOP;
    END LOOP;
    RETURN ulid;
END $$;

-- Fungsi bantu di pg_temp hanya hidup selama migration ini dan dibuang di akhir berkas.

-- Bagian yang utuh berupa ULID diganti teks uuid. Pemisah dan bagian lain tetap, jadi kode seperti
-- "comparison.<ULID>.outside_scope" di dalam record_id tidak ikut berubah.
CREATE FUNCTION pg_temp.ulid_parts_to_uuid(value text, separators text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
    SELECT coalesce(string_agg(
            CASE WHEN m.part[1] ~ '^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$'
                THEN public.ulid_to_uuid(m.part[1])::text ELSE m.part[1] END,
            '' ORDER BY m.n), value)
    FROM regexp_matches(value,
        CASE WHEN separators = '' THEN '^.*$' ELSE '[^' || separators || ']+|[' || separators || ']' END,
        'g') WITH ORDINALITY AS m(part, n)
$$;

-- String ULID di bawah key id, *_id, atau *_ids diganti di teks JSON aslinya, supaya baris yang tidak berubah tetap
-- sama persis dan baris yang berubah tidak ikut dirapikan.
CREATE FUNCTION pg_temp.json_ids_to_uuid(document json) RETURNS json
    LANGUAGE plpgsql IMMUTABLE STRICT
    AS $$
DECLARE
    rewritten text := document::text;
    ulid text;
BEGIN
    FOR ulid IN
        WITH RECURSIVE walk(key, value) AS (
            SELECT NULL::text, document::jsonb
            UNION ALL
            SELECT e.key, e.value
            FROM walk w
            CROSS JOIN LATERAL (
                SELECT o.key, o.value FROM jsonb_each(CASE WHEN jsonb_typeof(w.value) = 'object' THEN w.value END) o
                UNION ALL
                SELECT w.key, a.value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.value) = 'array' THEN w.value END) a
            ) e
        )
        SELECT DISTINCT value #>> '{}'
        FROM walk
        WHERE (key = 'id' OR key LIKE '%\_id' OR key LIKE '%\_ids')
          AND jsonb_typeof(value) = 'string'
          AND value #>> '{}' ~ '^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$'
    LOOP
        rewritten := replace(rewritten, '"' || ulid || '"', '"' || public.ulid_to_uuid(ulid) || '"');
    END LOOP;
    RETURN rewritten::json;
END $$;

CREATE FUNCTION pg_temp.posting_ids_to_uuid(posting_ids jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
    SELECT CASE WHEN jsonb_typeof(posting_ids) <> 'array' THEN posting_ids ELSE (
        SELECT coalesce(jsonb_agg(CASE WHEN jsonb_typeof(e.value) = 'string'
                THEN to_jsonb(pg_temp.ulid_parts_to_uuid(e.value #>> '{}', '-')) ELSE e.value END
            ORDER BY e.n), '[]'::jsonb)
        FROM jsonb_array_elements(posting_ids) WITH ORDINALITY AS e(value, n)) END
$$;

CREATE FUNCTION pg_temp.posting_hash_field(value jsonb, map_ids boolean) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
    SELECT CASE
        WHEN value IS NULL THEN 'null'
        WHEN map_ids AND jsonb_typeof(value) = 'string'
            AND value #>> '{}' ~ '^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$'
            THEN to_jsonb(public.ulid_to_uuid(value #>> '{}')::text)::text
        ELSE value::text END
$$;

-- Rumus input_hash milik FinancePostings.evaluate: sha256 atas JSON.stringify dari jenis posting, id, tanggal, dan
-- baris jurnal yang nominalnya sudah dibulatkan ke desimal mata uang.
CREATE FUNCTION pg_temp.posting_input_hash(input jsonb, decimals integer, map_ids boolean) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
    SELECT encode(sha256(convert_to('[' || concat_ws(',',
        pg_temp.posting_hash_field(input -> 'posting_type', false),
        pg_temp.posting_hash_field(input -> 'legal_entity_id', map_ids),
        pg_temp.posting_hash_field(input -> 'currency_code', false),
        pg_temp.posting_hash_field(input -> 'posting_date', false),
        pg_temp.posting_hash_field(input -> 'document_date', false),
        pg_temp.posting_hash_field(input -> 'settlement_mode', false),
        pg_temp.posting_hash_field(input -> 'vendor_id', map_ids),
        'null',
        'null',
        (SELECT '[' || coalesce(string_agg('[' || concat_ws(',',
                    pg_temp.posting_hash_field(l.value -> 'account_id', map_ids),
                    to_jsonb(round((l.value ->> 'debit')::numeric, decimals)::text)::text,
                    to_jsonb(round((l.value ->> 'credit')::numeric, decimals)::text)::text,
                    pg_temp.posting_hash_field(l.value -> 'org_unit_id', map_ids)) || ']',
                ',' ORDER BY l.n), '') || ']'
            FROM jsonb_array_elements(input -> 'lines') WITH ORDINALITY AS l(value, n))
    ) || ']', 'UTF8')), 'hex')
$$;

-- Hash dihitung ulang dengan id uuid hanya bila rumus di atas menghasilkan hash yang tersimpan dari input aslinya.
-- Baris lain dibiarkan: aplikasi pun sudah tidak bisa mencocokkannya sebelum konversi.
CREATE FUNCTION pg_temp.recompute_input_hash(input jsonb, decimals integer, stored text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
    IF input IS NOT NULL AND decimals IS NOT NULL
        AND pg_temp.posting_input_hash(input, decimals, false) = stored THEN
        RETURN pg_temp.posting_input_hash(input, decimals, true);
    END IF;
    RETURN stored;
EXCEPTION WHEN invalid_text_representation THEN
    RETURN stored;
END $$;

DO $$
DECLARE
    target record;
    dependent record;
    restore text[] := '{}';
    statement text;
BEGIN
    CREATE TEMP TABLE id_conversion (relid oid, attnum smallint, clause text) ON COMMIT DROP;

    INSERT INTO id_conversion
    SELECT a.attrelid, a.attnum, format('ALTER COLUMN %I TYPE uuid USING public.ulid_to_uuid(%I)', a.attname, a.attname)
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
      AND a.atttypid = 'bpchar'::regtype AND a.atttypmod = 26 + 4;

    -- Kolom id ULID yang tipenya varchar. time_zones.id diisi HasUlids, ref_*.tenant_id menyimpan id tenant, dan
    -- source_document_id selebar 26 karakter memang untuk ULID dokumen sumber.
    -- Kolom teks yang isinya disusun dari id, beserta pemisah bagiannya ('' berarti nilai utuh). period_key
    -- dilebarkan karena FP:<uuid>:<periode> lebih panjang dari 40 karakter.
    FOR target IN
        SELECT t.relname, t.attname, t.kind, t.separators, t.new_type, a.attrelid, a.attnum, a.atttypid,
            format_type(a.atttypid, a.atttypmod) AS current_type
        FROM (VALUES
            ('time_zones', 'id', 'id', NULL, NULL),
            ('ref_buildings', 'tenant_id', 'id', NULL, NULL),
            ('ref_districts', 'tenant_id', 'id', NULL, NULL),
            ('ref_group_of_houses', 'tenant_id', 'id', NULL, NULL),
            ('ref_land_plots', 'tenant_id', 'id', NULL, NULL),
            ('ref_postal_codes', 'tenant_id', 'id', NULL, NULL),
            ('ref_provinces', 'tenant_id', 'id', NULL, NULL),
            ('ref_regencies', 'tenant_id', 'id', NULL, NULL),
            ('ref_streets', 'tenant_id', 'id', NULL, NULL),
            ('ref_villages', 'tenant_id', 'id', NULL, NULL),
            ('workflow_instances', 'source_document_id', 'id', NULL, NULL),
            ('number_sequence_allocations', 'scope_key', 'text', '|:', NULL),
            ('number_sequence_continuous_pool', 'scope_key', 'text', '|:', NULL),
            ('number_sequence_counters', 'scope_key', 'text', '|:', NULL),
            ('number_sequence_issues', 'scope_key', 'text', '|:', NULL),
            ('number_sequence_reservations', 'scope_key', 'text', '|:', NULL),
            ('number_sequence_reusable_numbers', 'scope_key', 'text', '|:', NULL),
            ('number_sequence_allocations', 'period_key', 'text', ':', 'character varying(64)'),
            ('number_sequence_continuous_pool', 'period_key', 'text', ':', 'character varying(64)'),
            ('number_sequence_counters', 'period_key', 'text', ':', 'character varying(64)'),
            ('number_sequence_issues', 'period_key', 'text', ':', 'character varying(64)'),
            ('number_sequence_reservations', 'period_key', 'text', ':', 'character varying(64)'),
            ('number_sequence_reusable_numbers', 'period_key', 'text', ':', 'character varying(64)'),
            ('finance_postings', 'posting_id', 'text', '-', NULL),
            ('finance_postings', 'reverses_posting_id', 'text', '-', NULL),
            ('finance_postings', 'adjusts_posting_id', 'text', '-', NULL),
            ('aset_tr_export_penyusutan', 'posting_id', 'text', '-', NULL),
            ('aset_tr_penyesuaian_nilai_aset', 'posting_id', 'text', '-', NULL),
            ('aset_tr_penyusutan_aset', 'posted_posting_id', 'text', '-', NULL),
            ('aset_tr_reklasifikasi_aset', 'posting_id', 'text', '-', NULL),
            ('finance_postings', 'source_id', 'text', '', NULL),
            ('aset_tr_ledger_aset', 'source_id', 'text', '', NULL),
            ('document_attachments', 'record_id', 'text', '', NULL),
            ('document_notes', 'record_id', 'text', '', NULL),
            ('report_layout_defaults', 'scope_key', 'text', '', NULL),
            ('change_log_entries', 'record_id', 'text', ',', NULL),
            ('aset_tr_pembatalan', 'posting_ids', 'posting_ids', NULL, NULL),
            ('aset_tr_penerimaan_aset_details', 'atribut', 'json', NULL, NULL),
            ('aset_tr_penerimaan_aset_details', 'saldo_awal_buku', 'json', NULL, NULL),
            ('finance_postings', 'input_hash', 'input_hash', NULL, NULL)
        ) AS t(relname, attname, kind, separators, new_type)
        LEFT JOIN pg_attribute a
            ON a.attrelid = to_regclass(format('public.%I', t.relname)) AND a.attname = t.attname AND NOT a.attisdropped
    LOOP
        IF target.attnum IS NULL THEN
            RAISE EXCEPTION 'Kolom %.% tidak ada; daftar kolom di 0002 perlu diperbarui.', target.relname, target.attname;
        END IF;
        CONTINUE WHEN target.kind = 'id' AND target.atttypid = 'uuid'::regtype;
        INSERT INTO id_conversion VALUES (target.attrelid, target.attnum, CASE target.kind
            WHEN 'id' THEN format('ALTER COLUMN %I TYPE uuid USING public.ulid_to_uuid(%I)', target.attname, target.attname)
            WHEN 'text' THEN format('ALTER COLUMN %I TYPE %s USING pg_temp.ulid_parts_to_uuid(%I, %L)',
                target.attname, coalesce(target.new_type, target.current_type), target.attname, target.separators)
            WHEN 'json' THEN format('ALTER COLUMN %I TYPE json USING pg_temp.json_ids_to_uuid(%I)', target.attname, target.attname)
            WHEN 'posting_ids' THEN format('ALTER COLUMN %I TYPE jsonb USING pg_temp.posting_ids_to_uuid(%I)', target.attname, target.attname)
            WHEN 'input_hash' THEN format('ALTER COLUMN %I TYPE %s USING pg_temp.recompute_input_hash(input, currency_decimals, %I)',
                target.attname, target.current_type, target.attname)
        END);
    END LOOP;

    -- Foreign key dan trigger yang bergantung pada kolom yang berubah dilepas dulu, lalu dipasang lagi dari definisinya
    -- sendiri. Foreign key dipasang tanpa NOT VALID, jadi setiap baris diperiksa ulang.
    FOR dependent IN
        SELECT con.conrelid::regclass AS table_name, con.conname AS name,
            format('ALTER TABLE %s DROP CONSTRAINT %I', con.conrelid::regclass, con.conname) AS drop_statement,
            format('ALTER TABLE %s ADD CONSTRAINT %I %s', con.conrelid::regclass, con.conname, pg_get_constraintdef(con.oid)) AS create_statement
        FROM pg_constraint con
        WHERE con.contype = 'f' AND EXISTS (
            SELECT 1 FROM id_conversion t
            WHERE (t.relid = con.conrelid AND t.attnum = ANY (con.conkey))
               OR (t.relid = con.confrelid AND t.attnum = ANY (con.confkey)))
        UNION ALL
        SELECT tg.tgrelid::regclass, tg.tgname,
            format('DROP TRIGGER %I ON %s', tg.tgname, tg.tgrelid::regclass),
            pg_get_triggerdef(tg.oid)
        FROM pg_trigger tg
        WHERE NOT tg.tgisinternal AND EXISTS (
            SELECT 1 FROM pg_depend d JOIN id_conversion t ON t.relid = d.refobjid AND t.attnum = d.refobjsubid
            WHERE d.classid = 'pg_trigger'::regclass AND d.objid = tg.oid AND d.refclassid = 'pg_class'::regclass)
        ORDER BY 1, 2
    LOOP
        restore := restore || dependent.create_statement;
        EXECUTE dependent.drop_statement;
    END LOOP;

    -- Satu ALTER TABLE per tabel: setiap tabel ditulis ulang sekali dan index-nya dibangun ulang sekali.
    FOR target IN
        SELECT relid::regclass AS table_name, string_agg(clause, ', ' ORDER BY attnum) AS clauses
        FROM id_conversion GROUP BY relid ORDER BY 1
    LOOP
        EXECUTE format('ALTER TABLE %s %s', target.table_name, target.clauses);
    END LOOP;

    FOREACH statement IN ARRAY restore LOOP
        EXECUTE statement;
    END LOOP;

    -- ALTER COLUMN TYPE membuang statistik kolom, dan autovacuum tidak menghitung penulisan ulang tabel sebagai
    -- perubahan, jadi tanpa ANALYZE planner menebak sampai ada cukup banyak tulisan baru.
    FOR target IN SELECT DISTINCT relid::regclass AS table_name FROM id_conversion LOOP
        EXECUTE format('ANALYZE %s', target.table_name);
    END LOOP;
END $$;

-- Trigger function yang mencampur id dengan teks. Badannya sama dengan 0001 kecuali baris yang ditandai.
CREATE OR REPLACE FUNCTION public.aset_capture_book_ledger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    asset_row aset_tr_aset%ROWTYPE;
    context jsonb := coalesce(nullif(current_setting('coreerp.fa_ledger_context', true), '')::jsonb, '{}'::jsonb);
    acq numeric := 0; acc numeric := 0; wd numeric := 0; ap numeric := 0;
    entry_type text; entry_date date;
BEGIN
    SELECT * INTO STRICT asset_row FROM aset_tr_aset WHERE tenant_id = NEW.tenant_id AND id = NEW.aset_id;
    IF TG_OP = 'INSERT' THEN
        acq := NEW.acquisition_value; acc := NEW.accumulated_depreciation;
        wd := NEW.write_down_amount; ap := NEW.appreciation_amount;
        entry_type := 'acquisition';
    ELSIF OLD.status <> 'closed' AND NEW.status = 'closed' THEN
        acq := -OLD.acquisition_value; acc := -OLD.accumulated_depreciation;
        wd := -OLD.write_down_amount; ap := -OLD.appreciation_amount;
        entry_type := 'disposal';
    ELSE
        acq := NEW.acquisition_value - OLD.acquisition_value;
        acc := NEW.accumulated_depreciation - OLD.accumulated_depreciation;
        wd := NEW.write_down_amount - OLD.write_down_amount;
        ap := NEW.appreciation_amount - OLD.appreciation_amount;
        entry_type := CASE WHEN acq <> 0 THEN 'acquisition_correction'
            WHEN acc <> 0 THEN 'depreciation' WHEN wd <> 0 THEN 'write_down'
            WHEN ap <> 0 THEN 'appreciation' ELSE 'correction' END;
    END IF;
    IF acq = 0 AND acc = 0 AND wd = 0 AND ap = 0 THEN RETURN NEW; END IF;
    entry_type := coalesce(context->>'type', entry_type);
    entry_date := coalesce((context->>'date')::date, NEW.closed_on,
        CASE WHEN TG_OP = 'INSERT' THEN asset_row.acquired_on END, CURRENT_DATE);
    INSERT INTO aset_tr_ledger_aset(id, tenant_id, aset_id, buku_aset_id, buku_id,
        legal_entity_id, responsible_org_unit_id, group_aset_id, asset_code, asset_name,
        book_code, currency_code, posting_date, posting_type, source_type, source_id,
        document_number, description, acquisition_delta, accumulated_delta, write_down_delta,
        appreciation_delta, amount, created_at, updated_at)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.aset_id, NEW.id, NEW.buku_id,
        asset_row.legal_entity_id, asset_row.responsible_org_unit_id, asset_row.group_aset_id,
        asset_row.kode, asset_row.nama, NEW.book_code, asset_row.currency_code,
        entry_date, entry_type, coalesce(context->>'source_type', 'asset-book'),
        -- 0002: NEW.id kini uuid, sedangkan source_id tetap teks.
        coalesce(context->>'source_id', NEW.id::text), coalesce(context->>'document_number', asset_row.kode),
        context->>'description', acq, acc, wd, ap, acq - acc - wd + ap, now(), now());
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.aset_capture_group_ledger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    book_row aset_tr_buku_aset%ROWTYPE;
    context jsonb := coalesce(nullif(current_setting('coreerp.fa_ledger_context', true), '')::jsonb, '{}'::jsonb);
    -- 0002: dulu text, yang tidak bisa masuk ke group_aset_id bertipe uuid.
    target_group uuid; multiplier integer;
BEGIN
    IF NEW.group_aset_id IS NOT DISTINCT FROM OLD.group_aset_id THEN RETURN NEW; END IF;
    FOR book_row IN SELECT * FROM aset_tr_buku_aset WHERE tenant_id = NEW.tenant_id AND aset_id = NEW.id AND status = 'active' LOOP
        FOR multiplier IN SELECT unnest(ARRAY[-1,1]) LOOP
            target_group := CASE WHEN multiplier = -1 THEN OLD.group_aset_id ELSE NEW.group_aset_id END;
            INSERT INTO aset_tr_ledger_aset(id, tenant_id, aset_id, buku_aset_id, buku_id,
                legal_entity_id, responsible_org_unit_id, group_aset_id, asset_code, asset_name,
                book_code, currency_code, posting_date, posting_type, source_type, source_id,
                document_number, description, acquisition_delta, accumulated_delta, write_down_delta,
                appreciation_delta, amount, created_at, updated_at)
            VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, book_row.id, book_row.buku_id,
                NEW.legal_entity_id, NEW.responsible_org_unit_id, target_group, NEW.kode, NEW.nama,
                book_row.book_code, NEW.currency_code, coalesce((context->>'date')::date, CURRENT_DATE),
                -- 0002: NEW.id kini uuid, sedangkan source_id tetap teks.
                'reclassification', coalesce(context->>'source_type', 'asset'), coalesce(context->>'source_id', NEW.id::text),
                coalesce(context->>'document_number', NEW.kode), context->>'description',
                multiplier * book_row.acquisition_value, multiplier * book_row.accumulated_depreciation,
                multiplier * book_row.write_down_amount, multiplier * book_row.appreciation_amount,
                multiplier * book_row.net_book_value, now(), now());
        END LOOP;
    END LOOP;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.coreerp_log_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    -- 0002: tenant dan source dulu text; tenant_id kini uuid di setiap tabel yang dicatat.
    tenant uuid;
    source uuid;
    mode text;
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

    IF TG_TABLE_NAME IN ('change_log_setup_tables', 'change_log_setup_fields', 'roles', 'role_assignments',
            'security_role_duties', 'security_role_children', 'security_duties', 'security_duty_privileges',
            'security_privileges', 'security_privilege_permissions', 'role_assignment_data_policy_scopes',
            'automatic_role_assignment_rules', 'sod_rules') THEN
        mode := 'all';
    ELSE
        SELECT CASE TG_OP WHEN 'INSERT' THEN log_insertion WHEN 'UPDATE' THEN log_modification ELSE log_deletion END
          INTO mode FROM change_log_setup_tables WHERE tenant_id = tenant AND table_name = TG_TABLE_NAME;
        IF FOUND THEN
            source := tenant;
        ELSE
            SELECT CASE TG_OP WHEN 'INSERT' THEN log_insertion WHEN 'UPDATE' THEN log_modification ELSE log_deletion END
              INTO mode FROM change_log_setup_tables WHERE tenant_id IS NULL AND table_name = TG_TABLE_NAME;
        END IF;
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
             WHERE f.tenant_id IS NOT DISTINCT FROM source AND f.table_name = TG_TABLE_NAME AND f.field_name = field
               AND CASE TG_OP WHEN 'INSERT' THEN f.log_insertion WHEN 'UPDATE' THEN f.log_modification ELSE f.log_deletion END
        ) THEN
            CONTINUE;
        END IF;

        INSERT INTO change_log_entries (tenant_id, table_name, record_id, field_name, change_type, old_value, new_value)
        VALUES (tenant, TG_TABLE_NAME, record_key, field, change_kind, old_row ->> field, new_row ->> field);
    END LOOP;

    RETURN NULL;
END
$$;

DROP FUNCTION pg_temp.recompute_input_hash(jsonb, integer, text);
DROP FUNCTION pg_temp.posting_input_hash(jsonb, integer, boolean);
DROP FUNCTION pg_temp.posting_hash_field(jsonb, boolean);
DROP FUNCTION pg_temp.posting_ids_to_uuid(jsonb);
DROP FUNCTION pg_temp.json_ids_to_uuid(json);
DROP FUNCTION pg_temp.ulid_parts_to_uuid(text, text);
