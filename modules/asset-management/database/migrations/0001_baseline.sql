-- Skema module aset dari CoreERP commit 6b3cf584, sudah dalam bentuk uuid: keluaran pg_dump --schema-only --no-owner
-- --no-privileges atas database kosong yang dimigrasi 0001 dan 0002 sebelum objek aset dipisah dari Core (commit
-- 0d46662), dibatasi pada entri milik tabel aset_ (tabel, index, constraint, foreign key, trigger) serta function
-- aset_. Baris \restrict dan \unrestrict dibuang karena keduanya perintah psql, bukan SQL.

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.11 (Debian 17.11-1.pgdg13+2)
-- Dumped by pg_dump version 17.11 (Debian 17.11-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: aset_capture_book_ledger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.aset_capture_book_ledger() RETURNS trigger
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


--
-- Name: aset_capture_group_ledger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.aset_capture_group_ledger() RETURNS trigger
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


--
-- Name: aset_guard_budgeted_actual_entry(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.aset_guard_budgeted_actual_entry() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM aset_tr_aset WHERE tenant_id = NEW.tenant_id AND id = NEW.aset_id AND is_budgeted) THEN
        RAISE EXCEPTION 'Aset sebagai perencanaan tidak dapat disusutkan atau diposting sebagai transaksi aktual.';
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: aset_guard_budgeted_identity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.aset_guard_budgeted_identity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.is_budgeted IS DISTINCT FROM OLD.is_budgeted THEN
        RAISE EXCEPTION 'Jenis aset rencana/aktual tidak dapat diubah pada kartu tersimpan.';
    END IF;
    IF NEW.is_budgeted <> (NEW.lifecycle_state = 'budgeted') THEN
        RAISE EXCEPTION 'Status aset rencana tidak sesuai.';
    END IF;
    IF NEW.is_budgeted AND (NEW.acquisition_value <> 0 OR NEW.acquired_on IS NOT NULL OR NEW.placed_in_service_on IS NOT NULL) THEN
        RAISE EXCEPTION 'Aset rencana tidak membawa perolehan atau pemakaian aktual.';
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: aset_guard_ledger_history(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.aset_guard_ledger_history() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'Catatan ledger aset tidak dapat diubah atau dihapus; buat transaksi pembalik.';
END $$;


--
-- Name: aset_m_alasan_downtime; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_alasan_downtime (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    nama character varying(150) NOT NULL,
    keterangan text,
    aktif boolean DEFAULT true NOT NULL,
    masuk_kpi boolean DEFAULT true NOT NULL,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: aset_m_analisa_maintenance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_analisa_maintenance (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    nama character varying(150) NOT NULL,
    keterangan text,
    aktif boolean DEFAULT true NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_m_buku_penyusutan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_buku_penyusutan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    nama character varying(150) NOT NULL,
    keterangan text,
    aktif boolean DEFAULT true NOT NULL,
    posting_layer character varying(20) DEFAULT 'current'::character varying NOT NULL,
    depreciation_profile_id uuid,
    alternative_profile_id uuid,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    round_off_depreciation numeric(18,2) DEFAULT '0'::numeric NOT NULL,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_m_group_aset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_group_aset (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    nama character varying(150) NOT NULL,
    keterangan text,
    aktif boolean DEFAULT true NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    default_depreciation_profile_id uuid,
    default_book_code character varying(50),
    tipe_harta character varying(30),
    capitalization_threshold numeric(18,2),
    kelompok_harta_fiskal_id uuid,
    property_type character varying(30),
    lokasi_aset_id uuid,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    creation_payload_hash character(64)
);


--
-- Name: aset_m_group_buku_penyusutan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_group_buku_penyusutan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    group_aset_id uuid NOT NULL,
    buku_id uuid NOT NULL,
    depreciation_profile_id uuid,
    alternative_profile_id uuid,
    useful_life_periods integer,
    convention character varying(30),
    depreciate boolean DEFAULT true NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    round_off_depreciation numeric(18,2),
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_m_item_checklist_maintenance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_item_checklist_maintenance (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    nama character varying(150) NOT NULL,
    keterangan text,
    aktif boolean DEFAULT true NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_m_jenis_aset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_jenis_aset (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    nama character varying(150) NOT NULL,
    keterangan text,
    aktif boolean DEFAULT true NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    creation_payload_hash character(64)
);


--
-- Name: aset_m_jenis_aset_atribut; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_jenis_aset_atribut (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    jenis_aset_id uuid NOT NULL,
    tipe_atribut_id uuid NOT NULL,
    wajib boolean DEFAULT false NOT NULL,
    urutan smallint DEFAULT '0'::smallint NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_m_jenis_aset_counter; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_jenis_aset_counter (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    jenis_aset_id uuid NOT NULL,
    jenis_counter_id uuid NOT NULL,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: aset_m_jenis_aset_kondisi; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_jenis_aset_kondisi (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    jenis_aset_id uuid NOT NULL,
    kondisi_aset_id uuid NOT NULL,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: aset_m_jenis_asuransi; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_jenis_asuransi (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    nama character varying(150) NOT NULL,
    keterangan text,
    aktif boolean DEFAULT true NOT NULL,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: aset_m_jenis_counter; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_jenis_counter (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    nama character varying(150) NOT NULL,
    keterangan text,
    aktif boolean DEFAULT true NOT NULL,
    satuan_id uuid NOT NULL,
    satuan character varying(40),
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: aset_m_jenis_permintaan_pemeliharaan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_jenis_permintaan_pemeliharaan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    nama character varying(150) NOT NULL,
    keterangan text,
    aktif boolean DEFAULT true NOT NULL,
    tipe_work_order_id uuid,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: aset_m_kelompok_harta_fiskal; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_kelompok_harta_fiskal (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    template_key character varying(160) NOT NULL,
    jurisdiction character varying(32) NOT NULL,
    label character varying(150) NOT NULL,
    regulation_reference character varying(250),
    effective_from date NOT NULL,
    effective_to date,
    useful_life_years integer,
    straight_line_rate_percent numeric(9,4),
    reducing_balance_rate_percent numeric(9,4),
    allow_reducing_balance boolean DEFAULT false NOT NULL,
    depreciable boolean DEFAULT true NOT NULL,
    aktif boolean DEFAULT true NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    allow_straight_line boolean DEFAULT true NOT NULL,
    kode character varying(10)
);


--
-- Name: aset_m_kondisi_aset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_kondisi_aset (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    nama character varying(150) NOT NULL,
    keterangan text,
    aktif boolean DEFAULT true NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_m_lokasi_aset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_lokasi_aset (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    parent_id uuid,
    nama character varying(150) NOT NULL,
    aktif boolean DEFAULT true NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    keterangan text,
    tipe_lokasi_id uuid,
    org_unit_id uuid,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    alamat_id uuid,
    departemen_bawaan_id uuid
);


--
-- Name: aset_m_maintenance_checklist_template; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_maintenance_checklist_template (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    nama character varying(150) NOT NULL,
    keterangan text,
    aktif boolean DEFAULT true NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    creation_payload_hash character(64)
);


--
-- Name: aset_m_maintenance_checklist_template_line; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_maintenance_checklist_template_line (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    template_id uuid NOT NULL,
    line_number numeric(8,1) NOT NULL,
    type character varying(20) NOT NULL,
    variable_id uuid,
    nested_template_id uuid,
    unit character varying(40),
    nama character varying(255) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    wajib boolean DEFAULT false NOT NULL,
    instruksi text,
    unit_id uuid,
    min_value numeric(18,6),
    max_value numeric(18,6),
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone
);


--
-- Name: aset_m_maintenance_checklist_variable; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_maintenance_checklist_variable (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    nama character varying(150) NOT NULL,
    keterangan text,
    aktif boolean DEFAULT true NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    creation_payload_hash character(64)
);


--
-- Name: aset_m_maintenance_checklist_variable_value; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_maintenance_checklist_variable_value (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    variable_id uuid NOT NULL,
    line_number numeric(8,1) NOT NULL,
    value character varying(255) NOT NULL,
    result_code character varying(20) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone
);


--
-- Name: aset_m_maintenance_job_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_maintenance_job_type (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    nama character varying(150) NOT NULL,
    keterangan text,
    aktif boolean DEFAULT true NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    category_code character varying(40) DEFAULT 'preventive'::character varying NOT NULL,
    maintenance_downtime_activities boolean DEFAULT false NOT NULL,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    creation_payload_hash character(64)
);


--
-- Name: aset_m_maintenance_job_type_default; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_maintenance_job_type_default (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    nama character varying(150) NOT NULL,
    keterangan text,
    aktif boolean DEFAULT true NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    maintenance_job_type_id uuid NOT NULL,
    variant_id uuid,
    trade character varying(100),
    functional_location_id uuid,
    jenis_aset_id uuid,
    pabrikan_aset_id uuid,
    model_aset_id uuid,
    aset_id uuid,
    hours numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    items_count integer DEFAULT 0 NOT NULL,
    expenses_count integer DEFAULT 0 NOT NULL,
    fees_count integer DEFAULT 0 NOT NULL,
    checklist_template_id uuid,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    creation_payload_hash character(64)
);


--
-- Name: aset_m_maintenance_job_type_jenis_aset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_maintenance_job_type_jenis_aset (
    tenant_id uuid NOT NULL,
    job_type_id uuid NOT NULL,
    jenis_aset_id uuid NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_m_maintenance_job_type_variant; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_maintenance_job_type_variant (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    maintenance_job_type_id uuid NOT NULL,
    kode character varying(50) NOT NULL,
    nama character varying(150) NOT NULL,
    keterangan text,
    aktif boolean DEFAULT true NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_m_model_aset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_model_aset (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    pabrikan_aset_id uuid NOT NULL,
    jenis_aset_id uuid,
    kode character varying(50) NOT NULL,
    nama character varying(150) NOT NULL,
    keterangan text,
    aktif boolean DEFAULT true NOT NULL,
    model_number character varying(150),
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_m_pabrikan_aset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_pabrikan_aset (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    nama character varying(150) NOT NULL,
    keterangan text,
    aktif boolean DEFAULT true NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    creation_payload_hash character(64)
);


--
-- Name: aset_m_polis_asuransi; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_polis_asuransi (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    legal_entity_id uuid NOT NULL,
    nama character varying(150) NOT NULL,
    nomor_polis character varying(60) NOT NULL,
    jenis_asuransi_id uuid,
    vendor_id uuid,
    berlaku_mulai date NOT NULL,
    berlaku_sampai date,
    premi_tahunan numeric(18,2) DEFAULT '0'::numeric NOT NULL,
    nilai_pertanggungan numeric(18,2) DEFAULT '0'::numeric NOT NULL,
    diblokir boolean DEFAULT false NOT NULL,
    keterangan text,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    creation_payload_hash character(64),
    CONSTRAINT aset_m_polis_asuransi_periode CHECK (((berlaku_sampai IS NULL) OR (berlaku_sampai >= berlaku_mulai)))
);


--
-- Name: aset_m_posting_group; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_posting_group (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    group_aset_id uuid NOT NULL,
    effective_from date NOT NULL,
    acquisition_account_id uuid,
    accumulated_depreciation_account_id uuid,
    depreciation_expense_account_id uuid,
    payable_account_id uuid,
    clearing_account_id uuid,
    input_vat_account_id uuid,
    opening_balance_offset_account_id uuid,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    grant_offset_account_id uuid,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    write_down_account_id uuid,
    write_down_expense_account_id uuid,
    appreciation_account_id uuid,
    appreciation_offset_account_id uuid,
    disposal_proceeds_account_id uuid,
    disposal_gain_account_id uuid,
    disposal_loss_account_id uuid
);


--
-- Name: aset_m_profil_penyusutan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_profil_penyusutan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    nama character varying(150) NOT NULL,
    keterangan text,
    method character varying(40) NOT NULL,
    frequency character varying(20) NOT NULL,
    year_basis character varying(20) NOT NULL,
    convention character varying(40),
    useful_life_periods integer,
    rate_percent numeric(9,4),
    manual_schedule json,
    aktif boolean DEFAULT true NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    effective_from date,
    effective_to date,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_m_rencana_pemeliharaan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_rencana_pemeliharaan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    nama character varying(150) NOT NULL,
    keterangan text,
    aktif boolean DEFAULT true NOT NULL,
    tanggal_mulai date NOT NULL,
    toleransi_hari_sebelum smallint DEFAULT '0'::smallint NOT NULL,
    toleransi_hari_sesudah smallint DEFAULT '0'::smallint NOT NULL,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    creation_payload_hash character(64)
);


--
-- Name: aset_m_rencana_pemeliharaan_baris; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_rencana_pemeliharaan_baris (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    rencana_pemeliharaan_id uuid NOT NULL,
    line_number integer NOT NULL,
    dasar character varying(30) NOT NULL,
    "interval" integer,
    satuan_interval character varying(10),
    jenis_counter_id uuid,
    interval_counter numeric(18,2),
    toleransi_counter numeric(18,2) DEFAULT '0'::numeric NOT NULL,
    maintenance_job_type_id uuid NOT NULL,
    variant_id uuid,
    trade_id uuid,
    tipe_work_order_id uuid NOT NULL,
    tingkat_layanan_id uuid,
    selesai_dalam_hari smallint,
    deskripsi text,
    aktif boolean DEFAULT true NOT NULL,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: aset_m_rencana_pemeliharaan_objek; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_rencana_pemeliharaan_objek (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    rencana_pemeliharaan_id uuid NOT NULL,
    aset_id uuid,
    jenis_aset_id uuid,
    tanggal_mulai date,
    aktif boolean DEFAULT true NOT NULL,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT aset_m_rencana_objek_satu_sasaran CHECK (((aset_id IS NULL) <> (jenis_aset_id IS NULL)))
);


--
-- Name: aset_m_sebab_kerusakan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_sebab_kerusakan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    nama character varying(150) NOT NULL,
    keterangan text,
    aktif boolean DEFAULT true NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    minta_keterangan boolean DEFAULT false NOT NULL,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_m_tindakan_perbaikan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_tindakan_perbaikan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    nama character varying(150) NOT NULL,
    keterangan text,
    aktif boolean DEFAULT true NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    minta_keterangan boolean DEFAULT false NOT NULL,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_m_tingkat_layanan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_tingkat_layanan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    nama character varying(150) NOT NULL,
    keterangan text,
    aktif boolean DEFAULT true NOT NULL,
    urutan integer DEFAULT 0 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_m_tipe_atribut; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_tipe_atribut (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    nama character varying(150) NOT NULL,
    keterangan text,
    aktif boolean DEFAULT true NOT NULL,
    data_type character varying(20) NOT NULL,
    satuan character varying(50),
    min_value numeric(24,6),
    max_value numeric(24,6),
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    satuan_id uuid,
    data_type_locked boolean DEFAULT false NOT NULL,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    creation_payload_hash character(64)
);


--
-- Name: aset_m_tipe_atribut_nilai; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_tipe_atribut_nilai (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    tipe_atribut_id uuid NOT NULL,
    urutan smallint DEFAULT '0'::smallint NOT NULL,
    nilai character varying(150) NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_m_tipe_lokasi_aset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_tipe_lokasi_aset (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    nama character varying(150) NOT NULL,
    keterangan text,
    aktif boolean DEFAULT true NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_m_tipe_work_order; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_tipe_work_order (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    nama character varying(150) NOT NULL,
    keterangan text,
    aktif boolean DEFAULT true NOT NULL,
    satu_pekerja boolean DEFAULT false NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_m_trade; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_trade (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    nama character varying(150) NOT NULL,
    keterangan text,
    aktif boolean DEFAULT true NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_m_validasi_status_work_order; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_m_validasi_status_work_order (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    status character varying(30) NOT NULL,
    aturan character varying(40) NOT NULL,
    aktif boolean DEFAULT true NOT NULL,
    keparahan character varying(20) DEFAULT 'error'::character varying NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_pengaturan_aset_tetap; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_pengaturan_aset_tetap (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    buku_penyusutan_bawaan_id uuid,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: aset_processed_core_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_processed_core_events (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    event_id uuid NOT NULL,
    processed_at timestamp(0) without time zone NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_tr_aset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_aset (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    legal_entity_id uuid NOT NULL,
    group_aset_id uuid NOT NULL,
    jenis_aset_id uuid NOT NULL,
    kondisi_aset_id uuid,
    pabrikan_aset_id uuid,
    model_aset_id uuid,
    induk_aset_id uuid,
    lokasi_aset_id uuid,
    serial_number character varying(150),
    model_number character varying(150),
    acquired_on date,
    placed_in_service_on date,
    acquisition_value numeric(18,2) NOT NULL,
    currency_code character varying(3),
    lifecycle_state character varying(30) DEFAULT 'received'::character varying NOT NULL,
    keterangan text,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    responsible_org_unit_id uuid,
    financial_dimension_org_unit_id uuid,
    kelompok_harta_fiskal_id uuid,
    nama character varying(150) NOT NULL,
    penerimaan_aset_id uuid,
    penerimaan_aset_detail_id uuid,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    is_budgeted boolean DEFAULT false NOT NULL
);


--
-- Name: aset_tr_aset_atribut; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_aset_atribut (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    aset_id uuid NOT NULL,
    tipe_atribut_id uuid NOT NULL,
    nilai_text text,
    nilai_number numeric(24,6),
    nilai_boolean boolean,
    nilai_date date,
    tipe_atribut_nilai_id uuid,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_tr_buku_aset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_buku_aset (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    aset_id uuid NOT NULL,
    depreciation_profile_id uuid,
    book_code character varying(50) NOT NULL,
    acquisition_value numeric(18,2) NOT NULL,
    residual_value numeric(18,2) DEFAULT '0'::numeric NOT NULL,
    accumulated_depreciation numeric(18,2) DEFAULT '0'::numeric NOT NULL,
    net_book_value numeric(18,2) NOT NULL,
    status character varying(30) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    buku_id uuid,
    useful_life_periods integer,
    convention character varying(30),
    alternative_profile_id uuid,
    depreciation_start_on date,
    depreciate boolean DEFAULT true NOT NULL,
    round_off_depreciation numeric(18,2) DEFAULT '0'::numeric NOT NULL,
    closed_on date,
    opening_accumulated_depreciation numeric(18,2) DEFAULT '0'::numeric NOT NULL,
    elapsed_periods_offset integer DEFAULT 0 NOT NULL,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    write_down_amount numeric(18,2) DEFAULT '0'::numeric NOT NULL,
    appreciation_amount numeric(18,2) DEFAULT '0'::numeric NOT NULL
);


--
-- Name: aset_tr_dokumen_siklus_aset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_dokumen_siklus_aset (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    jenis_dokumen character varying(40) NOT NULL,
    kode character varying(50) NOT NULL,
    legal_entity_id uuid NOT NULL,
    aset_id uuid,
    tanggal date NOT NULL,
    status character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    nilai numeric(18,2),
    keterangan text,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    responsible_org_unit_id uuid,
    workflow_instance_id uuid,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone
);


--
-- Name: aset_tr_downtime_aset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_downtime_aset (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    aset_id uuid NOT NULL,
    mulai timestamp(0) without time zone NOT NULL,
    selesai timestamp(0) without time zone,
    alasan_downtime_id uuid,
    pemeliharaan_aset_id uuid,
    permintaan_pemeliharaan_id uuid,
    sumber character varying(20) DEFAULT 'manual'::character varying NOT NULL,
    keterangan text,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT aset_tr_downtime_periode CHECK (((selesai IS NULL) OR (selesai > mulai)))
);


--
-- Name: aset_tr_export_penyusutan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_export_penyusutan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    posting_id character varying(80) NOT NULL,
    depreciation_period_id uuid NOT NULL,
    payload json NOT NULL,
    finalized_at timestamp(0) without time zone NOT NULL,
    acknowledged_at timestamp(0) without time zone,
    external_reference character varying(160),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_tr_garansi_aset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_garansi_aset (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    aset_id uuid NOT NULL,
    vendor_id uuid,
    jenis_garansi character varying(20) NOT NULL,
    nomor_referensi character varying(80),
    berlaku_mulai date NOT NULL,
    berlaku_sampai date NOT NULL,
    catatan text,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT aset_tr_garansi_periode CHECK ((berlaku_sampai >= berlaku_mulai))
);


--
-- Name: aset_tr_jadwal_pemeliharaan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_jadwal_pemeliharaan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    rencana_pemeliharaan_id uuid NOT NULL,
    rencana_baris_id uuid NOT NULL,
    aset_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    responsible_org_unit_id uuid,
    jatuh_tempo date NOT NULL,
    nilai_jatuh_tempo numeric(18,2),
    nilai_counter numeric(18,2),
    status character varying(30) DEFAULT 'usulan'::character varying NOT NULL,
    pemeliharaan_aset_id uuid,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: aset_tr_kontrak_servis; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_kontrak_servis (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    legal_entity_id uuid NOT NULL,
    nomor_kontrak character varying(80) NOT NULL,
    vendor_id uuid NOT NULL,
    berlaku_mulai date NOT NULL,
    berlaku_sampai date NOT NULL,
    cakupan text,
    nilai_kontrak numeric(18,2),
    keterangan text,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT aset_tr_kontrak_servis_periode CHECK ((berlaku_sampai >= berlaku_mulai))
);


--
-- Name: aset_tr_kontrak_servis_aset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_kontrak_servis_aset (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kontrak_servis_id uuid NOT NULL,
    line_number integer NOT NULL,
    aset_id uuid NOT NULL,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: aset_tr_ledger_aset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_ledger_aset (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    aset_id uuid NOT NULL,
    buku_aset_id uuid NOT NULL,
    buku_id uuid,
    legal_entity_id uuid NOT NULL,
    responsible_org_unit_id uuid,
    group_aset_id uuid,
    asset_code character varying(120) NOT NULL,
    asset_name character varying(255) NOT NULL,
    book_code character varying(120) NOT NULL,
    currency_code character varying(3) NOT NULL,
    posting_date date,
    posting_type character varying(40) NOT NULL,
    source_type character varying(80) NOT NULL,
    source_id character varying(120) NOT NULL,
    document_number character varying(120) NOT NULL,
    description text,
    acquisition_delta numeric(24,2) DEFAULT '0'::numeric NOT NULL,
    accumulated_delta numeric(24,2) DEFAULT '0'::numeric NOT NULL,
    write_down_delta numeric(24,2) DEFAULT '0'::numeric NOT NULL,
    appreciation_delta numeric(24,2) DEFAULT '0'::numeric NOT NULL,
    amount numeric(24,2) DEFAULT '0'::numeric NOT NULL,
    is_reconstructed boolean DEFAULT false NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_tr_monitoring_aset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_monitoring_aset (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    legal_entity_id uuid NOT NULL,
    responsible_org_unit_id uuid,
    penanggung_jawab_user_id character varying(64),
    lokasi_aset_id uuid NOT NULL,
    tanggal date NOT NULL,
    keterangan text,
    status character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    diselesaikan_pada timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: aset_tr_monitoring_aset_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_monitoring_aset_details (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    monitoring_aset_id uuid NOT NULL,
    line_number integer NOT NULL,
    aset_id uuid NOT NULL,
    ada boolean,
    kondisi_aset_id uuid,
    keterangan text,
    sistem_lifecycle_state character varying(30),
    sistem_lokasi_id uuid,
    sistem_org_unit_id uuid,
    sistem_custodian_user_id character varying(64),
    nilai_perolehan numeric(18,2),
    akumulasi_penyusutan numeric(18,2),
    nilai_buku numeric(18,2),
    hasil character varying(20),
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: aset_tr_mutasi_aset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_mutasi_aset (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    legal_entity_id uuid NOT NULL,
    responsible_org_unit_id uuid NOT NULL,
    tanggal date NOT NULL,
    tujuan_lokasi_id uuid,
    tujuan_org_unit_id uuid NOT NULL,
    diserahkan_oleh_user_id character varying(64),
    diterima_oleh_user_id character varying(64),
    alasan character varying(250) NOT NULL,
    keterangan text,
    status character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint
);


--
-- Name: aset_tr_mutasi_aset_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_mutasi_aset_details (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    mutasi_aset_id uuid NOT NULL,
    line_number integer NOT NULL,
    aset_id uuid NOT NULL,
    kondisi_aset_id uuid,
    asal_lokasi_id uuid,
    asal_org_unit_id uuid,
    asal_custodian_user_id character varying(64),
    catatan text,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_tr_pembacaan_counter; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_pembacaan_counter (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    aset_id uuid NOT NULL,
    jenis_counter_id uuid NOT NULL,
    dibaca_pada timestamp(0) without time zone NOT NULL,
    nilai numeric(18,2) NOT NULL,
    nilai_total numeric(18,2) NOT NULL,
    reset boolean DEFAULT false NOT NULL,
    keterangan text,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: aset_tr_pembatalan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_pembatalan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    resource character varying(60) NOT NULL,
    document_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    responsible_org_unit_id uuid,
    source_version integer,
    reason character varying(250) NOT NULL,
    posting_date date NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    requested_by_user_id character varying(60) NOT NULL,
    acted_by_user_id character varying(60),
    workflow_instance_id uuid,
    posting_ids jsonb,
    failure_message text,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: aset_tr_pemeliharaan_aset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_pemeliharaan_aset (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    legal_entity_id uuid NOT NULL,
    responsible_org_unit_id uuid NOT NULL,
    tipe_work_order_id uuid NOT NULL,
    tingkat_layanan_id uuid,
    keterangan text,
    penanggung_jawab_user_id character varying(64),
    diharapkan_mulai timestamp(0) without time zone,
    diharapkan_selesai timestamp(0) without time zone,
    dijadwalkan_mulai timestamp(0) without time zone,
    dijadwalkan_selesai timestamp(0) without time zone,
    aktual_mulai timestamp(0) without time zone,
    aktual_selesai timestamp(0) without time zone,
    status character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint
);


--
-- Name: aset_tr_pemeliharaan_aset_checklist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_pemeliharaan_aset_checklist (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    pemeliharaan_aset_detail_id uuid NOT NULL,
    line_number numeric(8,1) NOT NULL,
    nama character varying(255) NOT NULL,
    tipe character varying(20) NOT NULL,
    satuan character varying(40),
    wajib boolean DEFAULT false NOT NULL,
    instruksi text,
    sumber character varying(40),
    sumber_id uuid,
    nilai character varying(255),
    result_code character varying(20),
    tidak_berlaku boolean DEFAULT false NOT NULL,
    diperiksa boolean DEFAULT false NOT NULL,
    diperiksa_oleh_user_id character varying(64),
    diperiksa_pada timestamp(0) without time zone,
    catatan_teknisi text,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    min_value numeric(18,6),
    max_value numeric(18,6),
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_tr_pemeliharaan_aset_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_pemeliharaan_aset_details (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    pemeliharaan_aset_id uuid NOT NULL,
    line_number integer NOT NULL,
    aset_id uuid NOT NULL,
    lokasi_aset_id uuid,
    maintenance_job_type_id uuid NOT NULL,
    variant_id uuid,
    trade_id uuid,
    ditugaskan_ke_user_id character varying(64),
    dijadwalkan_mulai timestamp(0) without time zone,
    dijadwalkan_selesai timestamp(0) without time zone,
    estimasi_jam numeric(8,2),
    aktual_jam numeric(8,2),
    hasil character varying(30),
    sebab_kerusakan_id uuid,
    tindakan_perbaikan_id uuid,
    catatan text,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    sebab_kerusakan_keterangan text,
    tindakan_perbaikan_keterangan text,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_tr_pemeliharaan_aset_status_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_pemeliharaan_aset_status_log (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    pemeliharaan_aset_id uuid NOT NULL,
    dari_status character varying(30) NOT NULL,
    ke_status character varying(30) NOT NULL,
    oleh_user_id character varying(64),
    alasan text,
    created_at timestamp(0) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    peringatan text,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_tr_penempatan_aset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_penempatan_aset (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    aset_id uuid NOT NULL,
    receiving_org_unit_id uuid,
    usage_org_unit_id uuid,
    received_by_user_id character varying(64),
    custodian_user_id character varying(64),
    lokasi_aset_id uuid,
    effective_on date NOT NULL,
    reason character varying(250),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    mutasi_aset_id uuid,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_tr_penerimaan_aset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_penerimaan_aset (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    legal_entity_id uuid NOT NULL,
    responsible_org_unit_id uuid NOT NULL,
    receiving_org_unit_id uuid,
    tanggal date NOT NULL,
    tanggal_siap_pakai date,
    diterima_oleh_user_id character varying(64),
    penanggung_jawab_user_id character varying(64),
    lokasi_aset_id uuid,
    currency_code character varying(3) NOT NULL,
    keterangan text,
    status character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    cara_perolehan character varying(20) DEFAULT 'pembelian'::character varying NOT NULL,
    vendor_id uuid,
    vendor_invoice_reference character varying(80),
    vendor_invoice_date date,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    purchase_order_reference character varying(80)
);


--
-- Name: aset_tr_penerimaan_aset_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_penerimaan_aset_details (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    penerimaan_aset_id uuid NOT NULL,
    line_number integer NOT NULL,
    nama character varying(150) NOT NULL,
    group_aset_id uuid NOT NULL,
    jenis_aset_id uuid NOT NULL,
    kondisi_aset_id uuid,
    pabrikan_aset_id uuid,
    model_aset_id uuid,
    model_number character varying(150),
    jumlah integer NOT NULL,
    nilai_per_unit numeric(24,6) NOT NULL,
    residu_per_unit numeric(18,2) DEFAULT '0'::numeric NOT NULL,
    permintaan_pembelian_detail_id uuid,
    atribut json,
    keterangan text,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    ppn_per_unit numeric(24,6) DEFAULT '0'::numeric NOT NULL,
    akumulasi_per_unit numeric(18,2) DEFAULT '0'::numeric NOT NULL,
    periode_berjalan integer DEFAULT 0 NOT NULL,
    saldo_awal_buku json,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_tr_penyesuaian_nilai_aset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_penyesuaian_nilai_aset (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    legal_entity_id uuid NOT NULL,
    responsible_org_unit_id uuid NOT NULL,
    jenis character varying(20) NOT NULL,
    buku_id uuid NOT NULL,
    tanggal date NOT NULL,
    keterangan text NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    diposting_pada timestamp(0) without time zone,
    posting_id character varying(120),
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: aset_tr_penyesuaian_nilai_aset_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_penyesuaian_nilai_aset_details (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    penyesuaian_nilai_aset_id uuid NOT NULL,
    line_number integer NOT NULL,
    aset_id uuid NOT NULL,
    nilai numeric(18,2) NOT NULL,
    keterangan text,
    nilai_buku_sebelum numeric(18,2),
    nilai_buku_sesudah numeric(18,2),
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: aset_tr_penyusutan_aset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_penyusutan_aset (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    buku_aset_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    usage_org_unit_id uuid,
    period_starts_on date NOT NULL,
    period_ends_on date NOT NULL,
    amount numeric(18,2) NOT NULL,
    status character varying(30) DEFAULT 'proposed'::character varying NOT NULL,
    reverses_period_id uuid,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    posted_posting_id character varying(120),
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    cancelled_at timestamp(0) without time zone
);


--
-- Name: aset_tr_perencanaan_aset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_perencanaan_aset (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    legal_entity_id uuid NOT NULL,
    planning_org_unit_id uuid NOT NULL,
    planned_on date NOT NULL,
    planning_year smallint NOT NULL,
    planning_type character varying(30) DEFAULT 'regular'::character varying NOT NULL,
    funding_source character varying(250),
    responsible_user_id character varying(64),
    total_estimated_value numeric(18,2) DEFAULT '0'::numeric NOT NULL,
    status character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    description text,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    unestimated_line_count integer DEFAULT 0 NOT NULL,
    planning_year_id uuid
);


--
-- Name: aset_tr_perencanaan_aset_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_perencanaan_aset_details (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    planning_id uuid NOT NULL,
    line_number integer NOT NULL,
    jenis_aset_id uuid NOT NULL,
    nama_aset character varying(150) NOT NULL,
    unit character varying(30) NOT NULL,
    quantity numeric(18,4) NOT NULL,
    requested_specification text NOT NULL,
    estimated_unit_price numeric(18,2) DEFAULT 0,
    estimated_total_price numeric(18,2) DEFAULT 0,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    satuan_id uuid,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    needed_on date,
    funding_source_id uuid,
    funding_source_name character varying(250),
    deleted_at timestamp(0) without time zone,
    estimate_pending boolean DEFAULT false NOT NULL,
    planned_asset_id uuid,
    planned_asset_code character varying(255)
);


--
-- Name: aset_tr_permintaan_pemeliharaan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_permintaan_pemeliharaan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    legal_entity_id uuid NOT NULL,
    responsible_org_unit_id uuid NOT NULL,
    jenis_permintaan_id uuid NOT NULL,
    aset_id uuid,
    lokasi_aset_id uuid,
    deskripsi text NOT NULL,
    tingkat_layanan_id uuid,
    sebab_kerusakan_id uuid,
    status character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    diajukan_pada timestamp(0) without time zone,
    diputuskan_pada timestamp(0) without time zone,
    diputuskan_oleh_user_id character varying(64),
    alasan_penolakan text,
    pemeliharaan_aset_id uuid,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT aset_tr_permintaan_pml_sasaran CHECK (((aset_id IS NOT NULL) OR (lokasi_aset_id IS NOT NULL)))
);


--
-- Name: aset_tr_permintaan_pengadaan_aset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_permintaan_pengadaan_aset (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    legal_entity_id uuid NOT NULL,
    requesting_org_unit_id uuid NOT NULL,
    requester_user_id character varying(64) NOT NULL,
    requested_on date NOT NULL,
    status character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    workflow_instance_id uuid,
    description text,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint
);


--
-- Name: aset_tr_permintaan_pengadaan_aset_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_permintaan_pengadaan_aset_details (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    request_id uuid NOT NULL,
    line_number integer NOT NULL,
    planning_detail_id uuid,
    jenis_aset_id uuid NOT NULL,
    satuan_id uuid NOT NULL,
    nama_aset character varying(150) NOT NULL,
    quantity numeric(18,4) NOT NULL,
    specification text NOT NULL,
    note text,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: aset_tr_pertanggungan_asuransi; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_pertanggungan_asuransi (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    polis_asuransi_id uuid NOT NULL,
    aset_id uuid NOT NULL,
    nilai_pertanggungan numeric(18,2) NOT NULL,
    berlaku_mulai date NOT NULL,
    berlaku_sampai date,
    keterangan text,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT aset_tr_pertanggungan_nilai CHECK ((nilai_pertanggungan > (0)::numeric)),
    CONSTRAINT aset_tr_pertanggungan_periode CHECK (((berlaku_sampai IS NULL) OR (berlaku_sampai >= berlaku_mulai)))
);


--
-- Name: aset_tr_reklasifikasi_aset; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_reklasifikasi_aset (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creation_key character varying(160) NOT NULL,
    kode character varying(50) NOT NULL,
    legal_entity_id uuid NOT NULL,
    responsible_org_unit_id uuid NOT NULL,
    jenis character varying(20) NOT NULL,
    tanggal date NOT NULL,
    keterangan text NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    diposting_pada timestamp(0) without time zone,
    posting_id character varying(120),
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: aset_tr_reklasifikasi_aset_buku; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_reklasifikasi_aset_buku (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    reklasifikasi_aset_id uuid NOT NULL,
    reklasifikasi_aset_detail_id uuid NOT NULL,
    tanggal date NOT NULL,
    jenis character varying(20) NOT NULL,
    buku_id uuid NOT NULL,
    aset_asal_id uuid NOT NULL,
    buku_aset_asal_id uuid NOT NULL,
    group_aset_asal_id uuid NOT NULL,
    aset_tujuan_id uuid NOT NULL,
    buku_aset_tujuan_id uuid NOT NULL,
    group_aset_tujuan_id uuid NOT NULL,
    nilai_perolehan numeric(18,2) DEFAULT '0'::numeric NOT NULL,
    akumulasi_penyusutan numeric(18,2) DEFAULT '0'::numeric NOT NULL,
    penurunan_nilai numeric(18,2) DEFAULT '0'::numeric NOT NULL,
    kenaikan_nilai numeric(18,2) DEFAULT '0'::numeric NOT NULL,
    nilai_sisa numeric(18,2) DEFAULT '0'::numeric NOT NULL,
    dijurnal boolean DEFAULT false NOT NULL,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: aset_tr_reklasifikasi_aset_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aset_tr_reklasifikasi_aset_details (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    reklasifikasi_aset_id uuid NOT NULL,
    line_number integer NOT NULL,
    aset_id uuid NOT NULL,
    group_aset_tujuan_id uuid,
    persen numeric(9,6),
    nilai_perolehan numeric(18,2),
    nama_aset_baru character varying(255),
    keterangan text,
    group_aset_asal_id uuid,
    aset_baru_id uuid,
    nilai_perolehan_dipindah numeric(18,2),
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: aset_m_alasan_downtime aset_m_alasan_downtime_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_alasan_downtime
    ADD CONSTRAINT aset_m_alasan_downtime_pkey PRIMARY KEY (id);


--
-- Name: aset_m_alasan_downtime aset_m_alasan_downtime_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_alasan_downtime
    ADD CONSTRAINT aset_m_alasan_downtime_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_m_alasan_downtime aset_m_alasan_downtime_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_alasan_downtime
    ADD CONSTRAINT aset_m_alasan_downtime_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_jenis_aset_counter aset_m_jenis_aset_counter_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_jenis_aset_counter
    ADD CONSTRAINT aset_m_jenis_aset_counter_pkey PRIMARY KEY (id);


--
-- Name: aset_m_jenis_aset_counter aset_m_jenis_aset_counter_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_jenis_aset_counter
    ADD CONSTRAINT aset_m_jenis_aset_counter_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_jenis_aset_kondisi aset_m_jenis_aset_kondisi_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_jenis_aset_kondisi
    ADD CONSTRAINT aset_m_jenis_aset_kondisi_pkey PRIMARY KEY (id);


--
-- Name: aset_m_jenis_aset_kondisi aset_m_jenis_aset_kondisi_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_jenis_aset_kondisi
    ADD CONSTRAINT aset_m_jenis_aset_kondisi_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_jenis_asuransi aset_m_jenis_asuransi_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_jenis_asuransi
    ADD CONSTRAINT aset_m_jenis_asuransi_pkey PRIMARY KEY (id);


--
-- Name: aset_m_jenis_asuransi aset_m_jenis_asuransi_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_jenis_asuransi
    ADD CONSTRAINT aset_m_jenis_asuransi_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_m_jenis_asuransi aset_m_jenis_asuransi_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_jenis_asuransi
    ADD CONSTRAINT aset_m_jenis_asuransi_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_jenis_counter aset_m_jenis_counter_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_jenis_counter
    ADD CONSTRAINT aset_m_jenis_counter_pkey PRIMARY KEY (id);


--
-- Name: aset_m_jenis_counter aset_m_jenis_counter_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_jenis_counter
    ADD CONSTRAINT aset_m_jenis_counter_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_m_jenis_counter aset_m_jenis_counter_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_jenis_counter
    ADD CONSTRAINT aset_m_jenis_counter_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_jenis_permintaan_pemeliharaan aset_m_jenis_permintaan_pemeliharaan_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_jenis_permintaan_pemeliharaan
    ADD CONSTRAINT aset_m_jenis_permintaan_pemeliharaan_pkey PRIMARY KEY (id);


--
-- Name: aset_m_jenis_permintaan_pemeliharaan aset_m_jenis_permintaan_pemeliharaan_tenant_id_creation_key_uni; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_jenis_permintaan_pemeliharaan
    ADD CONSTRAINT aset_m_jenis_permintaan_pemeliharaan_tenant_id_creation_key_uni UNIQUE (tenant_id, creation_key);


--
-- Name: aset_m_jenis_permintaan_pemeliharaan aset_m_jenis_permintaan_pemeliharaan_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_jenis_permintaan_pemeliharaan
    ADD CONSTRAINT aset_m_jenis_permintaan_pemeliharaan_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_polis_asuransi aset_m_polis_asuransi_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_polis_asuransi
    ADD CONSTRAINT aset_m_polis_asuransi_pkey PRIMARY KEY (id);


--
-- Name: aset_m_polis_asuransi aset_m_polis_asuransi_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_polis_asuransi
    ADD CONSTRAINT aset_m_polis_asuransi_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_m_polis_asuransi aset_m_polis_asuransi_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_polis_asuransi
    ADD CONSTRAINT aset_m_polis_asuransi_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_posting_group aset_m_posting_group_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_posting_group
    ADD CONSTRAINT aset_m_posting_group_pkey PRIMARY KEY (id);


--
-- Name: aset_m_posting_group aset_m_posting_group_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_posting_group
    ADD CONSTRAINT aset_m_posting_group_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_rencana_pemeliharaan_baris aset_m_rencana_pemeliharaan_baris_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_rencana_pemeliharaan_baris
    ADD CONSTRAINT aset_m_rencana_pemeliharaan_baris_pkey PRIMARY KEY (id);


--
-- Name: aset_m_rencana_pemeliharaan_baris aset_m_rencana_pemeliharaan_baris_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_rencana_pemeliharaan_baris
    ADD CONSTRAINT aset_m_rencana_pemeliharaan_baris_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_rencana_pemeliharaan_objek aset_m_rencana_pemeliharaan_objek_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_rencana_pemeliharaan_objek
    ADD CONSTRAINT aset_m_rencana_pemeliharaan_objek_pkey PRIMARY KEY (id);


--
-- Name: aset_m_rencana_pemeliharaan_objek aset_m_rencana_pemeliharaan_objek_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_rencana_pemeliharaan_objek
    ADD CONSTRAINT aset_m_rencana_pemeliharaan_objek_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_rencana_pemeliharaan aset_m_rencana_pemeliharaan_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_rencana_pemeliharaan
    ADD CONSTRAINT aset_m_rencana_pemeliharaan_pkey PRIMARY KEY (id);


--
-- Name: aset_m_rencana_pemeliharaan aset_m_rencana_pemeliharaan_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_rencana_pemeliharaan
    ADD CONSTRAINT aset_m_rencana_pemeliharaan_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_m_rencana_pemeliharaan aset_m_rencana_pemeliharaan_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_rencana_pemeliharaan
    ADD CONSTRAINT aset_m_rencana_pemeliharaan_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_pengaturan_aset_tetap aset_pengaturan_aset_tetap_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_pengaturan_aset_tetap
    ADD CONSTRAINT aset_pengaturan_aset_tetap_pkey PRIMARY KEY (id);


--
-- Name: aset_pengaturan_aset_tetap aset_pengaturan_aset_tetap_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_pengaturan_aset_tetap
    ADD CONSTRAINT aset_pengaturan_aset_tetap_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_downtime_aset aset_tr_downtime_aset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_downtime_aset
    ADD CONSTRAINT aset_tr_downtime_aset_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_downtime_aset aset_tr_downtime_aset_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_downtime_aset
    ADD CONSTRAINT aset_tr_downtime_aset_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_tr_downtime_aset aset_tr_downtime_aset_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_downtime_aset
    ADD CONSTRAINT aset_tr_downtime_aset_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_garansi_aset aset_tr_garansi_aset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_garansi_aset
    ADD CONSTRAINT aset_tr_garansi_aset_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_garansi_aset aset_tr_garansi_aset_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_garansi_aset
    ADD CONSTRAINT aset_tr_garansi_aset_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_tr_garansi_aset aset_tr_garansi_aset_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_garansi_aset
    ADD CONSTRAINT aset_tr_garansi_aset_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_jadwal_pemeliharaan aset_tr_jadwal_pemeliharaan_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_jadwal_pemeliharaan
    ADD CONSTRAINT aset_tr_jadwal_pemeliharaan_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_jadwal_pemeliharaan aset_tr_jadwal_pemeliharaan_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_jadwal_pemeliharaan
    ADD CONSTRAINT aset_tr_jadwal_pemeliharaan_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_kontrak_servis_aset aset_tr_kontrak_servis_aset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_kontrak_servis_aset
    ADD CONSTRAINT aset_tr_kontrak_servis_aset_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_kontrak_servis_aset aset_tr_kontrak_servis_aset_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_kontrak_servis_aset
    ADD CONSTRAINT aset_tr_kontrak_servis_aset_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_kontrak_servis_aset aset_tr_kontrak_servis_line_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_kontrak_servis_aset
    ADD CONSTRAINT aset_tr_kontrak_servis_line_uq UNIQUE (tenant_id, kontrak_servis_id, line_number);


--
-- Name: aset_tr_kontrak_servis aset_tr_kontrak_servis_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_kontrak_servis
    ADD CONSTRAINT aset_tr_kontrak_servis_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_kontrak_servis aset_tr_kontrak_servis_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_kontrak_servis
    ADD CONSTRAINT aset_tr_kontrak_servis_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_tr_kontrak_servis aset_tr_kontrak_servis_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_kontrak_servis
    ADD CONSTRAINT aset_tr_kontrak_servis_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_ledger_aset aset_tr_ledger_aset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_ledger_aset
    ADD CONSTRAINT aset_tr_ledger_aset_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_monitoring_aset_details aset_tr_monitoring_aset_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_monitoring_aset_details
    ADD CONSTRAINT aset_tr_monitoring_aset_details_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_monitoring_aset_details aset_tr_monitoring_aset_details_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_monitoring_aset_details
    ADD CONSTRAINT aset_tr_monitoring_aset_details_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_monitoring_aset aset_tr_monitoring_aset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_monitoring_aset
    ADD CONSTRAINT aset_tr_monitoring_aset_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_monitoring_aset aset_tr_monitoring_aset_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_monitoring_aset
    ADD CONSTRAINT aset_tr_monitoring_aset_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_tr_monitoring_aset aset_tr_monitoring_aset_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_monitoring_aset
    ADD CONSTRAINT aset_tr_monitoring_aset_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_monitoring_aset_details aset_tr_monitoring_line_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_monitoring_aset_details
    ADD CONSTRAINT aset_tr_monitoring_line_uq UNIQUE (tenant_id, monitoring_aset_id, line_number);


--
-- Name: aset_tr_mutasi_aset_details aset_tr_mutasi_aset_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_mutasi_aset_details
    ADD CONSTRAINT aset_tr_mutasi_aset_details_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_mutasi_aset_details aset_tr_mutasi_aset_details_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_mutasi_aset_details
    ADD CONSTRAINT aset_tr_mutasi_aset_details_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_mutasi_aset aset_tr_mutasi_aset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_mutasi_aset
    ADD CONSTRAINT aset_tr_mutasi_aset_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_mutasi_aset aset_tr_mutasi_aset_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_mutasi_aset
    ADD CONSTRAINT aset_tr_mutasi_aset_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_tr_mutasi_aset aset_tr_mutasi_aset_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_mutasi_aset
    ADD CONSTRAINT aset_tr_mutasi_aset_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_mutasi_aset_details aset_tr_mutasi_line_asset_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_mutasi_aset_details
    ADD CONSTRAINT aset_tr_mutasi_line_asset_uq UNIQUE (tenant_id, mutasi_aset_id, aset_id);


--
-- Name: aset_tr_mutasi_aset_details aset_tr_mutasi_line_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_mutasi_aset_details
    ADD CONSTRAINT aset_tr_mutasi_line_uq UNIQUE (tenant_id, mutasi_aset_id, line_number);


--
-- Name: aset_tr_pembacaan_counter aset_tr_pembacaan_counter_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pembacaan_counter
    ADD CONSTRAINT aset_tr_pembacaan_counter_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_pembacaan_counter aset_tr_pembacaan_counter_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pembacaan_counter
    ADD CONSTRAINT aset_tr_pembacaan_counter_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_tr_pembacaan_counter aset_tr_pembacaan_counter_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pembacaan_counter
    ADD CONSTRAINT aset_tr_pembacaan_counter_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_pembatalan aset_tr_pembatalan_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pembatalan
    ADD CONSTRAINT aset_tr_pembatalan_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_pembatalan aset_tr_pembatalan_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pembatalan
    ADD CONSTRAINT aset_tr_pembatalan_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_penerimaan_aset_details aset_tr_penerimaan_aset_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penerimaan_aset_details
    ADD CONSTRAINT aset_tr_penerimaan_aset_details_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_penerimaan_aset_details aset_tr_penerimaan_aset_details_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penerimaan_aset_details
    ADD CONSTRAINT aset_tr_penerimaan_aset_details_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_penerimaan_aset aset_tr_penerimaan_aset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penerimaan_aset
    ADD CONSTRAINT aset_tr_penerimaan_aset_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_penerimaan_aset aset_tr_penerimaan_aset_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penerimaan_aset
    ADD CONSTRAINT aset_tr_penerimaan_aset_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_tr_penerimaan_aset aset_tr_penerimaan_aset_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penerimaan_aset
    ADD CONSTRAINT aset_tr_penerimaan_aset_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_penerimaan_aset_details aset_tr_penerimaan_line_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penerimaan_aset_details
    ADD CONSTRAINT aset_tr_penerimaan_line_uq UNIQUE (tenant_id, penerimaan_aset_id, line_number);


--
-- Name: aset_tr_penyesuaian_nilai_aset_details aset_tr_penyesuaian_nilai_aset_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penyesuaian_nilai_aset_details
    ADD CONSTRAINT aset_tr_penyesuaian_nilai_aset_details_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_penyesuaian_nilai_aset_details aset_tr_penyesuaian_nilai_aset_details_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penyesuaian_nilai_aset_details
    ADD CONSTRAINT aset_tr_penyesuaian_nilai_aset_details_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_penyesuaian_nilai_aset aset_tr_penyesuaian_nilai_aset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penyesuaian_nilai_aset
    ADD CONSTRAINT aset_tr_penyesuaian_nilai_aset_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_penyesuaian_nilai_aset aset_tr_penyesuaian_nilai_aset_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penyesuaian_nilai_aset
    ADD CONSTRAINT aset_tr_penyesuaian_nilai_aset_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_tr_penyesuaian_nilai_aset aset_tr_penyesuaian_nilai_aset_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penyesuaian_nilai_aset
    ADD CONSTRAINT aset_tr_penyesuaian_nilai_aset_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_penyesuaian_nilai_aset_details aset_tr_penyesuaian_nilai_line_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penyesuaian_nilai_aset_details
    ADD CONSTRAINT aset_tr_penyesuaian_nilai_line_uq UNIQUE (tenant_id, penyesuaian_nilai_aset_id, line_number);


--
-- Name: aset_tr_permintaan_pemeliharaan aset_tr_permintaan_pemeliharaan_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_permintaan_pemeliharaan
    ADD CONSTRAINT aset_tr_permintaan_pemeliharaan_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_permintaan_pemeliharaan aset_tr_permintaan_pemeliharaan_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_permintaan_pemeliharaan
    ADD CONSTRAINT aset_tr_permintaan_pemeliharaan_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_tr_permintaan_pemeliharaan aset_tr_permintaan_pemeliharaan_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_permintaan_pemeliharaan
    ADD CONSTRAINT aset_tr_permintaan_pemeliharaan_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_pertanggungan_asuransi aset_tr_pertanggungan_asuransi_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pertanggungan_asuransi
    ADD CONSTRAINT aset_tr_pertanggungan_asuransi_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_pertanggungan_asuransi aset_tr_pertanggungan_asuransi_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pertanggungan_asuransi
    ADD CONSTRAINT aset_tr_pertanggungan_asuransi_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_tr_pertanggungan_asuransi aset_tr_pertanggungan_asuransi_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pertanggungan_asuransi
    ADD CONSTRAINT aset_tr_pertanggungan_asuransi_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_permintaan_pengadaan_aset_details aset_tr_pp_details_tenant_id_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_permintaan_pengadaan_aset_details
    ADD CONSTRAINT aset_tr_pp_details_tenant_id_uq UNIQUE (tenant_id, id);


--
-- Name: aset_tr_reklasifikasi_aset_buku aset_tr_reklasifikasi_aset_buku_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_reklasifikasi_aset_buku
    ADD CONSTRAINT aset_tr_reklasifikasi_aset_buku_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_reklasifikasi_aset_buku aset_tr_reklasifikasi_aset_buku_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_reklasifikasi_aset_buku
    ADD CONSTRAINT aset_tr_reklasifikasi_aset_buku_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_reklasifikasi_aset_details aset_tr_reklasifikasi_aset_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_reklasifikasi_aset_details
    ADD CONSTRAINT aset_tr_reklasifikasi_aset_details_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_reklasifikasi_aset_details aset_tr_reklasifikasi_aset_details_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_reklasifikasi_aset_details
    ADD CONSTRAINT aset_tr_reklasifikasi_aset_details_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_reklasifikasi_aset aset_tr_reklasifikasi_aset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_reklasifikasi_aset
    ADD CONSTRAINT aset_tr_reklasifikasi_aset_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_reklasifikasi_aset aset_tr_reklasifikasi_aset_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_reklasifikasi_aset
    ADD CONSTRAINT aset_tr_reklasifikasi_aset_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_tr_reklasifikasi_aset aset_tr_reklasifikasi_aset_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_reklasifikasi_aset
    ADD CONSTRAINT aset_tr_reklasifikasi_aset_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_reklasifikasi_aset_buku aset_tr_reklasifikasi_buku_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_reklasifikasi_aset_buku
    ADD CONSTRAINT aset_tr_reklasifikasi_buku_uq UNIQUE (tenant_id, reklasifikasi_aset_detail_id, buku_id);


--
-- Name: aset_tr_reklasifikasi_aset_details aset_tr_reklasifikasi_line_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_reklasifikasi_aset_details
    ADD CONSTRAINT aset_tr_reklasifikasi_line_uq UNIQUE (tenant_id, reklasifikasi_aset_id, line_number);


--
-- Name: aset_m_analisa_maintenance m_analisa_maintenance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_analisa_maintenance
    ADD CONSTRAINT m_analisa_maintenance_pkey PRIMARY KEY (id);


--
-- Name: aset_m_analisa_maintenance m_analisa_maintenance_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_analisa_maintenance
    ADD CONSTRAINT m_analisa_maintenance_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_m_analisa_maintenance m_analisa_maintenance_tenant_id_kode_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_analisa_maintenance
    ADD CONSTRAINT m_analisa_maintenance_tenant_id_kode_unique UNIQUE (tenant_id, kode);


--
-- Name: aset_m_buku_penyusutan m_buku_penyusutan_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_buku_penyusutan
    ADD CONSTRAINT m_buku_penyusutan_pkey PRIMARY KEY (id);


--
-- Name: aset_m_buku_penyusutan m_buku_penyusutan_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_buku_penyusutan
    ADD CONSTRAINT m_buku_penyusutan_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_m_buku_penyusutan m_buku_penyusutan_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_buku_penyusutan
    ADD CONSTRAINT m_buku_penyusutan_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_buku_penyusutan m_buku_penyusutan_tenant_id_kode_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_buku_penyusutan
    ADD CONSTRAINT m_buku_penyusutan_tenant_id_kode_unique UNIQUE (tenant_id, kode);


--
-- Name: aset_m_group_aset m_group_aset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_group_aset
    ADD CONSTRAINT m_group_aset_pkey PRIMARY KEY (id);


--
-- Name: aset_m_group_aset m_group_aset_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_group_aset
    ADD CONSTRAINT m_group_aset_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_m_group_aset m_group_aset_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_group_aset
    ADD CONSTRAINT m_group_aset_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_group_aset m_group_aset_tenant_id_kode_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_group_aset
    ADD CONSTRAINT m_group_aset_tenant_id_kode_unique UNIQUE (tenant_id, kode);


--
-- Name: aset_m_group_buku_penyusutan m_group_buku_penyusutan_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_group_buku_penyusutan
    ADD CONSTRAINT m_group_buku_penyusutan_pkey PRIMARY KEY (id);


--
-- Name: aset_m_group_buku_penyusutan m_group_buku_penyusutan_tenant_id_group_aset_id_buku_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_group_buku_penyusutan
    ADD CONSTRAINT m_group_buku_penyusutan_tenant_id_group_aset_id_buku_id_unique UNIQUE (tenant_id, group_aset_id, buku_id);


--
-- Name: aset_m_group_buku_penyusutan m_group_buku_penyusutan_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_group_buku_penyusutan
    ADD CONSTRAINT m_group_buku_penyusutan_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_item_checklist_maintenance m_item_checklist_maintenance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_item_checklist_maintenance
    ADD CONSTRAINT m_item_checklist_maintenance_pkey PRIMARY KEY (id);


--
-- Name: aset_m_item_checklist_maintenance m_item_checklist_maintenance_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_item_checklist_maintenance
    ADD CONSTRAINT m_item_checklist_maintenance_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_m_item_checklist_maintenance m_item_checklist_maintenance_tenant_id_kode_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_item_checklist_maintenance
    ADD CONSTRAINT m_item_checklist_maintenance_tenant_id_kode_unique UNIQUE (tenant_id, kode);


--
-- Name: aset_m_jenis_aset_atribut m_jenis_aset_atribut_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_jenis_aset_atribut
    ADD CONSTRAINT m_jenis_aset_atribut_pkey PRIMARY KEY (id);


--
-- Name: aset_m_jenis_aset_atribut m_jenis_aset_atribut_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_jenis_aset_atribut
    ADD CONSTRAINT m_jenis_aset_atribut_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_jenis_aset_atribut m_jenis_aset_atribut_tenant_id_jenis_aset_id_tipe_atribut_id_un; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_jenis_aset_atribut
    ADD CONSTRAINT m_jenis_aset_atribut_tenant_id_jenis_aset_id_tipe_atribut_id_un UNIQUE (tenant_id, jenis_aset_id, tipe_atribut_id);


--
-- Name: aset_m_jenis_aset m_jenis_aset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_jenis_aset
    ADD CONSTRAINT m_jenis_aset_pkey PRIMARY KEY (id);


--
-- Name: aset_m_jenis_aset m_jenis_aset_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_jenis_aset
    ADD CONSTRAINT m_jenis_aset_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_m_jenis_aset m_jenis_aset_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_jenis_aset
    ADD CONSTRAINT m_jenis_aset_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_jenis_aset m_jenis_aset_tenant_id_kode_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_jenis_aset
    ADD CONSTRAINT m_jenis_aset_tenant_id_kode_unique UNIQUE (tenant_id, kode);


--
-- Name: aset_m_kelompok_harta_fiskal m_kelompok_harta_fiskal_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_kelompok_harta_fiskal
    ADD CONSTRAINT m_kelompok_harta_fiskal_pkey PRIMARY KEY (id);


--
-- Name: aset_m_kelompok_harta_fiskal m_kelompok_harta_fiskal_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_kelompok_harta_fiskal
    ADD CONSTRAINT m_kelompok_harta_fiskal_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_kelompok_harta_fiskal m_kelompok_harta_fiskal_tenant_id_template_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_kelompok_harta_fiskal
    ADD CONSTRAINT m_kelompok_harta_fiskal_tenant_id_template_key_unique UNIQUE (tenant_id, template_key);


--
-- Name: aset_m_kondisi_aset m_kondisi_aset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_kondisi_aset
    ADD CONSTRAINT m_kondisi_aset_pkey PRIMARY KEY (id);


--
-- Name: aset_m_kondisi_aset m_kondisi_aset_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_kondisi_aset
    ADD CONSTRAINT m_kondisi_aset_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_m_kondisi_aset m_kondisi_aset_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_kondisi_aset
    ADD CONSTRAINT m_kondisi_aset_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_kondisi_aset m_kondisi_aset_tenant_id_kode_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_kondisi_aset
    ADD CONSTRAINT m_kondisi_aset_tenant_id_kode_unique UNIQUE (tenant_id, kode);


--
-- Name: aset_m_lokasi_aset m_lokasi_aset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_lokasi_aset
    ADD CONSTRAINT m_lokasi_aset_pkey PRIMARY KEY (id);


--
-- Name: aset_m_lokasi_aset m_lokasi_aset_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_lokasi_aset
    ADD CONSTRAINT m_lokasi_aset_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_m_lokasi_aset m_lokasi_aset_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_lokasi_aset
    ADD CONSTRAINT m_lokasi_aset_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_maintenance_checklist_template_line m_maintenance_checklist_template_line_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_checklist_template_line
    ADD CONSTRAINT m_maintenance_checklist_template_line_pkey PRIMARY KEY (id);


--
-- Name: aset_m_maintenance_checklist_template m_maintenance_checklist_template_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_checklist_template
    ADD CONSTRAINT m_maintenance_checklist_template_pkey PRIMARY KEY (id);


--
-- Name: aset_m_maintenance_checklist_variable m_maintenance_checklist_variable_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_checklist_variable
    ADD CONSTRAINT m_maintenance_checklist_variable_pkey PRIMARY KEY (id);


--
-- Name: aset_m_maintenance_checklist_variable_value m_maintenance_checklist_variable_value_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_checklist_variable_value
    ADD CONSTRAINT m_maintenance_checklist_variable_value_pkey PRIMARY KEY (id);


--
-- Name: aset_m_maintenance_job_type_jenis_aset m_maintenance_job_type_asset_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_job_type_jenis_aset
    ADD CONSTRAINT m_maintenance_job_type_asset_type_pkey PRIMARY KEY (tenant_id, job_type_id, jenis_aset_id);


--
-- Name: aset_m_maintenance_job_type_default m_maintenance_job_type_default_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_job_type_default
    ADD CONSTRAINT m_maintenance_job_type_default_pkey PRIMARY KEY (id);


--
-- Name: aset_m_maintenance_job_type m_maintenance_job_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_job_type
    ADD CONSTRAINT m_maintenance_job_type_pkey PRIMARY KEY (id);


--
-- Name: aset_m_maintenance_job_type_variant m_maintenance_job_type_variant_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_job_type_variant
    ADD CONSTRAINT m_maintenance_job_type_variant_pkey PRIMARY KEY (id);


--
-- Name: aset_m_maintenance_job_type_default m_mnt_default_code_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_job_type_default
    ADD CONSTRAINT m_mnt_default_code_uq UNIQUE (tenant_id, kode);


--
-- Name: aset_m_maintenance_job_type_default m_mnt_default_creation_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_job_type_default
    ADD CONSTRAINT m_mnt_default_creation_uq UNIQUE (tenant_id, creation_key);


--
-- Name: aset_m_maintenance_job_type_default m_mnt_default_tenant_id_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_job_type_default
    ADD CONSTRAINT m_mnt_default_tenant_id_uq UNIQUE (tenant_id, id);


--
-- Name: aset_m_maintenance_job_type m_mnt_job_type_code_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_job_type
    ADD CONSTRAINT m_mnt_job_type_code_uq UNIQUE (tenant_id, kode);


--
-- Name: aset_m_maintenance_job_type m_mnt_job_type_creation_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_job_type
    ADD CONSTRAINT m_mnt_job_type_creation_uq UNIQUE (tenant_id, creation_key);


--
-- Name: aset_m_maintenance_job_type m_mnt_job_type_tenant_id_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_job_type
    ADD CONSTRAINT m_mnt_job_type_tenant_id_uq UNIQUE (tenant_id, id);


--
-- Name: aset_m_maintenance_job_type_variant m_mnt_job_variant_code_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_job_type_variant
    ADD CONSTRAINT m_mnt_job_variant_code_uq UNIQUE (tenant_id, kode);


--
-- Name: aset_m_maintenance_job_type_variant m_mnt_job_variant_creation_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_job_type_variant
    ADD CONSTRAINT m_mnt_job_variant_creation_uq UNIQUE (tenant_id, creation_key);


--
-- Name: aset_m_maintenance_job_type_variant m_mnt_job_variant_tenant_id_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_job_type_variant
    ADD CONSTRAINT m_mnt_job_variant_tenant_id_uq UNIQUE (tenant_id, id);


--
-- Name: aset_m_maintenance_checklist_template m_mnt_template_code_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_checklist_template
    ADD CONSTRAINT m_mnt_template_code_uq UNIQUE (tenant_id, kode);


--
-- Name: aset_m_maintenance_checklist_template m_mnt_template_creation_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_checklist_template
    ADD CONSTRAINT m_mnt_template_creation_uq UNIQUE (tenant_id, creation_key);


--
-- Name: aset_m_maintenance_checklist_template m_mnt_template_tenant_id_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_checklist_template
    ADD CONSTRAINT m_mnt_template_tenant_id_uq UNIQUE (tenant_id, id);


--
-- Name: aset_m_maintenance_checklist_variable m_mnt_variable_code_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_checklist_variable
    ADD CONSTRAINT m_mnt_variable_code_uq UNIQUE (tenant_id, kode);


--
-- Name: aset_m_maintenance_checklist_variable m_mnt_variable_creation_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_checklist_variable
    ADD CONSTRAINT m_mnt_variable_creation_uq UNIQUE (tenant_id, creation_key);


--
-- Name: aset_m_maintenance_checklist_variable m_mnt_variable_tenant_id_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_checklist_variable
    ADD CONSTRAINT m_mnt_variable_tenant_id_uq UNIQUE (tenant_id, id);


--
-- Name: aset_m_model_aset m_model_aset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_model_aset
    ADD CONSTRAINT m_model_aset_pkey PRIMARY KEY (id);


--
-- Name: aset_m_model_aset m_model_aset_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_model_aset
    ADD CONSTRAINT m_model_aset_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_m_model_aset m_model_aset_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_model_aset
    ADD CONSTRAINT m_model_aset_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_model_aset m_model_aset_tenant_id_kode_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_model_aset
    ADD CONSTRAINT m_model_aset_tenant_id_kode_unique UNIQUE (tenant_id, kode);


--
-- Name: aset_m_pabrikan_aset m_pabrikan_aset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_pabrikan_aset
    ADD CONSTRAINT m_pabrikan_aset_pkey PRIMARY KEY (id);


--
-- Name: aset_m_pabrikan_aset m_pabrikan_aset_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_pabrikan_aset
    ADD CONSTRAINT m_pabrikan_aset_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_m_pabrikan_aset m_pabrikan_aset_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_pabrikan_aset
    ADD CONSTRAINT m_pabrikan_aset_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_pabrikan_aset m_pabrikan_aset_tenant_id_kode_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_pabrikan_aset
    ADD CONSTRAINT m_pabrikan_aset_tenant_id_kode_unique UNIQUE (tenant_id, kode);


--
-- Name: aset_m_profil_penyusutan m_profil_penyusutan_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_profil_penyusutan
    ADD CONSTRAINT m_profil_penyusutan_pkey PRIMARY KEY (id);


--
-- Name: aset_m_profil_penyusutan m_profil_penyusutan_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_profil_penyusutan
    ADD CONSTRAINT m_profil_penyusutan_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_m_profil_penyusutan m_profil_penyusutan_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_profil_penyusutan
    ADD CONSTRAINT m_profil_penyusutan_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_profil_penyusutan m_profil_penyusutan_tenant_id_kode_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_profil_penyusutan
    ADD CONSTRAINT m_profil_penyusutan_tenant_id_kode_unique UNIQUE (tenant_id, kode);


--
-- Name: aset_m_sebab_kerusakan m_sebab_kerusakan_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_sebab_kerusakan
    ADD CONSTRAINT m_sebab_kerusakan_pkey PRIMARY KEY (id);


--
-- Name: aset_m_sebab_kerusakan m_sebab_kerusakan_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_sebab_kerusakan
    ADD CONSTRAINT m_sebab_kerusakan_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_m_sebab_kerusakan m_sebab_kerusakan_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_sebab_kerusakan
    ADD CONSTRAINT m_sebab_kerusakan_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_sebab_kerusakan m_sebab_kerusakan_tenant_id_kode_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_sebab_kerusakan
    ADD CONSTRAINT m_sebab_kerusakan_tenant_id_kode_unique UNIQUE (tenant_id, kode);


--
-- Name: aset_m_tindakan_perbaikan m_tindakan_perbaikan_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_tindakan_perbaikan
    ADD CONSTRAINT m_tindakan_perbaikan_pkey PRIMARY KEY (id);


--
-- Name: aset_m_tindakan_perbaikan m_tindakan_perbaikan_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_tindakan_perbaikan
    ADD CONSTRAINT m_tindakan_perbaikan_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_m_tindakan_perbaikan m_tindakan_perbaikan_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_tindakan_perbaikan
    ADD CONSTRAINT m_tindakan_perbaikan_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_tindakan_perbaikan m_tindakan_perbaikan_tenant_id_kode_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_tindakan_perbaikan
    ADD CONSTRAINT m_tindakan_perbaikan_tenant_id_kode_unique UNIQUE (tenant_id, kode);


--
-- Name: aset_m_tingkat_layanan m_tingkat_layanan_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_tingkat_layanan
    ADD CONSTRAINT m_tingkat_layanan_pkey PRIMARY KEY (id);


--
-- Name: aset_m_tingkat_layanan m_tingkat_layanan_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_tingkat_layanan
    ADD CONSTRAINT m_tingkat_layanan_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_m_tingkat_layanan m_tingkat_layanan_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_tingkat_layanan
    ADD CONSTRAINT m_tingkat_layanan_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_tingkat_layanan m_tingkat_layanan_tenant_id_kode_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_tingkat_layanan
    ADD CONSTRAINT m_tingkat_layanan_tenant_id_kode_unique UNIQUE (tenant_id, kode);


--
-- Name: aset_m_tipe_atribut_nilai m_tipe_atribut_nilai_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_tipe_atribut_nilai
    ADD CONSTRAINT m_tipe_atribut_nilai_pkey PRIMARY KEY (id);


--
-- Name: aset_m_tipe_atribut_nilai m_tipe_atribut_nilai_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_tipe_atribut_nilai
    ADD CONSTRAINT m_tipe_atribut_nilai_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_tipe_atribut_nilai m_tipe_atribut_nilai_tenant_id_tipe_atribut_id_nilai_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_tipe_atribut_nilai
    ADD CONSTRAINT m_tipe_atribut_nilai_tenant_id_tipe_atribut_id_nilai_unique UNIQUE (tenant_id, tipe_atribut_id, nilai);


--
-- Name: aset_m_tipe_atribut m_tipe_atribut_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_tipe_atribut
    ADD CONSTRAINT m_tipe_atribut_pkey PRIMARY KEY (id);


--
-- Name: aset_m_tipe_atribut m_tipe_atribut_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_tipe_atribut
    ADD CONSTRAINT m_tipe_atribut_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_m_tipe_atribut m_tipe_atribut_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_tipe_atribut
    ADD CONSTRAINT m_tipe_atribut_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_tipe_atribut m_tipe_atribut_tenant_id_kode_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_tipe_atribut
    ADD CONSTRAINT m_tipe_atribut_tenant_id_kode_unique UNIQUE (tenant_id, kode);


--
-- Name: aset_m_tipe_lokasi_aset m_tipe_lokasi_aset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_tipe_lokasi_aset
    ADD CONSTRAINT m_tipe_lokasi_aset_pkey PRIMARY KEY (id);


--
-- Name: aset_m_tipe_lokasi_aset m_tipe_lokasi_aset_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_tipe_lokasi_aset
    ADD CONSTRAINT m_tipe_lokasi_aset_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_m_tipe_lokasi_aset m_tipe_lokasi_aset_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_tipe_lokasi_aset
    ADD CONSTRAINT m_tipe_lokasi_aset_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_tipe_lokasi_aset m_tipe_lokasi_aset_tenant_id_kode_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_tipe_lokasi_aset
    ADD CONSTRAINT m_tipe_lokasi_aset_tenant_id_kode_unique UNIQUE (tenant_id, kode);


--
-- Name: aset_m_tipe_work_order m_tipe_work_order_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_tipe_work_order
    ADD CONSTRAINT m_tipe_work_order_pkey PRIMARY KEY (id);


--
-- Name: aset_m_tipe_work_order m_tipe_work_order_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_tipe_work_order
    ADD CONSTRAINT m_tipe_work_order_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_m_tipe_work_order m_tipe_work_order_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_tipe_work_order
    ADD CONSTRAINT m_tipe_work_order_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_tipe_work_order m_tipe_work_order_tenant_id_kode_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_tipe_work_order
    ADD CONSTRAINT m_tipe_work_order_tenant_id_kode_unique UNIQUE (tenant_id, kode);


--
-- Name: aset_m_trade m_trade_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_trade
    ADD CONSTRAINT m_trade_pkey PRIMARY KEY (id);


--
-- Name: aset_m_trade m_trade_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_trade
    ADD CONSTRAINT m_trade_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_m_trade m_trade_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_trade
    ADD CONSTRAINT m_trade_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_m_trade m_trade_tenant_id_kode_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_trade
    ADD CONSTRAINT m_trade_tenant_id_kode_unique UNIQUE (tenant_id, kode);


--
-- Name: aset_m_validasi_status_work_order m_validasi_status_work_order_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_validasi_status_work_order
    ADD CONSTRAINT m_validasi_status_work_order_pkey PRIMARY KEY (id);


--
-- Name: aset_m_validasi_status_work_order m_wo_validasi_identity_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_validasi_status_work_order
    ADD CONSTRAINT m_wo_validasi_identity_uq UNIQUE (tenant_id, status, aturan);


--
-- Name: aset_processed_core_events processed_core_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_processed_core_events
    ADD CONSTRAINT processed_core_events_pkey PRIMARY KEY (id);


--
-- Name: aset_processed_core_events processed_core_events_tenant_id_event_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_processed_core_events
    ADD CONSTRAINT processed_core_events_tenant_id_event_id_unique UNIQUE (tenant_id, event_id);


--
-- Name: aset_tr_penempatan_aset t_aset_penempatan_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penempatan_aset
    ADD CONSTRAINT t_aset_penempatan_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_penempatan_aset t_aset_penempatan_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penempatan_aset
    ADD CONSTRAINT t_aset_penempatan_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_aset t_aset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_aset
    ADD CONSTRAINT t_aset_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_aset t_aset_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_aset
    ADD CONSTRAINT t_aset_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_tr_aset t_aset_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_aset
    ADD CONSTRAINT t_aset_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_buku_aset t_buku_aset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_buku_aset
    ADD CONSTRAINT t_buku_aset_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_buku_aset t_buku_aset_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_buku_aset
    ADD CONSTRAINT t_buku_aset_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_dokumen_siklus_aset t_dokumen_siklus_aset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_dokumen_siklus_aset
    ADD CONSTRAINT t_dokumen_siklus_aset_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_dokumen_siklus_aset t_dokumen_siklus_aset_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_dokumen_siklus_aset
    ADD CONSTRAINT t_dokumen_siklus_aset_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_tr_export_penyusutan t_export_penyusutan_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_export_penyusutan
    ADD CONSTRAINT t_export_penyusutan_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_export_penyusutan t_export_penyusutan_tenant_id_depreciation_period_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_export_penyusutan
    ADD CONSTRAINT t_export_penyusutan_tenant_id_depreciation_period_id_unique UNIQUE (tenant_id, depreciation_period_id);


--
-- Name: aset_tr_export_penyusutan t_export_penyusutan_tenant_id_posting_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_export_penyusutan
    ADD CONSTRAINT t_export_penyusutan_tenant_id_posting_id_unique UNIQUE (tenant_id, posting_id);


--
-- Name: aset_tr_penyusutan_aset t_penyusutan_periode_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penyusutan_aset
    ADD CONSTRAINT t_penyusutan_periode_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_penyusutan_aset t_penyusutan_periode_tenant_id_asset_book_id_period_ends_on_rev; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penyusutan_aset
    ADD CONSTRAINT t_penyusutan_periode_tenant_id_asset_book_id_period_ends_on_rev UNIQUE (tenant_id, buku_aset_id, period_ends_on, reverses_period_id);


--
-- Name: aset_tr_penyusutan_aset t_penyusutan_periode_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penyusutan_aset
    ADD CONSTRAINT t_penyusutan_periode_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_aset_atribut tr_aset_atribut_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_aset_atribut
    ADD CONSTRAINT tr_aset_atribut_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_aset_atribut tr_aset_atribut_tenant_id_asset_id_tipe_atribut_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_aset_atribut
    ADD CONSTRAINT tr_aset_atribut_tenant_id_asset_id_tipe_atribut_id_unique UNIQUE (tenant_id, aset_id, tipe_atribut_id);


--
-- Name: aset_tr_aset_atribut tr_aset_atribut_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_aset_atribut
    ADD CONSTRAINT tr_aset_atribut_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_buku_aset tr_buku_aset_tenant_id_asset_id_buku_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_buku_aset
    ADD CONSTRAINT tr_buku_aset_tenant_id_asset_id_buku_id_unique UNIQUE (tenant_id, aset_id, buku_id);


--
-- Name: aset_tr_dokumen_siklus_aset tr_dokumen_siklus_aset_tenant_id_workflow_instance_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_dokumen_siklus_aset
    ADD CONSTRAINT tr_dokumen_siklus_aset_tenant_id_workflow_instance_id_unique UNIQUE (tenant_id, workflow_instance_id);


--
-- Name: aset_tr_pemeliharaan_aset_checklist tr_pemeliharaan_aset_checklist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pemeliharaan_aset_checklist
    ADD CONSTRAINT tr_pemeliharaan_aset_checklist_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_pemeliharaan_aset_checklist tr_pemeliharaan_aset_checklist_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pemeliharaan_aset_checklist
    ADD CONSTRAINT tr_pemeliharaan_aset_checklist_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_pemeliharaan_aset_details tr_pemeliharaan_aset_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pemeliharaan_aset_details
    ADD CONSTRAINT tr_pemeliharaan_aset_details_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_pemeliharaan_aset_details tr_pemeliharaan_aset_details_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pemeliharaan_aset_details
    ADD CONSTRAINT tr_pemeliharaan_aset_details_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_pemeliharaan_aset tr_pemeliharaan_aset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pemeliharaan_aset
    ADD CONSTRAINT tr_pemeliharaan_aset_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_pemeliharaan_aset_status_log tr_pemeliharaan_aset_status_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pemeliharaan_aset_status_log
    ADD CONSTRAINT tr_pemeliharaan_aset_status_log_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_pemeliharaan_aset tr_pemeliharaan_aset_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pemeliharaan_aset
    ADD CONSTRAINT tr_pemeliharaan_aset_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_tr_pemeliharaan_aset tr_pemeliharaan_aset_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pemeliharaan_aset
    ADD CONSTRAINT tr_pemeliharaan_aset_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_perencanaan_aset_details tr_perencanaan_aset_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_perencanaan_aset_details
    ADD CONSTRAINT tr_perencanaan_aset_details_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_perencanaan_aset_details tr_perencanaan_aset_details_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_perencanaan_aset_details
    ADD CONSTRAINT tr_perencanaan_aset_details_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_perencanaan_aset_details tr_perencanaan_aset_details_tenant_id_planning_id_line_number_u; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_perencanaan_aset_details
    ADD CONSTRAINT tr_perencanaan_aset_details_tenant_id_planning_id_line_number_u UNIQUE (tenant_id, planning_id, line_number);


--
-- Name: aset_tr_perencanaan_aset tr_perencanaan_aset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_perencanaan_aset
    ADD CONSTRAINT tr_perencanaan_aset_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_perencanaan_aset tr_perencanaan_aset_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_perencanaan_aset
    ADD CONSTRAINT tr_perencanaan_aset_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_tr_perencanaan_aset tr_perencanaan_aset_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_perencanaan_aset
    ADD CONSTRAINT tr_perencanaan_aset_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_permintaan_pengadaan_aset_details tr_permintaan_pengadaan_aset_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_permintaan_pengadaan_aset_details
    ADD CONSTRAINT tr_permintaan_pengadaan_aset_details_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_permintaan_pengadaan_aset_details tr_permintaan_pengadaan_aset_details_tenant_id_request_id_line_; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_permintaan_pengadaan_aset_details
    ADD CONSTRAINT tr_permintaan_pengadaan_aset_details_tenant_id_request_id_line_ UNIQUE (tenant_id, request_id, line_number);


--
-- Name: aset_tr_permintaan_pengadaan_aset tr_permintaan_pengadaan_aset_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_permintaan_pengadaan_aset
    ADD CONSTRAINT tr_permintaan_pengadaan_aset_pkey PRIMARY KEY (id);


--
-- Name: aset_tr_permintaan_pengadaan_aset tr_permintaan_pengadaan_aset_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_permintaan_pengadaan_aset
    ADD CONSTRAINT tr_permintaan_pengadaan_aset_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: aset_tr_permintaan_pengadaan_aset tr_permintaan_pengadaan_aset_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_permintaan_pengadaan_aset
    ADD CONSTRAINT tr_permintaan_pengadaan_aset_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: aset_tr_permintaan_pengadaan_aset tr_permintaan_pengadaan_aset_tenant_id_workflow_instance_id_uni; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_permintaan_pengadaan_aset
    ADD CONSTRAINT tr_permintaan_pengadaan_aset_tenant_id_workflow_instance_id_uni UNIQUE (tenant_id, workflow_instance_id);


--
-- Name: aset_tr_pemeliharaan_aset_checklist tr_wo_check_line_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pemeliharaan_aset_checklist
    ADD CONSTRAINT tr_wo_check_line_uq UNIQUE (tenant_id, pemeliharaan_aset_detail_id, line_number);


--
-- Name: aset_tr_pemeliharaan_aset_details tr_wo_job_line_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pemeliharaan_aset_details
    ADD CONSTRAINT tr_wo_job_line_uq UNIQUE (tenant_id, pemeliharaan_aset_id, line_number);


--
-- Name: aset_ledger_book_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_ledger_book_idx ON public.aset_tr_ledger_aset USING btree (tenant_id, aset_id, buku_aset_id);


--
-- Name: aset_ledger_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_ledger_date_idx ON public.aset_tr_ledger_aset USING btree (tenant_id, posting_date);


--
-- Name: aset_m_alasan_downtime_kode_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_m_alasan_downtime_kode_unique ON public.aset_m_alasan_downtime USING btree (tenant_id, kode) WHERE (deleted_at IS NULL);


--
-- Name: aset_m_alasan_downtime_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_m_alasan_downtime_tenant_id_index ON public.aset_m_alasan_downtime USING btree (tenant_id);


--
-- Name: aset_m_jenis_aset_counter_counter_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_m_jenis_aset_counter_counter_ix ON public.aset_m_jenis_aset_counter USING btree (tenant_id, jenis_counter_id);


--
-- Name: aset_m_jenis_aset_counter_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_m_jenis_aset_counter_tenant_id_index ON public.aset_m_jenis_aset_counter USING btree (tenant_id);


--
-- Name: aset_m_jenis_aset_counter_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_m_jenis_aset_counter_unique ON public.aset_m_jenis_aset_counter USING btree (tenant_id, jenis_aset_id, jenis_counter_id) WHERE (deleted_at IS NULL);


--
-- Name: aset_m_jenis_aset_kondisi_condition_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_m_jenis_aset_kondisi_condition_ix ON public.aset_m_jenis_aset_kondisi USING btree (tenant_id, kondisi_aset_id);


--
-- Name: aset_m_jenis_aset_kondisi_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_m_jenis_aset_kondisi_tenant_id_index ON public.aset_m_jenis_aset_kondisi USING btree (tenant_id);


--
-- Name: aset_m_jenis_aset_kondisi_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_m_jenis_aset_kondisi_unique ON public.aset_m_jenis_aset_kondisi USING btree (tenant_id, jenis_aset_id, kondisi_aset_id) WHERE (deleted_at IS NULL);


--
-- Name: aset_m_jenis_asuransi_kode_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_m_jenis_asuransi_kode_unique ON public.aset_m_jenis_asuransi USING btree (tenant_id, kode) WHERE (deleted_at IS NULL);


--
-- Name: aset_m_jenis_asuransi_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_m_jenis_asuransi_tenant_id_index ON public.aset_m_jenis_asuransi USING btree (tenant_id);


--
-- Name: aset_m_jenis_counter_kode_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_m_jenis_counter_kode_unique ON public.aset_m_jenis_counter USING btree (tenant_id, kode) WHERE (deleted_at IS NULL);


--
-- Name: aset_m_jenis_counter_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_m_jenis_counter_tenant_id_index ON public.aset_m_jenis_counter USING btree (tenant_id);


--
-- Name: aset_m_jenis_permintaan_kode_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_m_jenis_permintaan_kode_unique ON public.aset_m_jenis_permintaan_pemeliharaan USING btree (tenant_id, kode) WHERE (deleted_at IS NULL);


--
-- Name: aset_m_jenis_permintaan_pemeliharaan_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_m_jenis_permintaan_pemeliharaan_tenant_id_index ON public.aset_m_jenis_permintaan_pemeliharaan USING btree (tenant_id);


--
-- Name: aset_m_polis_asuransi_kode_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_m_polis_asuransi_kode_unique ON public.aset_m_polis_asuransi USING btree (tenant_id, legal_entity_id, kode) WHERE (deleted_at IS NULL);


--
-- Name: aset_m_polis_asuransi_legal_entity_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_m_polis_asuransi_legal_entity_id_index ON public.aset_m_polis_asuransi USING btree (legal_entity_id);


--
-- Name: aset_m_polis_asuransi_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_m_polis_asuransi_tenant_id_index ON public.aset_m_polis_asuransi USING btree (tenant_id);


--
-- Name: aset_m_posting_group_berlaku_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_m_posting_group_berlaku_unique ON public.aset_m_posting_group USING btree (tenant_id, group_aset_id, effective_from) WHERE (deleted_at IS NULL);


--
-- Name: aset_m_posting_group_tenant_id_group_aset_id_effective_from_ind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_m_posting_group_tenant_id_group_aset_id_effective_from_ind ON public.aset_m_posting_group USING btree (tenant_id, group_aset_id, effective_from);


--
-- Name: aset_m_posting_group_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_m_posting_group_tenant_id_index ON public.aset_m_posting_group USING btree (tenant_id);


--
-- Name: aset_m_rencana_baris_line_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_m_rencana_baris_line_unique ON public.aset_m_rencana_pemeliharaan_baris USING btree (tenant_id, rencana_pemeliharaan_id, line_number) WHERE (deleted_at IS NULL);


--
-- Name: aset_m_rencana_objek_aset_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_m_rencana_objek_aset_unique ON public.aset_m_rencana_pemeliharaan_objek USING btree (tenant_id, rencana_pemeliharaan_id, aset_id) WHERE ((aset_id IS NOT NULL) AND (deleted_at IS NULL));


--
-- Name: aset_m_rencana_objek_jenis_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_m_rencana_objek_jenis_unique ON public.aset_m_rencana_pemeliharaan_objek USING btree (tenant_id, rencana_pemeliharaan_id, jenis_aset_id) WHERE ((jenis_aset_id IS NOT NULL) AND (deleted_at IS NULL));


--
-- Name: aset_m_rencana_pemeliharaan_baris_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_m_rencana_pemeliharaan_baris_tenant_id_index ON public.aset_m_rencana_pemeliharaan_baris USING btree (tenant_id);


--
-- Name: aset_m_rencana_pemeliharaan_kode_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_m_rencana_pemeliharaan_kode_unique ON public.aset_m_rencana_pemeliharaan USING btree (tenant_id, kode) WHERE (deleted_at IS NULL);


--
-- Name: aset_m_rencana_pemeliharaan_objek_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_m_rencana_pemeliharaan_objek_tenant_id_index ON public.aset_m_rencana_pemeliharaan_objek USING btree (tenant_id);


--
-- Name: aset_m_rencana_pemeliharaan_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_m_rencana_pemeliharaan_tenant_id_index ON public.aset_m_rencana_pemeliharaan USING btree (tenant_id);


--
-- Name: aset_pembatalan_pending_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_pembatalan_pending_uq ON public.aset_tr_pembatalan USING btree (tenant_id, resource, document_id) WHERE (((status)::text = 'pending'::text) AND (deleted_at IS NULL));


--
-- Name: aset_pengaturan_aset_tetap_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_pengaturan_aset_tetap_tenant_id_index ON public.aset_pengaturan_aset_tetap USING btree (tenant_id);


--
-- Name: aset_pengaturan_aset_tetap_tenant_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_pengaturan_aset_tetap_tenant_unique ON public.aset_pengaturan_aset_tetap USING btree (tenant_id) WHERE (deleted_at IS NULL);


--
-- Name: aset_tr_aset_kode_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_tr_aset_kode_unique ON public.aset_tr_aset USING btree (tenant_id, legal_entity_id, kode) WHERE (deleted_at IS NULL);


--
-- Name: aset_tr_aset_penerimaan_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_aset_penerimaan_ix ON public.aset_tr_aset USING btree (tenant_id, penerimaan_aset_id);


--
-- Name: aset_tr_aset_penerimaan_line_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_aset_penerimaan_line_ix ON public.aset_tr_aset USING btree (tenant_id, penerimaan_aset_detail_id);


--
-- Name: aset_tr_downtime_aset_mulai_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_downtime_aset_mulai_ix ON public.aset_tr_downtime_aset USING btree (tenant_id, aset_id, mulai);


--
-- Name: aset_tr_downtime_aset_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_downtime_aset_tenant_id_index ON public.aset_tr_downtime_aset USING btree (tenant_id);


--
-- Name: aset_tr_downtime_terbuka_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_tr_downtime_terbuka_unique ON public.aset_tr_downtime_aset USING btree (tenant_id, aset_id) WHERE ((deleted_at IS NULL) AND (selesai IS NULL));


--
-- Name: aset_tr_downtime_wo_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_downtime_wo_ix ON public.aset_tr_downtime_aset USING btree (tenant_id, pemeliharaan_aset_id);


--
-- Name: aset_tr_garansi_aset_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_garansi_aset_ix ON public.aset_tr_garansi_aset USING btree (tenant_id, aset_id);


--
-- Name: aset_tr_garansi_aset_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_garansi_aset_tenant_id_index ON public.aset_tr_garansi_aset USING btree (tenant_id);


--
-- Name: aset_tr_garansi_berakhir_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_garansi_berakhir_ix ON public.aset_tr_garansi_aset USING btree (tenant_id, berlaku_sampai);


--
-- Name: aset_tr_jadwal_counter_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_tr_jadwal_counter_unique ON public.aset_tr_jadwal_pemeliharaan USING btree (tenant_id, rencana_baris_id, aset_id, nilai_jatuh_tempo) WHERE ((nilai_jatuh_tempo IS NOT NULL) AND (deleted_at IS NULL));


--
-- Name: aset_tr_jadwal_pemeliharaan_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_jadwal_pemeliharaan_tenant_id_index ON public.aset_tr_jadwal_pemeliharaan USING btree (tenant_id);


--
-- Name: aset_tr_jadwal_scope_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_jadwal_scope_ix ON public.aset_tr_jadwal_pemeliharaan USING btree (tenant_id, legal_entity_id, responsible_org_unit_id, status);


--
-- Name: aset_tr_jadwal_tempo_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_jadwal_tempo_ix ON public.aset_tr_jadwal_pemeliharaan USING btree (tenant_id, status, jatuh_tempo);


--
-- Name: aset_tr_jadwal_waktu_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_tr_jadwal_waktu_unique ON public.aset_tr_jadwal_pemeliharaan USING btree (tenant_id, rencana_baris_id, aset_id, jatuh_tempo) WHERE ((nilai_jatuh_tempo IS NULL) AND (deleted_at IS NULL));


--
-- Name: aset_tr_kontrak_servis_aset_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_kontrak_servis_aset_tenant_id_index ON public.aset_tr_kontrak_servis_aset USING btree (tenant_id);


--
-- Name: aset_tr_kontrak_servis_berakhir_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_kontrak_servis_berakhir_ix ON public.aset_tr_kontrak_servis USING btree (tenant_id, berlaku_sampai);


--
-- Name: aset_tr_kontrak_servis_kode_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_tr_kontrak_servis_kode_unique ON public.aset_tr_kontrak_servis USING btree (tenant_id, legal_entity_id, kode) WHERE (deleted_at IS NULL);


--
-- Name: aset_tr_kontrak_servis_legal_entity_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_kontrak_servis_legal_entity_id_index ON public.aset_tr_kontrak_servis USING btree (legal_entity_id);


--
-- Name: aset_tr_kontrak_servis_line_aset_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_kontrak_servis_line_aset_ix ON public.aset_tr_kontrak_servis_aset USING btree (tenant_id, aset_id);


--
-- Name: aset_tr_kontrak_servis_line_aset_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_tr_kontrak_servis_line_aset_unique ON public.aset_tr_kontrak_servis_aset USING btree (tenant_id, kontrak_servis_id, aset_id) WHERE (deleted_at IS NULL);


--
-- Name: aset_tr_kontrak_servis_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_kontrak_servis_tenant_id_index ON public.aset_tr_kontrak_servis USING btree (tenant_id);


--
-- Name: aset_tr_monitoring_aset_details_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_monitoring_aset_details_tenant_id_index ON public.aset_tr_monitoring_aset_details USING btree (tenant_id);


--
-- Name: aset_tr_monitoring_aset_legal_entity_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_monitoring_aset_legal_entity_id_index ON public.aset_tr_monitoring_aset USING btree (legal_entity_id);


--
-- Name: aset_tr_monitoring_aset_responsible_org_unit_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_monitoring_aset_responsible_org_unit_id_index ON public.aset_tr_monitoring_aset USING btree (responsible_org_unit_id);


--
-- Name: aset_tr_monitoring_aset_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_monitoring_aset_tenant_id_index ON public.aset_tr_monitoring_aset USING btree (tenant_id);


--
-- Name: aset_tr_monitoring_kode_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_tr_monitoring_kode_unique ON public.aset_tr_monitoring_aset USING btree (tenant_id, legal_entity_id, kode) WHERE (deleted_at IS NULL);


--
-- Name: aset_tr_monitoring_laporan_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_monitoring_laporan_ix ON public.aset_tr_monitoring_aset USING btree (tenant_id, status, tanggal);


--
-- Name: aset_tr_monitoring_line_aset_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_monitoring_line_aset_ix ON public.aset_tr_monitoring_aset_details USING btree (tenant_id, aset_id);


--
-- Name: aset_tr_monitoring_line_aset_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_tr_monitoring_line_aset_unique ON public.aset_tr_monitoring_aset_details USING btree (tenant_id, monitoring_aset_id, aset_id) WHERE (deleted_at IS NULL);


--
-- Name: aset_tr_monitoring_scope_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_monitoring_scope_ix ON public.aset_tr_monitoring_aset USING btree (tenant_id, legal_entity_id, responsible_org_unit_id, status);


--
-- Name: aset_tr_mutasi_aset_details_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_mutasi_aset_details_tenant_id_index ON public.aset_tr_mutasi_aset_details USING btree (tenant_id);


--
-- Name: aset_tr_mutasi_aset_legal_entity_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_mutasi_aset_legal_entity_id_index ON public.aset_tr_mutasi_aset USING btree (legal_entity_id);


--
-- Name: aset_tr_mutasi_aset_responsible_org_unit_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_mutasi_aset_responsible_org_unit_id_index ON public.aset_tr_mutasi_aset USING btree (responsible_org_unit_id);


--
-- Name: aset_tr_mutasi_aset_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_mutasi_aset_tenant_id_index ON public.aset_tr_mutasi_aset USING btree (tenant_id);


--
-- Name: aset_tr_mutasi_aset_tujuan_org_unit_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_mutasi_aset_tujuan_org_unit_id_index ON public.aset_tr_mutasi_aset USING btree (tujuan_org_unit_id);


--
-- Name: aset_tr_mutasi_kode_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_tr_mutasi_kode_unique ON public.aset_tr_mutasi_aset USING btree (tenant_id, legal_entity_id, kode) WHERE (deleted_at IS NULL);


--
-- Name: aset_tr_mutasi_line_asset_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_mutasi_line_asset_ix ON public.aset_tr_mutasi_aset_details USING btree (tenant_id, aset_id);


--
-- Name: aset_tr_mutasi_scope_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_mutasi_scope_ix ON public.aset_tr_mutasi_aset USING btree (tenant_id, legal_entity_id, responsible_org_unit_id, status);


--
-- Name: aset_tr_pembacaan_counter_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_pembacaan_counter_tenant_id_index ON public.aset_tr_pembacaan_counter USING btree (tenant_id);


--
-- Name: aset_tr_pembacaan_counter_urut_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_pembacaan_counter_urut_ix ON public.aset_tr_pembacaan_counter USING btree (tenant_id, aset_id, jenis_counter_id, dibaca_pada);


--
-- Name: aset_tr_pembatalan_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_pembatalan_tenant_id_index ON public.aset_tr_pembatalan USING btree (tenant_id);


--
-- Name: aset_tr_pembatalan_tenant_id_resource_document_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_pembatalan_tenant_id_resource_document_id_index ON public.aset_tr_pembatalan USING btree (tenant_id, resource, document_id);


--
-- Name: aset_tr_pemeliharaan_kode_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_tr_pemeliharaan_kode_unique ON public.aset_tr_pemeliharaan_aset USING btree (tenant_id, legal_entity_id, kode) WHERE (deleted_at IS NULL);


--
-- Name: aset_tr_penempatan_mutasi_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_penempatan_mutasi_ix ON public.aset_tr_penempatan_aset USING btree (tenant_id, mutasi_aset_id);


--
-- Name: aset_tr_penerimaan_aset_details_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_penerimaan_aset_details_tenant_id_index ON public.aset_tr_penerimaan_aset_details USING btree (tenant_id);


--
-- Name: aset_tr_penerimaan_aset_legal_entity_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_penerimaan_aset_legal_entity_id_index ON public.aset_tr_penerimaan_aset USING btree (legal_entity_id);


--
-- Name: aset_tr_penerimaan_aset_responsible_org_unit_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_penerimaan_aset_responsible_org_unit_id_index ON public.aset_tr_penerimaan_aset USING btree (responsible_org_unit_id);


--
-- Name: aset_tr_penerimaan_aset_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_penerimaan_aset_tenant_id_index ON public.aset_tr_penerimaan_aset USING btree (tenant_id);


--
-- Name: aset_tr_penerimaan_kode_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_tr_penerimaan_kode_unique ON public.aset_tr_penerimaan_aset USING btree (tenant_id, legal_entity_id, kode) WHERE (deleted_at IS NULL);


--
-- Name: aset_tr_penerimaan_line_pp_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_penerimaan_line_pp_ix ON public.aset_tr_penerimaan_aset_details USING btree (tenant_id, permintaan_pembelian_detail_id);


--
-- Name: aset_tr_penerimaan_scope_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_penerimaan_scope_ix ON public.aset_tr_penerimaan_aset USING btree (tenant_id, legal_entity_id, responsible_org_unit_id, status);


--
-- Name: aset_tr_penyesuaian_nilai_aset_details_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_penyesuaian_nilai_aset_details_tenant_id_index ON public.aset_tr_penyesuaian_nilai_aset_details USING btree (tenant_id);


--
-- Name: aset_tr_penyesuaian_nilai_aset_legal_entity_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_penyesuaian_nilai_aset_legal_entity_id_index ON public.aset_tr_penyesuaian_nilai_aset USING btree (legal_entity_id);


--
-- Name: aset_tr_penyesuaian_nilai_aset_responsible_org_unit_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_penyesuaian_nilai_aset_responsible_org_unit_id_index ON public.aset_tr_penyesuaian_nilai_aset USING btree (responsible_org_unit_id);


--
-- Name: aset_tr_penyesuaian_nilai_aset_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_penyesuaian_nilai_aset_tenant_id_index ON public.aset_tr_penyesuaian_nilai_aset USING btree (tenant_id);


--
-- Name: aset_tr_penyesuaian_nilai_kode_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_tr_penyesuaian_nilai_kode_unique ON public.aset_tr_penyesuaian_nilai_aset USING btree (tenant_id, legal_entity_id, kode) WHERE (deleted_at IS NULL);


--
-- Name: aset_tr_penyesuaian_nilai_line_aset_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_penyesuaian_nilai_line_aset_ix ON public.aset_tr_penyesuaian_nilai_aset_details USING btree (tenant_id, aset_id);


--
-- Name: aset_tr_penyesuaian_nilai_line_aset_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_tr_penyesuaian_nilai_line_aset_unique ON public.aset_tr_penyesuaian_nilai_aset_details USING btree (tenant_id, penyesuaian_nilai_aset_id, aset_id) WHERE (deleted_at IS NULL);


--
-- Name: aset_tr_penyesuaian_nilai_scope_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_penyesuaian_nilai_scope_ix ON public.aset_tr_penyesuaian_nilai_aset USING btree (tenant_id, legal_entity_id, responsible_org_unit_id, status);


--
-- Name: aset_tr_penyusutan_aset_posting_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_penyusutan_aset_posting_index ON public.aset_tr_penyusutan_aset USING btree (tenant_id, legal_entity_id, period_ends_on);


--
-- Name: aset_tr_perencanaan_aset_details_tenant_id_needed_on_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_perencanaan_aset_details_tenant_id_needed_on_index ON public.aset_tr_perencanaan_aset_details USING btree (tenant_id, needed_on);


--
-- Name: aset_tr_perencanaan_kode_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_tr_perencanaan_kode_unique ON public.aset_tr_perencanaan_aset USING btree (tenant_id, legal_entity_id, kode) WHERE (deleted_at IS NULL);


--
-- Name: aset_tr_permintaan_pemeliharaan_legal_entity_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_permintaan_pemeliharaan_legal_entity_id_index ON public.aset_tr_permintaan_pemeliharaan USING btree (legal_entity_id);


--
-- Name: aset_tr_permintaan_pemeliharaan_responsible_org_unit_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_permintaan_pemeliharaan_responsible_org_unit_id_index ON public.aset_tr_permintaan_pemeliharaan USING btree (responsible_org_unit_id);


--
-- Name: aset_tr_permintaan_pemeliharaan_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_permintaan_pemeliharaan_tenant_id_index ON public.aset_tr_permintaan_pemeliharaan USING btree (tenant_id);


--
-- Name: aset_tr_permintaan_pengadaan_kode_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_tr_permintaan_pengadaan_kode_unique ON public.aset_tr_permintaan_pengadaan_aset USING btree (tenant_id, legal_entity_id, kode) WHERE (deleted_at IS NULL);


--
-- Name: aset_tr_permintaan_pml_aset_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_permintaan_pml_aset_ix ON public.aset_tr_permintaan_pemeliharaan USING btree (tenant_id, aset_id);


--
-- Name: aset_tr_permintaan_pml_kode_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_tr_permintaan_pml_kode_unique ON public.aset_tr_permintaan_pemeliharaan USING btree (tenant_id, legal_entity_id, kode) WHERE (deleted_at IS NULL);


--
-- Name: aset_tr_permintaan_pml_scope_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_permintaan_pml_scope_ix ON public.aset_tr_permintaan_pemeliharaan USING btree (tenant_id, legal_entity_id, responsible_org_unit_id, status);


--
-- Name: aset_tr_pertanggungan_aset_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_pertanggungan_aset_ix ON public.aset_tr_pertanggungan_asuransi USING btree (tenant_id, aset_id);


--
-- Name: aset_tr_pertanggungan_asuransi_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_pertanggungan_asuransi_tenant_id_index ON public.aset_tr_pertanggungan_asuransi USING btree (tenant_id);


--
-- Name: aset_tr_pertanggungan_polis_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_pertanggungan_polis_ix ON public.aset_tr_pertanggungan_asuransi USING btree (tenant_id, polis_asuransi_id);


--
-- Name: aset_tr_reklasifikasi_aset_buku_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_reklasifikasi_aset_buku_tenant_id_index ON public.aset_tr_reklasifikasi_aset_buku USING btree (tenant_id);


--
-- Name: aset_tr_reklasifikasi_aset_details_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_reklasifikasi_aset_details_tenant_id_index ON public.aset_tr_reklasifikasi_aset_details USING btree (tenant_id);


--
-- Name: aset_tr_reklasifikasi_aset_legal_entity_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_reklasifikasi_aset_legal_entity_id_index ON public.aset_tr_reklasifikasi_aset USING btree (legal_entity_id);


--
-- Name: aset_tr_reklasifikasi_aset_responsible_org_unit_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_reklasifikasi_aset_responsible_org_unit_id_index ON public.aset_tr_reklasifikasi_aset USING btree (responsible_org_unit_id);


--
-- Name: aset_tr_reklasifikasi_aset_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_reklasifikasi_aset_tenant_id_index ON public.aset_tr_reklasifikasi_aset USING btree (tenant_id);


--
-- Name: aset_tr_reklasifikasi_buku_asal_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_reklasifikasi_buku_asal_ix ON public.aset_tr_reklasifikasi_aset_buku USING btree (tenant_id, buku_aset_asal_id);


--
-- Name: aset_tr_reklasifikasi_buku_aset_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_reklasifikasi_buku_aset_ix ON public.aset_tr_reklasifikasi_aset_buku USING btree (tenant_id, aset_asal_id, tanggal);


--
-- Name: aset_tr_reklasifikasi_buku_tujuan_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_reklasifikasi_buku_tujuan_ix ON public.aset_tr_reklasifikasi_aset_buku USING btree (tenant_id, buku_aset_tujuan_id);


--
-- Name: aset_tr_reklasifikasi_kode_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_tr_reklasifikasi_kode_unique ON public.aset_tr_reklasifikasi_aset USING btree (tenant_id, legal_entity_id, kode) WHERE (deleted_at IS NULL);


--
-- Name: aset_tr_reklasifikasi_line_aset_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_reklasifikasi_line_aset_ix ON public.aset_tr_reklasifikasi_aset_details USING btree (tenant_id, aset_id);


--
-- Name: aset_tr_reklasifikasi_line_baru_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_reklasifikasi_line_baru_ix ON public.aset_tr_reklasifikasi_aset_details USING btree (tenant_id, aset_baru_id);


--
-- Name: aset_tr_reklasifikasi_scope_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_reklasifikasi_scope_ix ON public.aset_tr_reklasifikasi_aset USING btree (tenant_id, legal_entity_id, responsible_org_unit_id, status);


--
-- Name: aset_tr_siklus_kode_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aset_tr_siklus_kode_unique ON public.aset_tr_dokumen_siklus_aset USING btree (tenant_id, legal_entity_id, jenis_dokumen, kode) WHERE (deleted_at IS NULL);


--
-- Name: aset_tr_work_order_scroll_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aset_tr_work_order_scroll_ix ON public.aset_tr_pemeliharaan_aset USING btree (tenant_id, legal_entity_id, (
CASE
    WHEN (created_at IS NULL) THEN 1
    ELSE 0
END), created_at DESC, id DESC) WHERE (deleted_at IS NULL);


--
-- Name: asset_document_scope_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_document_scope_index ON public.aset_tr_dokumen_siklus_aset USING btree (tenant_id, jenis_dokumen, legal_entity_id, responsible_org_unit_id);


--
-- Name: asset_plan_pending_estimates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_plan_pending_estimates ON public.aset_tr_perencanaan_aset_details USING btree (tenant_id, planning_id) WHERE ((deleted_at IS NULL) AND (estimate_pending = true) AND (estimated_unit_price = (0)::numeric));


--
-- Name: asset_scope_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_scope_index ON public.aset_tr_aset USING btree (tenant_id, legal_entity_id, responsible_org_unit_id);


--
-- Name: m_analisa_maintenance_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_analisa_maintenance_tenant_id_index ON public.aset_m_analisa_maintenance USING btree (tenant_id);


--
-- Name: m_buku_penyusutan_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_buku_penyusutan_tenant_id_index ON public.aset_m_buku_penyusutan USING btree (tenant_id);


--
-- Name: m_group_aset_asset_location_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_group_aset_asset_location_id_index ON public.aset_m_group_aset USING btree (lokasi_aset_id);


--
-- Name: m_group_aset_default_depreciation_profile_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_group_aset_default_depreciation_profile_id_index ON public.aset_m_group_aset USING btree (default_depreciation_profile_id);


--
-- Name: m_group_aset_kelompok_harta_fiskal_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_group_aset_kelompok_harta_fiskal_id_index ON public.aset_m_group_aset USING btree (kelompok_harta_fiskal_id);


--
-- Name: m_group_aset_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_group_aset_tenant_id_index ON public.aset_m_group_aset USING btree (tenant_id);


--
-- Name: m_group_buku_penyusutan_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_group_buku_penyusutan_tenant_id_index ON public.aset_m_group_buku_penyusutan USING btree (tenant_id);


--
-- Name: m_item_checklist_maintenance_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_item_checklist_maintenance_tenant_id_index ON public.aset_m_item_checklist_maintenance USING btree (tenant_id);


--
-- Name: m_jenis_aset_atribut_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_jenis_aset_atribut_tenant_id_index ON public.aset_m_jenis_aset_atribut USING btree (tenant_id);


--
-- Name: m_jenis_aset_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_jenis_aset_tenant_id_index ON public.aset_m_jenis_aset USING btree (tenant_id);


--
-- Name: m_kelompok_harta_fiskal_tenant_id_aktif_effective_from_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_kelompok_harta_fiskal_tenant_id_aktif_effective_from_index ON public.aset_m_kelompok_harta_fiskal USING btree (tenant_id, aktif, effective_from);


--
-- Name: m_kelompok_harta_fiskal_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_kelompok_harta_fiskal_tenant_id_index ON public.aset_m_kelompok_harta_fiskal USING btree (tenant_id);


--
-- Name: m_kondisi_aset_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_kondisi_aset_tenant_id_index ON public.aset_m_kondisi_aset USING btree (tenant_id);


--
-- Name: m_lokasi_aset_org_unit_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_lokasi_aset_org_unit_id_index ON public.aset_m_lokasi_aset USING btree (org_unit_id);


--
-- Name: m_lokasi_aset_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_lokasi_aset_tenant_id_index ON public.aset_m_lokasi_aset USING btree (tenant_id);


--
-- Name: m_lokasi_aset_tenant_id_kode_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX m_lokasi_aset_tenant_id_kode_unique ON public.aset_m_lokasi_aset USING btree (tenant_id, kode) WHERE (deleted_at IS NULL);


--
-- Name: m_lokasi_aset_tenant_id_tipe_lokasi_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_lokasi_aset_tenant_id_tipe_lokasi_id_index ON public.aset_m_lokasi_aset USING btree (tenant_id, tipe_lokasi_id);


--
-- Name: m_maintenance_checklist_template_line_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_maintenance_checklist_template_line_tenant_id_index ON public.aset_m_maintenance_checklist_template_line USING btree (tenant_id);


--
-- Name: m_maintenance_checklist_template_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_maintenance_checklist_template_tenant_id_index ON public.aset_m_maintenance_checklist_template USING btree (tenant_id);


--
-- Name: m_maintenance_checklist_variable_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_maintenance_checklist_variable_tenant_id_index ON public.aset_m_maintenance_checklist_variable USING btree (tenant_id);


--
-- Name: m_maintenance_checklist_variable_value_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_maintenance_checklist_variable_value_tenant_id_index ON public.aset_m_maintenance_checklist_variable_value USING btree (tenant_id);


--
-- Name: m_maintenance_job_type_default_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_maintenance_job_type_default_tenant_id_index ON public.aset_m_maintenance_job_type_default USING btree (tenant_id);


--
-- Name: m_maintenance_job_type_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_maintenance_job_type_tenant_id_index ON public.aset_m_maintenance_job_type USING btree (tenant_id);


--
-- Name: m_maintenance_job_type_variant_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_maintenance_job_type_variant_tenant_id_index ON public.aset_m_maintenance_job_type_variant USING btree (tenant_id);


--
-- Name: m_mnt_default_job_type_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_mnt_default_job_type_ix ON public.aset_m_maintenance_job_type_default USING btree (tenant_id, maintenance_job_type_id);


--
-- Name: m_mnt_job_variant_job_type_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_mnt_job_variant_job_type_ix ON public.aset_m_maintenance_job_type_variant USING btree (tenant_id, maintenance_job_type_id);


--
-- Name: m_mnt_tpl_line_number_uq_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX m_mnt_tpl_line_number_uq_active ON public.aset_m_maintenance_checklist_template_line USING btree (tenant_id, template_id, line_number) WHERE (deleted_at IS NULL);


--
-- Name: m_mnt_var_value_line_uq_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX m_mnt_var_value_line_uq_active ON public.aset_m_maintenance_checklist_variable_value USING btree (tenant_id, variable_id, line_number) WHERE (deleted_at IS NULL);


--
-- Name: m_model_aset_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_model_aset_tenant_id_index ON public.aset_m_model_aset USING btree (tenant_id);


--
-- Name: m_model_aset_tenant_id_jenis_aset_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_model_aset_tenant_id_jenis_aset_id_index ON public.aset_m_model_aset USING btree (tenant_id, jenis_aset_id);


--
-- Name: m_model_aset_tenant_id_pabrikan_aset_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_model_aset_tenant_id_pabrikan_aset_id_index ON public.aset_m_model_aset USING btree (tenant_id, pabrikan_aset_id);


--
-- Name: m_pabrikan_aset_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_pabrikan_aset_tenant_id_index ON public.aset_m_pabrikan_aset USING btree (tenant_id);


--
-- Name: m_profil_penyusutan_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_profil_penyusutan_tenant_id_index ON public.aset_m_profil_penyusutan USING btree (tenant_id);


--
-- Name: m_sebab_kerusakan_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_sebab_kerusakan_tenant_id_index ON public.aset_m_sebab_kerusakan USING btree (tenant_id);


--
-- Name: m_tindakan_perbaikan_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_tindakan_perbaikan_tenant_id_index ON public.aset_m_tindakan_perbaikan USING btree (tenant_id);


--
-- Name: m_tingkat_layanan_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_tingkat_layanan_tenant_id_index ON public.aset_m_tingkat_layanan USING btree (tenant_id);


--
-- Name: m_tipe_atribut_nilai_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_tipe_atribut_nilai_tenant_id_index ON public.aset_m_tipe_atribut_nilai USING btree (tenant_id);


--
-- Name: m_tipe_atribut_nilai_tenant_id_tipe_atribut_id_urutan_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_tipe_atribut_nilai_tenant_id_tipe_atribut_id_urutan_index ON public.aset_m_tipe_atribut_nilai USING btree (tenant_id, tipe_atribut_id, urutan);


--
-- Name: m_tipe_atribut_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_tipe_atribut_tenant_id_index ON public.aset_m_tipe_atribut USING btree (tenant_id);


--
-- Name: m_tipe_lokasi_aset_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_tipe_lokasi_aset_tenant_id_index ON public.aset_m_tipe_lokasi_aset USING btree (tenant_id);


--
-- Name: m_tipe_work_order_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_tipe_work_order_tenant_id_index ON public.aset_m_tipe_work_order USING btree (tenant_id);


--
-- Name: m_trade_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_trade_tenant_id_index ON public.aset_m_trade USING btree (tenant_id);


--
-- Name: m_validasi_status_work_order_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX m_validasi_status_work_order_tenant_id_index ON public.aset_m_validasi_status_work_order USING btree (tenant_id);


--
-- Name: processed_core_events_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX processed_core_events_tenant_id_index ON public.aset_processed_core_events USING btree (tenant_id);


--
-- Name: profil_penyusutan_effective_dates_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profil_penyusutan_effective_dates_idx ON public.aset_m_profil_penyusutan USING btree (tenant_id, effective_from, effective_to);


--
-- Name: t_aset_legal_entity_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX t_aset_legal_entity_id_index ON public.aset_tr_aset USING btree (legal_entity_id);


--
-- Name: t_aset_penempatan_tenant_id_asset_id_effective_on_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX t_aset_penempatan_tenant_id_asset_id_effective_on_index ON public.aset_tr_penempatan_aset USING btree (tenant_id, aset_id, effective_on);


--
-- Name: t_aset_penempatan_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX t_aset_penempatan_tenant_id_index ON public.aset_tr_penempatan_aset USING btree (tenant_id);


--
-- Name: t_aset_tenant_id_group_aset_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX t_aset_tenant_id_group_aset_id_index ON public.aset_tr_aset USING btree (tenant_id, group_aset_id);


--
-- Name: t_aset_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX t_aset_tenant_id_index ON public.aset_tr_aset USING btree (tenant_id);


--
-- Name: t_aset_tenant_id_jenis_aset_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX t_aset_tenant_id_jenis_aset_id_index ON public.aset_tr_aset USING btree (tenant_id, jenis_aset_id);


--
-- Name: t_aset_tenant_id_parent_asset_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX t_aset_tenant_id_parent_asset_id_index ON public.aset_tr_aset USING btree (tenant_id, induk_aset_id);


--
-- Name: t_buku_aset_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX t_buku_aset_tenant_id_index ON public.aset_tr_buku_aset USING btree (tenant_id);


--
-- Name: t_dokumen_siklus_aset_legal_entity_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX t_dokumen_siklus_aset_legal_entity_id_index ON public.aset_tr_dokumen_siklus_aset USING btree (legal_entity_id);


--
-- Name: t_dokumen_siklus_aset_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX t_dokumen_siklus_aset_tenant_id_index ON public.aset_tr_dokumen_siklus_aset USING btree (tenant_id);


--
-- Name: t_dokumen_siklus_aset_tenant_id_jenis_dokumen_tanggal_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX t_dokumen_siklus_aset_tenant_id_jenis_dokumen_tanggal_index ON public.aset_tr_dokumen_siklus_aset USING btree (tenant_id, jenis_dokumen, tanggal);


--
-- Name: t_export_penyusutan_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX t_export_penyusutan_tenant_id_index ON public.aset_tr_export_penyusutan USING btree (tenant_id);


--
-- Name: t_penyusutan_periode_legal_entity_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX t_penyusutan_periode_legal_entity_id_index ON public.aset_tr_penyusutan_aset USING btree (legal_entity_id);


--
-- Name: t_penyusutan_periode_original_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX t_penyusutan_periode_original_unique ON public.aset_tr_penyusutan_aset USING btree (tenant_id, buku_aset_id, period_ends_on) WHERE ((reverses_period_id IS NULL) AND (cancelled_at IS NULL));


--
-- Name: t_penyusutan_periode_reversal_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX t_penyusutan_periode_reversal_unique ON public.aset_tr_penyusutan_aset USING btree (tenant_id, reverses_period_id) WHERE (reverses_period_id IS NOT NULL);


--
-- Name: t_penyusutan_periode_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX t_penyusutan_periode_tenant_id_index ON public.aset_tr_penyusutan_aset USING btree (tenant_id);


--
-- Name: tr_aset_atribut_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tr_aset_atribut_tenant_id_index ON public.aset_tr_aset_atribut USING btree (tenant_id);


--
-- Name: tr_aset_atribut_tenant_id_tipe_atribut_id_nilai_number_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tr_aset_atribut_tenant_id_tipe_atribut_id_nilai_number_index ON public.aset_tr_aset_atribut USING btree (tenant_id, tipe_atribut_id, nilai_number);


--
-- Name: tr_buku_aset_tenant_id_buku_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tr_buku_aset_tenant_id_buku_id_index ON public.aset_tr_buku_aset USING btree (tenant_id, buku_id);


--
-- Name: tr_pemeliharaan_aset_checklist_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tr_pemeliharaan_aset_checklist_tenant_id_index ON public.aset_tr_pemeliharaan_aset_checklist USING btree (tenant_id);


--
-- Name: tr_pemeliharaan_aset_details_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tr_pemeliharaan_aset_details_tenant_id_index ON public.aset_tr_pemeliharaan_aset_details USING btree (tenant_id);


--
-- Name: tr_pemeliharaan_aset_legal_entity_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tr_pemeliharaan_aset_legal_entity_id_index ON public.aset_tr_pemeliharaan_aset USING btree (legal_entity_id);


--
-- Name: tr_pemeliharaan_aset_responsible_org_unit_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tr_pemeliharaan_aset_responsible_org_unit_id_index ON public.aset_tr_pemeliharaan_aset USING btree (responsible_org_unit_id);


--
-- Name: tr_pemeliharaan_aset_status_log_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tr_pemeliharaan_aset_status_log_tenant_id_index ON public.aset_tr_pemeliharaan_aset_status_log USING btree (tenant_id);


--
-- Name: tr_pemeliharaan_aset_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tr_pemeliharaan_aset_tenant_id_index ON public.aset_tr_pemeliharaan_aset USING btree (tenant_id);


--
-- Name: tr_penerimaan_aset_financial_dimension_org_unit_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tr_penerimaan_aset_financial_dimension_org_unit_id_index ON public.aset_tr_aset USING btree (financial_dimension_org_unit_id);


--
-- Name: tr_penerimaan_aset_kelompok_harta_fiskal_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tr_penerimaan_aset_kelompok_harta_fiskal_id_index ON public.aset_tr_aset USING btree (kelompok_harta_fiskal_id);


--
-- Name: tr_perencanaan_aset_details_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tr_perencanaan_aset_details_tenant_id_index ON public.aset_tr_perencanaan_aset_details USING btree (tenant_id);


--
-- Name: tr_perencanaan_aset_details_tenant_id_jenis_aset_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tr_perencanaan_aset_details_tenant_id_jenis_aset_id_index ON public.aset_tr_perencanaan_aset_details USING btree (tenant_id, jenis_aset_id);


--
-- Name: tr_perencanaan_aset_details_tenant_id_satuan_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tr_perencanaan_aset_details_tenant_id_satuan_id_index ON public.aset_tr_perencanaan_aset_details USING btree (tenant_id, satuan_id);


--
-- Name: tr_perencanaan_aset_legal_entity_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tr_perencanaan_aset_legal_entity_id_index ON public.aset_tr_perencanaan_aset USING btree (legal_entity_id);


--
-- Name: tr_perencanaan_aset_planning_org_unit_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tr_perencanaan_aset_planning_org_unit_id_index ON public.aset_tr_perencanaan_aset USING btree (planning_org_unit_id);


--
-- Name: tr_perencanaan_aset_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tr_perencanaan_aset_tenant_id_index ON public.aset_tr_perencanaan_aset USING btree (tenant_id);


--
-- Name: tr_perencanaan_aset_tenant_id_planning_year_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tr_perencanaan_aset_tenant_id_planning_year_status_index ON public.aset_tr_perencanaan_aset USING btree (tenant_id, planning_year, status);


--
-- Name: tr_permintaan_pengadaan_aset_details_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tr_permintaan_pengadaan_aset_details_tenant_id_index ON public.aset_tr_permintaan_pengadaan_aset_details USING btree (tenant_id);


--
-- Name: tr_permintaan_pengadaan_aset_legal_entity_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tr_permintaan_pengadaan_aset_legal_entity_id_index ON public.aset_tr_permintaan_pengadaan_aset USING btree (legal_entity_id);


--
-- Name: tr_permintaan_pengadaan_aset_requesting_org_unit_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tr_permintaan_pengadaan_aset_requesting_org_unit_id_index ON public.aset_tr_permintaan_pengadaan_aset USING btree (requesting_org_unit_id);


--
-- Name: tr_permintaan_pengadaan_aset_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tr_permintaan_pengadaan_aset_tenant_id_index ON public.aset_tr_permintaan_pengadaan_aset USING btree (tenant_id);


--
-- Name: tr_permintaan_pengadaan_aset_tenant_id_legal_entity_id_requesti; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tr_permintaan_pengadaan_aset_tenant_id_legal_entity_id_requesti ON public.aset_tr_permintaan_pengadaan_aset USING btree (tenant_id, legal_entity_id, requesting_org_unit_id, status);


--
-- Name: tr_wo_job_asset_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tr_wo_job_asset_ix ON public.aset_tr_pemeliharaan_aset_details USING btree (tenant_id, aset_id);


--
-- Name: tr_wo_job_assignee_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tr_wo_job_assignee_ix ON public.aset_tr_pemeliharaan_aset_details USING btree (tenant_id, ditugaskan_ke_user_id);


--
-- Name: tr_wo_log_header_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tr_wo_log_header_ix ON public.aset_tr_pemeliharaan_aset_status_log USING btree (tenant_id, pemeliharaan_aset_id);


--
-- Name: tr_wo_scope_status_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tr_wo_scope_status_ix ON public.aset_tr_pemeliharaan_aset USING btree (tenant_id, legal_entity_id, responsible_org_unit_id, status);


--
-- Name: aset_tr_buku_aset aset_book_ledger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER aset_book_ledger AFTER INSERT OR UPDATE ON public.aset_tr_buku_aset FOR EACH ROW EXECUTE FUNCTION public.aset_capture_book_ledger();


--
-- Name: aset_tr_buku_aset aset_budgeted_book; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER aset_budgeted_book BEFORE INSERT OR UPDATE ON public.aset_tr_buku_aset FOR EACH ROW EXECUTE FUNCTION public.aset_guard_budgeted_actual_entry();


--
-- Name: aset_tr_aset aset_budgeted_identity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER aset_budgeted_identity BEFORE INSERT OR UPDATE ON public.aset_tr_aset FOR EACH ROW EXECUTE FUNCTION public.aset_guard_budgeted_identity();


--
-- Name: aset_tr_ledger_aset aset_budgeted_ledger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER aset_budgeted_ledger BEFORE INSERT ON public.aset_tr_ledger_aset FOR EACH ROW EXECUTE FUNCTION public.aset_guard_budgeted_actual_entry();


--
-- Name: aset_tr_aset aset_group_ledger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER aset_group_ledger AFTER UPDATE OF group_aset_id ON public.aset_tr_aset FOR EACH ROW EXECUTE FUNCTION public.aset_capture_group_ledger();


--
-- Name: aset_tr_ledger_aset aset_ledger_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER aset_ledger_immutable BEFORE DELETE OR UPDATE ON public.aset_tr_ledger_aset FOR EACH ROW EXECUTE FUNCTION public.aset_guard_ledger_history();


--
-- Name: aset_m_alasan_downtime bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_alasan_downtime FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_analisa_maintenance bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_analisa_maintenance FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_buku_penyusutan bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_buku_penyusutan FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_group_aset bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_group_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_group_buku_penyusutan bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_group_buku_penyusutan FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_item_checklist_maintenance bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_item_checklist_maintenance FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_jenis_aset bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_jenis_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_jenis_aset_atribut bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_jenis_aset_atribut FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_jenis_aset_counter bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_jenis_aset_counter FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_jenis_aset_kondisi bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_jenis_aset_kondisi FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_jenis_asuransi bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_jenis_asuransi FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_jenis_counter bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_jenis_counter FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_jenis_permintaan_pemeliharaan bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_jenis_permintaan_pemeliharaan FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_kelompok_harta_fiskal bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_kelompok_harta_fiskal FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_kondisi_aset bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_kondisi_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_lokasi_aset bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_lokasi_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_maintenance_checklist_template bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_maintenance_checklist_template FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_maintenance_checklist_template_line bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_maintenance_checklist_template_line FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_maintenance_checklist_variable bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_maintenance_checklist_variable FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_maintenance_checklist_variable_value bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_maintenance_checklist_variable_value FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_maintenance_job_type bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_maintenance_job_type FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_maintenance_job_type_default bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_maintenance_job_type_default FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_maintenance_job_type_jenis_aset bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_maintenance_job_type_jenis_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_maintenance_job_type_variant bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_maintenance_job_type_variant FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_model_aset bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_model_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_pabrikan_aset bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_pabrikan_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_polis_asuransi bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_polis_asuransi FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_posting_group bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_posting_group FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_profil_penyusutan bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_profil_penyusutan FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_rencana_pemeliharaan bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_rencana_pemeliharaan FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_rencana_pemeliharaan_baris bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_rencana_pemeliharaan_baris FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_rencana_pemeliharaan_objek bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_rencana_pemeliharaan_objek FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_sebab_kerusakan bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_sebab_kerusakan FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_tindakan_perbaikan bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_tindakan_perbaikan FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_tingkat_layanan bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_tingkat_layanan FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_tipe_atribut bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_tipe_atribut FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_tipe_atribut_nilai bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_tipe_atribut_nilai FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_tipe_lokasi_aset bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_tipe_lokasi_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_tipe_work_order bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_tipe_work_order FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_trade bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_trade FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_validasi_status_work_order bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_m_validasi_status_work_order FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_pengaturan_aset_tetap bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_pengaturan_aset_tetap FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_processed_core_events bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_processed_core_events FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_aset bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_aset_atribut bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_aset_atribut FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_buku_aset bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_buku_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_dokumen_siklus_aset bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_dokumen_siklus_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_downtime_aset bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_downtime_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_export_penyusutan bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_export_penyusutan FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_garansi_aset bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_garansi_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_jadwal_pemeliharaan bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_jadwal_pemeliharaan FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_kontrak_servis bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_kontrak_servis FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_kontrak_servis_aset bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_kontrak_servis_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_ledger_aset bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_ledger_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_monitoring_aset bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_monitoring_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_monitoring_aset_details bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_monitoring_aset_details FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_mutasi_aset bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_mutasi_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_mutasi_aset_details bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_mutasi_aset_details FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_pembacaan_counter bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_pembacaan_counter FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_pembatalan bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_pembatalan FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_pemeliharaan_aset bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_pemeliharaan_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_pemeliharaan_aset_checklist bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_pemeliharaan_aset_checklist FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_pemeliharaan_aset_details bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_pemeliharaan_aset_details FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_pemeliharaan_aset_status_log bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_pemeliharaan_aset_status_log FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_penempatan_aset bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_penempatan_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_penerimaan_aset bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_penerimaan_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_penerimaan_aset_details bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_penerimaan_aset_details FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_penyesuaian_nilai_aset bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_penyesuaian_nilai_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_penyesuaian_nilai_aset_details bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_penyesuaian_nilai_aset_details FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_penyusutan_aset bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_penyusutan_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_perencanaan_aset bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_perencanaan_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_perencanaan_aset_details bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_perencanaan_aset_details FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_permintaan_pemeliharaan bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_permintaan_pemeliharaan FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_permintaan_pengadaan_aset bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_permintaan_pengadaan_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_permintaan_pengadaan_aset_details bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_permintaan_pengadaan_aset_details FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_pertanggungan_asuransi bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_pertanggungan_asuransi FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_reklasifikasi_aset bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_reklasifikasi_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_reklasifikasi_aset_buku bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_reklasifikasi_aset_buku FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_tr_reklasifikasi_aset_details bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.aset_tr_reklasifikasi_aset_details FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: aset_m_alasan_downtime log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_alasan_downtime FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_analisa_maintenance log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_analisa_maintenance FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_buku_penyusutan log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_buku_penyusutan FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_group_aset log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_group_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_group_buku_penyusutan log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_group_buku_penyusutan FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_item_checklist_maintenance log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_item_checklist_maintenance FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_jenis_aset log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_jenis_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_jenis_aset_atribut log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_jenis_aset_atribut FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_jenis_aset_counter log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_jenis_aset_counter FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_jenis_aset_kondisi log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_jenis_aset_kondisi FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_jenis_asuransi log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_jenis_asuransi FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_jenis_counter log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_jenis_counter FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_jenis_permintaan_pemeliharaan log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_jenis_permintaan_pemeliharaan FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_kelompok_harta_fiskal log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_kelompok_harta_fiskal FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_kondisi_aset log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_kondisi_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_lokasi_aset log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_lokasi_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_maintenance_checklist_template log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_maintenance_checklist_template FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_maintenance_checklist_template_line log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_maintenance_checklist_template_line FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_maintenance_checklist_variable log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_maintenance_checklist_variable FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_maintenance_checklist_variable_value log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_maintenance_checklist_variable_value FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_maintenance_job_type log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_maintenance_job_type FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_maintenance_job_type_default log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_maintenance_job_type_default FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_maintenance_job_type_jenis_aset log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_maintenance_job_type_jenis_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change('job_type_id', 'jenis_aset_id');


--
-- Name: aset_m_maintenance_job_type_variant log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_maintenance_job_type_variant FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_model_aset log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_model_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_pabrikan_aset log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_pabrikan_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_polis_asuransi log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_polis_asuransi FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_posting_group log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_posting_group FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_profil_penyusutan log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_profil_penyusutan FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_rencana_pemeliharaan log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_rencana_pemeliharaan FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_rencana_pemeliharaan_baris log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_rencana_pemeliharaan_baris FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_rencana_pemeliharaan_objek log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_rencana_pemeliharaan_objek FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_sebab_kerusakan log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_sebab_kerusakan FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_tindakan_perbaikan log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_tindakan_perbaikan FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_tingkat_layanan log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_tingkat_layanan FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_tipe_atribut log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_tipe_atribut FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_tipe_atribut_nilai log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_tipe_atribut_nilai FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_tipe_lokasi_aset log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_tipe_lokasi_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_tipe_work_order log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_tipe_work_order FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_trade log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_trade FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_validasi_status_work_order log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_m_validasi_status_work_order FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_pengaturan_aset_tetap log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_pengaturan_aset_tetap FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_processed_core_events log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_processed_core_events FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_aset log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_aset_atribut log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_aset_atribut FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_buku_aset log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_buku_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_dokumen_siklus_aset log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_dokumen_siklus_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_downtime_aset log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_downtime_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_export_penyusutan log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_export_penyusutan FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_garansi_aset log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_garansi_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_jadwal_pemeliharaan log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_jadwal_pemeliharaan FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_kontrak_servis log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_kontrak_servis FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_kontrak_servis_aset log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_kontrak_servis_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_ledger_aset log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_ledger_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_monitoring_aset log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_monitoring_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_monitoring_aset_details log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_monitoring_aset_details FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_mutasi_aset log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_mutasi_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_mutasi_aset_details log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_mutasi_aset_details FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_pembacaan_counter log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_pembacaan_counter FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_pembatalan log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_pembatalan FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_pemeliharaan_aset log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_pemeliharaan_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_pemeliharaan_aset_checklist log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_pemeliharaan_aset_checklist FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_pemeliharaan_aset_details log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_pemeliharaan_aset_details FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_pemeliharaan_aset_status_log log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_pemeliharaan_aset_status_log FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_penempatan_aset log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_penempatan_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_penerimaan_aset log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_penerimaan_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_penerimaan_aset_details log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_penerimaan_aset_details FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_penyesuaian_nilai_aset log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_penyesuaian_nilai_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_penyesuaian_nilai_aset_details log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_penyesuaian_nilai_aset_details FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_penyusutan_aset log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_penyusutan_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_perencanaan_aset log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_perencanaan_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_perencanaan_aset_details log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_perencanaan_aset_details FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_permintaan_pemeliharaan log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_permintaan_pemeliharaan FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_permintaan_pengadaan_aset log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_permintaan_pengadaan_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_permintaan_pengadaan_aset_details log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_permintaan_pengadaan_aset_details FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_pertanggungan_asuransi log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_pertanggungan_asuransi FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_reklasifikasi_aset log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_reklasifikasi_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_reklasifikasi_aset_buku log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_reklasifikasi_aset_buku FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_tr_reklasifikasi_aset_details log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.aset_tr_reklasifikasi_aset_details FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: aset_m_alasan_downtime stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_alasan_downtime FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_analisa_maintenance stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_analisa_maintenance FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_buku_penyusutan stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_buku_penyusutan FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_group_aset stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_group_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_group_buku_penyusutan stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_group_buku_penyusutan FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_item_checklist_maintenance stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_item_checklist_maintenance FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_jenis_aset stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_jenis_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_jenis_aset_atribut stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_jenis_aset_atribut FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_jenis_aset_counter stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_jenis_aset_counter FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_jenis_aset_kondisi stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_jenis_aset_kondisi FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_jenis_asuransi stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_jenis_asuransi FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_jenis_counter stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_jenis_counter FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_jenis_permintaan_pemeliharaan stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_jenis_permintaan_pemeliharaan FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_kelompok_harta_fiskal stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_kelompok_harta_fiskal FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_kondisi_aset stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_kondisi_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_lokasi_aset stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_lokasi_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_maintenance_checklist_template stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_maintenance_checklist_template FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_maintenance_checklist_template_line stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_maintenance_checklist_template_line FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_maintenance_checklist_variable stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_maintenance_checklist_variable FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_maintenance_checklist_variable_value stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_maintenance_checklist_variable_value FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_maintenance_job_type stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_maintenance_job_type FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_maintenance_job_type_default stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_maintenance_job_type_default FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_maintenance_job_type_jenis_aset stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_maintenance_job_type_jenis_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_maintenance_job_type_variant stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_maintenance_job_type_variant FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_model_aset stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_model_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_pabrikan_aset stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_pabrikan_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_polis_asuransi stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_polis_asuransi FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_posting_group stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_posting_group FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_profil_penyusutan stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_profil_penyusutan FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_rencana_pemeliharaan stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_rencana_pemeliharaan FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_rencana_pemeliharaan_baris stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_rencana_pemeliharaan_baris FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_rencana_pemeliharaan_objek stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_rencana_pemeliharaan_objek FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_sebab_kerusakan stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_sebab_kerusakan FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_tindakan_perbaikan stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_tindakan_perbaikan FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_tingkat_layanan stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_tingkat_layanan FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_tipe_atribut stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_tipe_atribut FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_tipe_atribut_nilai stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_tipe_atribut_nilai FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_tipe_lokasi_aset stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_tipe_lokasi_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_tipe_work_order stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_tipe_work_order FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_trade stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_trade FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_m_validasi_status_work_order stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_m_validasi_status_work_order FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_pengaturan_aset_tetap stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_pengaturan_aset_tetap FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_processed_core_events stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_processed_core_events FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_aset stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_aset_atribut stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_aset_atribut FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_buku_aset stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_buku_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_dokumen_siklus_aset stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_dokumen_siklus_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_downtime_aset stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_downtime_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_export_penyusutan stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_export_penyusutan FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_garansi_aset stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_garansi_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_jadwal_pemeliharaan stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_jadwal_pemeliharaan FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_kontrak_servis stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_kontrak_servis FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_kontrak_servis_aset stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_kontrak_servis_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_ledger_aset stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_ledger_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_monitoring_aset stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_monitoring_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_monitoring_aset_details stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_monitoring_aset_details FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_mutasi_aset stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_mutasi_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_mutasi_aset_details stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_mutasi_aset_details FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_pembacaan_counter stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_pembacaan_counter FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_pembatalan stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_pembatalan FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_pemeliharaan_aset stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_pemeliharaan_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_pemeliharaan_aset_checklist stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_pemeliharaan_aset_checklist FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_pemeliharaan_aset_details stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_pemeliharaan_aset_details FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_pemeliharaan_aset_status_log stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_pemeliharaan_aset_status_log FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_penempatan_aset stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_penempatan_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_penerimaan_aset stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_penerimaan_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_penerimaan_aset_details stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_penerimaan_aset_details FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_penyesuaian_nilai_aset stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_penyesuaian_nilai_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_penyesuaian_nilai_aset_details stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_penyesuaian_nilai_aset_details FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_penyusutan_aset stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_penyusutan_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_perencanaan_aset stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_perencanaan_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_perencanaan_aset_details stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_perencanaan_aset_details FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_permintaan_pemeliharaan stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_permintaan_pemeliharaan FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_permintaan_pengadaan_aset stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_permintaan_pengadaan_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_permintaan_pengadaan_aset_details stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_permintaan_pengadaan_aset_details FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_pertanggungan_asuransi stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_pertanggungan_asuransi FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_reklasifikasi_aset stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_reklasifikasi_aset FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_reklasifikasi_aset_buku stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_reklasifikasi_aset_buku FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_reklasifikasi_aset_details stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.aset_tr_reklasifikasi_aset_details FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: aset_tr_ledger_aset aset_ledger_asset_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_ledger_aset
    ADD CONSTRAINT aset_ledger_asset_fk FOREIGN KEY (tenant_id, aset_id) REFERENCES public.aset_tr_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_ledger_aset aset_ledger_book_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_ledger_aset
    ADD CONSTRAINT aset_ledger_book_fk FOREIGN KEY (tenant_id, buku_aset_id) REFERENCES public.aset_tr_buku_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_jenis_aset_counter aset_m_jenis_aset_counter_counter_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_jenis_aset_counter
    ADD CONSTRAINT aset_m_jenis_aset_counter_counter_fk FOREIGN KEY (tenant_id, jenis_counter_id) REFERENCES public.aset_m_jenis_counter(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_jenis_aset_counter aset_m_jenis_aset_counter_jenis_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_jenis_aset_counter
    ADD CONSTRAINT aset_m_jenis_aset_counter_jenis_fk FOREIGN KEY (tenant_id, jenis_aset_id) REFERENCES public.aset_m_jenis_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_jenis_aset_kondisi aset_m_jenis_aset_kondisi_condition_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_jenis_aset_kondisi
    ADD CONSTRAINT aset_m_jenis_aset_kondisi_condition_fk FOREIGN KEY (tenant_id, kondisi_aset_id) REFERENCES public.aset_m_kondisi_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_jenis_aset_kondisi aset_m_jenis_aset_kondisi_jenis_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_jenis_aset_kondisi
    ADD CONSTRAINT aset_m_jenis_aset_kondisi_jenis_fk FOREIGN KEY (tenant_id, jenis_aset_id) REFERENCES public.aset_m_jenis_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_jenis_permintaan_pemeliharaan aset_m_jenis_permintaan_tipe_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_jenis_permintaan_pemeliharaan
    ADD CONSTRAINT aset_m_jenis_permintaan_tipe_fk FOREIGN KEY (tenant_id, tipe_work_order_id) REFERENCES public.aset_m_tipe_work_order(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_polis_asuransi aset_m_polis_asuransi_jenis_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_polis_asuransi
    ADD CONSTRAINT aset_m_polis_asuransi_jenis_fk FOREIGN KEY (tenant_id, jenis_asuransi_id) REFERENCES public.aset_m_jenis_asuransi(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_posting_group aset_m_posting_group_tenant_id_group_aset_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_posting_group
    ADD CONSTRAINT aset_m_posting_group_tenant_id_group_aset_id_foreign FOREIGN KEY (tenant_id, group_aset_id) REFERENCES public.aset_m_group_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_rencana_pemeliharaan_baris aset_m_rencana_baris_counter_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_rencana_pemeliharaan_baris
    ADD CONSTRAINT aset_m_rencana_baris_counter_fk FOREIGN KEY (tenant_id, jenis_counter_id) REFERENCES public.aset_m_jenis_counter(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_rencana_pemeliharaan_baris aset_m_rencana_baris_header_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_rencana_pemeliharaan_baris
    ADD CONSTRAINT aset_m_rencana_baris_header_fk FOREIGN KEY (tenant_id, rencana_pemeliharaan_id) REFERENCES public.aset_m_rencana_pemeliharaan(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_rencana_pemeliharaan_baris aset_m_rencana_baris_job_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_rencana_pemeliharaan_baris
    ADD CONSTRAINT aset_m_rencana_baris_job_fk FOREIGN KEY (tenant_id, maintenance_job_type_id) REFERENCES public.aset_m_maintenance_job_type(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_rencana_pemeliharaan_baris aset_m_rencana_baris_layanan_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_rencana_pemeliharaan_baris
    ADD CONSTRAINT aset_m_rencana_baris_layanan_fk FOREIGN KEY (tenant_id, tingkat_layanan_id) REFERENCES public.aset_m_tingkat_layanan(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_rencana_pemeliharaan_baris aset_m_rencana_baris_tipe_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_rencana_pemeliharaan_baris
    ADD CONSTRAINT aset_m_rencana_baris_tipe_fk FOREIGN KEY (tenant_id, tipe_work_order_id) REFERENCES public.aset_m_tipe_work_order(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_rencana_pemeliharaan_baris aset_m_rencana_baris_trade_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_rencana_pemeliharaan_baris
    ADD CONSTRAINT aset_m_rencana_baris_trade_fk FOREIGN KEY (tenant_id, trade_id) REFERENCES public.aset_m_trade(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_rencana_pemeliharaan_baris aset_m_rencana_baris_variant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_rencana_pemeliharaan_baris
    ADD CONSTRAINT aset_m_rencana_baris_variant_fk FOREIGN KEY (tenant_id, variant_id) REFERENCES public.aset_m_maintenance_job_type_variant(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_rencana_pemeliharaan_objek aset_m_rencana_objek_aset_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_rencana_pemeliharaan_objek
    ADD CONSTRAINT aset_m_rencana_objek_aset_fk FOREIGN KEY (tenant_id, aset_id) REFERENCES public.aset_tr_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_rencana_pemeliharaan_objek aset_m_rencana_objek_header_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_rencana_pemeliharaan_objek
    ADD CONSTRAINT aset_m_rencana_objek_header_fk FOREIGN KEY (tenant_id, rencana_pemeliharaan_id) REFERENCES public.aset_m_rencana_pemeliharaan(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_rencana_pemeliharaan_objek aset_m_rencana_objek_jenis_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_rencana_pemeliharaan_objek
    ADD CONSTRAINT aset_m_rencana_objek_jenis_fk FOREIGN KEY (tenant_id, jenis_aset_id) REFERENCES public.aset_m_jenis_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_pengaturan_aset_tetap aset_pengaturan_buku_bawaan_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_pengaturan_aset_tetap
    ADD CONSTRAINT aset_pengaturan_buku_bawaan_fk FOREIGN KEY (tenant_id, buku_penyusutan_bawaan_id) REFERENCES public.aset_m_buku_penyusutan(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_aset aset_tr_aset_penerimaan_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_aset
    ADD CONSTRAINT aset_tr_aset_penerimaan_fk FOREIGN KEY (tenant_id, penerimaan_aset_id) REFERENCES public.aset_tr_penerimaan_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_aset aset_tr_aset_penerimaan_line_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_aset
    ADD CONSTRAINT aset_tr_aset_penerimaan_line_fk FOREIGN KEY (tenant_id, penerimaan_aset_detail_id) REFERENCES public.aset_tr_penerimaan_aset_details(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_downtime_aset aset_tr_downtime_alasan_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_downtime_aset
    ADD CONSTRAINT aset_tr_downtime_alasan_fk FOREIGN KEY (tenant_id, alasan_downtime_id) REFERENCES public.aset_m_alasan_downtime(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_downtime_aset aset_tr_downtime_aset_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_downtime_aset
    ADD CONSTRAINT aset_tr_downtime_aset_fk FOREIGN KEY (tenant_id, aset_id) REFERENCES public.aset_tr_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_downtime_aset aset_tr_downtime_permintaan_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_downtime_aset
    ADD CONSTRAINT aset_tr_downtime_permintaan_fk FOREIGN KEY (tenant_id, permintaan_pemeliharaan_id) REFERENCES public.aset_tr_permintaan_pemeliharaan(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_downtime_aset aset_tr_downtime_wo_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_downtime_aset
    ADD CONSTRAINT aset_tr_downtime_wo_fk FOREIGN KEY (tenant_id, pemeliharaan_aset_id) REFERENCES public.aset_tr_pemeliharaan_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_garansi_aset aset_tr_garansi_aset_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_garansi_aset
    ADD CONSTRAINT aset_tr_garansi_aset_fk FOREIGN KEY (tenant_id, aset_id) REFERENCES public.aset_tr_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_jadwal_pemeliharaan aset_tr_jadwal_aset_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_jadwal_pemeliharaan
    ADD CONSTRAINT aset_tr_jadwal_aset_fk FOREIGN KEY (tenant_id, aset_id) REFERENCES public.aset_tr_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_jadwal_pemeliharaan aset_tr_jadwal_baris_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_jadwal_pemeliharaan
    ADD CONSTRAINT aset_tr_jadwal_baris_fk FOREIGN KEY (tenant_id, rencana_baris_id) REFERENCES public.aset_m_rencana_pemeliharaan_baris(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_jadwal_pemeliharaan aset_tr_jadwal_rencana_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_jadwal_pemeliharaan
    ADD CONSTRAINT aset_tr_jadwal_rencana_fk FOREIGN KEY (tenant_id, rencana_pemeliharaan_id) REFERENCES public.aset_m_rencana_pemeliharaan(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_jadwal_pemeliharaan aset_tr_jadwal_wo_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_jadwal_pemeliharaan
    ADD CONSTRAINT aset_tr_jadwal_wo_fk FOREIGN KEY (tenant_id, pemeliharaan_aset_id) REFERENCES public.aset_tr_pemeliharaan_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_kontrak_servis_aset aset_tr_kontrak_servis_line_aset_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_kontrak_servis_aset
    ADD CONSTRAINT aset_tr_kontrak_servis_line_aset_fk FOREIGN KEY (tenant_id, aset_id) REFERENCES public.aset_tr_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_kontrak_servis_aset aset_tr_kontrak_servis_line_header_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_kontrak_servis_aset
    ADD CONSTRAINT aset_tr_kontrak_servis_line_header_fk FOREIGN KEY (tenant_id, kontrak_servis_id) REFERENCES public.aset_tr_kontrak_servis(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_monitoring_aset_details aset_tr_monitoring_line_aset_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_monitoring_aset_details
    ADD CONSTRAINT aset_tr_monitoring_line_aset_fk FOREIGN KEY (tenant_id, aset_id) REFERENCES public.aset_tr_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_monitoring_aset_details aset_tr_monitoring_line_header_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_monitoring_aset_details
    ADD CONSTRAINT aset_tr_monitoring_line_header_fk FOREIGN KEY (tenant_id, monitoring_aset_id) REFERENCES public.aset_tr_monitoring_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_monitoring_aset_details aset_tr_monitoring_line_kondisi_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_monitoring_aset_details
    ADD CONSTRAINT aset_tr_monitoring_line_kondisi_fk FOREIGN KEY (tenant_id, kondisi_aset_id) REFERENCES public.aset_m_kondisi_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_monitoring_aset_details aset_tr_monitoring_line_lokasi_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_monitoring_aset_details
    ADD CONSTRAINT aset_tr_monitoring_line_lokasi_fk FOREIGN KEY (tenant_id, sistem_lokasi_id) REFERENCES public.aset_m_lokasi_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_monitoring_aset aset_tr_monitoring_lokasi_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_monitoring_aset
    ADD CONSTRAINT aset_tr_monitoring_lokasi_fk FOREIGN KEY (tenant_id, lokasi_aset_id) REFERENCES public.aset_m_lokasi_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_mutasi_aset_details aset_tr_mutasi_line_asal_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_mutasi_aset_details
    ADD CONSTRAINT aset_tr_mutasi_line_asal_fk FOREIGN KEY (tenant_id, asal_lokasi_id) REFERENCES public.aset_m_lokasi_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_mutasi_aset_details aset_tr_mutasi_line_aset_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_mutasi_aset_details
    ADD CONSTRAINT aset_tr_mutasi_line_aset_fk FOREIGN KEY (tenant_id, aset_id) REFERENCES public.aset_tr_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_mutasi_aset_details aset_tr_mutasi_line_header_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_mutasi_aset_details
    ADD CONSTRAINT aset_tr_mutasi_line_header_fk FOREIGN KEY (tenant_id, mutasi_aset_id) REFERENCES public.aset_tr_mutasi_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_mutasi_aset_details aset_tr_mutasi_line_kondisi_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_mutasi_aset_details
    ADD CONSTRAINT aset_tr_mutasi_line_kondisi_fk FOREIGN KEY (tenant_id, kondisi_aset_id) REFERENCES public.aset_m_kondisi_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_mutasi_aset aset_tr_mutasi_lokasi_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_mutasi_aset
    ADD CONSTRAINT aset_tr_mutasi_lokasi_fk FOREIGN KEY (tenant_id, tujuan_lokasi_id) REFERENCES public.aset_m_lokasi_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_pembacaan_counter aset_tr_pembacaan_counter_aset_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pembacaan_counter
    ADD CONSTRAINT aset_tr_pembacaan_counter_aset_fk FOREIGN KEY (tenant_id, aset_id) REFERENCES public.aset_tr_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_pembacaan_counter aset_tr_pembacaan_counter_jenis_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pembacaan_counter
    ADD CONSTRAINT aset_tr_pembacaan_counter_jenis_fk FOREIGN KEY (tenant_id, jenis_counter_id) REFERENCES public.aset_m_jenis_counter(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_penempatan_aset aset_tr_penempatan_mutasi_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penempatan_aset
    ADD CONSTRAINT aset_tr_penempatan_mutasi_fk FOREIGN KEY (tenant_id, mutasi_aset_id) REFERENCES public.aset_tr_mutasi_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_penerimaan_aset_details aset_tr_penerimaan_line_group_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penerimaan_aset_details
    ADD CONSTRAINT aset_tr_penerimaan_line_group_fk FOREIGN KEY (tenant_id, group_aset_id) REFERENCES public.aset_m_group_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_penerimaan_aset_details aset_tr_penerimaan_line_header_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penerimaan_aset_details
    ADD CONSTRAINT aset_tr_penerimaan_line_header_fk FOREIGN KEY (tenant_id, penerimaan_aset_id) REFERENCES public.aset_tr_penerimaan_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_penerimaan_aset_details aset_tr_penerimaan_line_jenis_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penerimaan_aset_details
    ADD CONSTRAINT aset_tr_penerimaan_line_jenis_fk FOREIGN KEY (tenant_id, jenis_aset_id) REFERENCES public.aset_m_jenis_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_penerimaan_aset_details aset_tr_penerimaan_line_kondisi_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penerimaan_aset_details
    ADD CONSTRAINT aset_tr_penerimaan_line_kondisi_fk FOREIGN KEY (tenant_id, kondisi_aset_id) REFERENCES public.aset_m_kondisi_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_penerimaan_aset_details aset_tr_penerimaan_line_model_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penerimaan_aset_details
    ADD CONSTRAINT aset_tr_penerimaan_line_model_fk FOREIGN KEY (tenant_id, model_aset_id) REFERENCES public.aset_m_model_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_penerimaan_aset_details aset_tr_penerimaan_line_pabrikan_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penerimaan_aset_details
    ADD CONSTRAINT aset_tr_penerimaan_line_pabrikan_fk FOREIGN KEY (tenant_id, pabrikan_aset_id) REFERENCES public.aset_m_pabrikan_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_penerimaan_aset_details aset_tr_penerimaan_line_pp_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penerimaan_aset_details
    ADD CONSTRAINT aset_tr_penerimaan_line_pp_fk FOREIGN KEY (tenant_id, permintaan_pembelian_detail_id) REFERENCES public.aset_tr_permintaan_pengadaan_aset_details(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_penerimaan_aset aset_tr_penerimaan_lokasi_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penerimaan_aset
    ADD CONSTRAINT aset_tr_penerimaan_lokasi_fk FOREIGN KEY (tenant_id, lokasi_aset_id) REFERENCES public.aset_m_lokasi_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_penyesuaian_nilai_aset aset_tr_penyesuaian_nilai_buku_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penyesuaian_nilai_aset
    ADD CONSTRAINT aset_tr_penyesuaian_nilai_buku_fk FOREIGN KEY (tenant_id, buku_id) REFERENCES public.aset_m_buku_penyusutan(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_penyesuaian_nilai_aset_details aset_tr_penyesuaian_nilai_line_aset_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penyesuaian_nilai_aset_details
    ADD CONSTRAINT aset_tr_penyesuaian_nilai_line_aset_fk FOREIGN KEY (tenant_id, aset_id) REFERENCES public.aset_tr_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_penyesuaian_nilai_aset_details aset_tr_penyesuaian_nilai_line_header_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penyesuaian_nilai_aset_details
    ADD CONSTRAINT aset_tr_penyesuaian_nilai_line_header_fk FOREIGN KEY (tenant_id, penyesuaian_nilai_aset_id) REFERENCES public.aset_tr_penyesuaian_nilai_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_permintaan_pemeliharaan aset_tr_permintaan_pml_aset_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_permintaan_pemeliharaan
    ADD CONSTRAINT aset_tr_permintaan_pml_aset_fk FOREIGN KEY (tenant_id, aset_id) REFERENCES public.aset_tr_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_permintaan_pemeliharaan aset_tr_permintaan_pml_jenis_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_permintaan_pemeliharaan
    ADD CONSTRAINT aset_tr_permintaan_pml_jenis_fk FOREIGN KEY (tenant_id, jenis_permintaan_id) REFERENCES public.aset_m_jenis_permintaan_pemeliharaan(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_permintaan_pemeliharaan aset_tr_permintaan_pml_layanan_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_permintaan_pemeliharaan
    ADD CONSTRAINT aset_tr_permintaan_pml_layanan_fk FOREIGN KEY (tenant_id, tingkat_layanan_id) REFERENCES public.aset_m_tingkat_layanan(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_permintaan_pemeliharaan aset_tr_permintaan_pml_lokasi_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_permintaan_pemeliharaan
    ADD CONSTRAINT aset_tr_permintaan_pml_lokasi_fk FOREIGN KEY (tenant_id, lokasi_aset_id) REFERENCES public.aset_m_lokasi_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_permintaan_pemeliharaan aset_tr_permintaan_pml_sebab_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_permintaan_pemeliharaan
    ADD CONSTRAINT aset_tr_permintaan_pml_sebab_fk FOREIGN KEY (tenant_id, sebab_kerusakan_id) REFERENCES public.aset_m_sebab_kerusakan(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_permintaan_pemeliharaan aset_tr_permintaan_pml_wo_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_permintaan_pemeliharaan
    ADD CONSTRAINT aset_tr_permintaan_pml_wo_fk FOREIGN KEY (tenant_id, pemeliharaan_aset_id) REFERENCES public.aset_tr_pemeliharaan_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_pertanggungan_asuransi aset_tr_pertanggungan_aset_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pertanggungan_asuransi
    ADD CONSTRAINT aset_tr_pertanggungan_aset_fk FOREIGN KEY (tenant_id, aset_id) REFERENCES public.aset_tr_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_pertanggungan_asuransi aset_tr_pertanggungan_polis_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pertanggungan_asuransi
    ADD CONSTRAINT aset_tr_pertanggungan_polis_fk FOREIGN KEY (tenant_id, polis_asuransi_id) REFERENCES public.aset_m_polis_asuransi(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_reklasifikasi_aset_buku aset_tr_reklasifikasi_buku_asal_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_reklasifikasi_aset_buku
    ADD CONSTRAINT aset_tr_reklasifikasi_buku_asal_fk FOREIGN KEY (tenant_id, buku_aset_asal_id) REFERENCES public.aset_tr_buku_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_reklasifikasi_aset_buku aset_tr_reklasifikasi_buku_line_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_reklasifikasi_aset_buku
    ADD CONSTRAINT aset_tr_reklasifikasi_buku_line_fk FOREIGN KEY (tenant_id, reklasifikasi_aset_detail_id) REFERENCES public.aset_tr_reklasifikasi_aset_details(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_reklasifikasi_aset_buku aset_tr_reklasifikasi_buku_tujuan_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_reklasifikasi_aset_buku
    ADD CONSTRAINT aset_tr_reklasifikasi_buku_tujuan_fk FOREIGN KEY (tenant_id, buku_aset_tujuan_id) REFERENCES public.aset_tr_buku_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_reklasifikasi_aset_details aset_tr_reklasifikasi_line_aset_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_reklasifikasi_aset_details
    ADD CONSTRAINT aset_tr_reklasifikasi_line_aset_fk FOREIGN KEY (tenant_id, aset_id) REFERENCES public.aset_tr_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_reklasifikasi_aset_details aset_tr_reklasifikasi_line_baru_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_reklasifikasi_aset_details
    ADD CONSTRAINT aset_tr_reklasifikasi_line_baru_fk FOREIGN KEY (tenant_id, aset_baru_id) REFERENCES public.aset_tr_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_reklasifikasi_aset_details aset_tr_reklasifikasi_line_header_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_reklasifikasi_aset_details
    ADD CONSTRAINT aset_tr_reklasifikasi_line_header_fk FOREIGN KEY (tenant_id, reklasifikasi_aset_id) REFERENCES public.aset_tr_reklasifikasi_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_reklasifikasi_aset_details aset_tr_reklasifikasi_line_tujuan_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_reklasifikasi_aset_details
    ADD CONSTRAINT aset_tr_reklasifikasi_line_tujuan_fk FOREIGN KEY (tenant_id, group_aset_tujuan_id) REFERENCES public.aset_m_group_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_perencanaan_aset_details asset_plan_line_funding_source_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_perencanaan_aset_details
    ADD CONSTRAINT asset_plan_line_funding_source_fk FOREIGN KEY (tenant_id, funding_source_id) REFERENCES public.funding_sources(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_perencanaan_aset asset_plan_planning_year_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_perencanaan_aset
    ADD CONSTRAINT asset_plan_planning_year_fk FOREIGN KEY (tenant_id, legal_entity_id, planning_year_id) REFERENCES public.planning_years(tenant_id, legal_entity_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_perencanaan_aset_details asset_plan_selected_asset_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_perencanaan_aset_details
    ADD CONSTRAINT asset_plan_selected_asset_fk FOREIGN KEY (tenant_id, planned_asset_id) REFERENCES public.aset_tr_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_buku_penyusutan m_buku_penyusutan_tenant_id_alternative_profile_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_buku_penyusutan
    ADD CONSTRAINT m_buku_penyusutan_tenant_id_alternative_profile_id_foreign FOREIGN KEY (tenant_id, alternative_profile_id) REFERENCES public.aset_m_profil_penyusutan(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_buku_penyusutan m_buku_penyusutan_tenant_id_depreciation_profile_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_buku_penyusutan
    ADD CONSTRAINT m_buku_penyusutan_tenant_id_depreciation_profile_id_foreign FOREIGN KEY (tenant_id, depreciation_profile_id) REFERENCES public.aset_m_profil_penyusutan(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_group_aset m_group_aset_tenant_id_asset_location_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_group_aset
    ADD CONSTRAINT m_group_aset_tenant_id_asset_location_id_foreign FOREIGN KEY (tenant_id, lokasi_aset_id) REFERENCES public.aset_m_lokasi_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_group_aset m_group_aset_tenant_id_kelompok_harta_fiskal_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_group_aset
    ADD CONSTRAINT m_group_aset_tenant_id_kelompok_harta_fiskal_id_foreign FOREIGN KEY (tenant_id, kelompok_harta_fiskal_id) REFERENCES public.aset_m_kelompok_harta_fiskal(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_group_buku_penyusutan m_group_buku_penyusutan_tenant_id_alternative_profile_id_foreig; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_group_buku_penyusutan
    ADD CONSTRAINT m_group_buku_penyusutan_tenant_id_alternative_profile_id_foreig FOREIGN KEY (tenant_id, alternative_profile_id) REFERENCES public.aset_m_profil_penyusutan(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_group_buku_penyusutan m_group_buku_penyusutan_tenant_id_buku_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_group_buku_penyusutan
    ADD CONSTRAINT m_group_buku_penyusutan_tenant_id_buku_id_foreign FOREIGN KEY (tenant_id, buku_id) REFERENCES public.aset_m_buku_penyusutan(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_group_buku_penyusutan m_group_buku_penyusutan_tenant_id_depreciation_profile_id_forei; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_group_buku_penyusutan
    ADD CONSTRAINT m_group_buku_penyusutan_tenant_id_depreciation_profile_id_forei FOREIGN KEY (tenant_id, depreciation_profile_id) REFERENCES public.aset_m_profil_penyusutan(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_group_buku_penyusutan m_group_buku_penyusutan_tenant_id_group_aset_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_group_buku_penyusutan
    ADD CONSTRAINT m_group_buku_penyusutan_tenant_id_group_aset_id_foreign FOREIGN KEY (tenant_id, group_aset_id) REFERENCES public.aset_m_group_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_jenis_aset_atribut m_jenis_aset_atribut_tenant_id_jenis_aset_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_jenis_aset_atribut
    ADD CONSTRAINT m_jenis_aset_atribut_tenant_id_jenis_aset_id_foreign FOREIGN KEY (tenant_id, jenis_aset_id) REFERENCES public.aset_m_jenis_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_jenis_aset_atribut m_jenis_aset_atribut_tenant_id_tipe_atribut_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_jenis_aset_atribut
    ADD CONSTRAINT m_jenis_aset_atribut_tenant_id_tipe_atribut_id_foreign FOREIGN KEY (tenant_id, tipe_atribut_id) REFERENCES public.aset_m_tipe_atribut(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_lokasi_aset m_lokasi_aset_tenant_id_parent_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_lokasi_aset
    ADD CONSTRAINT m_lokasi_aset_tenant_id_parent_id_foreign FOREIGN KEY (tenant_id, parent_id) REFERENCES public.aset_m_lokasi_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_lokasi_aset m_lokasi_aset_tenant_id_tipe_lokasi_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_lokasi_aset
    ADD CONSTRAINT m_lokasi_aset_tenant_id_tipe_lokasi_id_foreign FOREIGN KEY (tenant_id, tipe_lokasi_id) REFERENCES public.aset_m_tipe_lokasi_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_maintenance_job_type_default m_mnt_default_asset_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_job_type_default
    ADD CONSTRAINT m_mnt_default_asset_fk FOREIGN KEY (tenant_id, aset_id) REFERENCES public.aset_tr_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_maintenance_job_type_default m_mnt_default_asset_type_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_job_type_default
    ADD CONSTRAINT m_mnt_default_asset_type_fk FOREIGN KEY (tenant_id, jenis_aset_id) REFERENCES public.aset_m_jenis_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_maintenance_job_type_default m_mnt_default_checklist_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_job_type_default
    ADD CONSTRAINT m_mnt_default_checklist_fk FOREIGN KEY (tenant_id, checklist_template_id) REFERENCES public.aset_m_maintenance_checklist_template(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_maintenance_job_type_default m_mnt_default_job_type_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_job_type_default
    ADD CONSTRAINT m_mnt_default_job_type_fk FOREIGN KEY (tenant_id, maintenance_job_type_id) REFERENCES public.aset_m_maintenance_job_type(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_maintenance_job_type_default m_mnt_default_location_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_job_type_default
    ADD CONSTRAINT m_mnt_default_location_fk FOREIGN KEY (tenant_id, functional_location_id) REFERENCES public.aset_m_lokasi_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_maintenance_job_type_default m_mnt_default_manufacturer_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_job_type_default
    ADD CONSTRAINT m_mnt_default_manufacturer_fk FOREIGN KEY (tenant_id, pabrikan_aset_id) REFERENCES public.aset_m_pabrikan_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_maintenance_job_type_default m_mnt_default_model_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_job_type_default
    ADD CONSTRAINT m_mnt_default_model_fk FOREIGN KEY (tenant_id, model_aset_id) REFERENCES public.aset_m_model_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_maintenance_job_type_default m_mnt_default_variant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_job_type_default
    ADD CONSTRAINT m_mnt_default_variant_fk FOREIGN KEY (tenant_id, variant_id) REFERENCES public.aset_m_maintenance_job_type_variant(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_maintenance_job_type_jenis_aset m_mnt_job_asset_type_asset_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_job_type_jenis_aset
    ADD CONSTRAINT m_mnt_job_asset_type_asset_fk FOREIGN KEY (tenant_id, jenis_aset_id) REFERENCES public.aset_m_jenis_aset(tenant_id, id) ON DELETE CASCADE;


--
-- Name: aset_m_maintenance_job_type_jenis_aset m_mnt_job_asset_type_job_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_job_type_jenis_aset
    ADD CONSTRAINT m_mnt_job_asset_type_job_fk FOREIGN KEY (tenant_id, job_type_id) REFERENCES public.aset_m_maintenance_job_type(tenant_id, id) ON DELETE CASCADE;


--
-- Name: aset_m_maintenance_job_type_variant m_mnt_job_variant_job_type_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_job_type_variant
    ADD CONSTRAINT m_mnt_job_variant_job_type_fk FOREIGN KEY (tenant_id, maintenance_job_type_id) REFERENCES public.aset_m_maintenance_job_type(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_maintenance_checklist_template_line m_mnt_tpl_line_nested_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_checklist_template_line
    ADD CONSTRAINT m_mnt_tpl_line_nested_fk FOREIGN KEY (tenant_id, nested_template_id) REFERENCES public.aset_m_maintenance_checklist_template(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_maintenance_checklist_template_line m_mnt_tpl_line_template_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_checklist_template_line
    ADD CONSTRAINT m_mnt_tpl_line_template_fk FOREIGN KEY (tenant_id, template_id) REFERENCES public.aset_m_maintenance_checklist_template(tenant_id, id) ON DELETE CASCADE;


--
-- Name: aset_m_maintenance_checklist_template_line m_mnt_tpl_line_variable_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_checklist_template_line
    ADD CONSTRAINT m_mnt_tpl_line_variable_fk FOREIGN KEY (tenant_id, variable_id) REFERENCES public.aset_m_maintenance_checklist_variable(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_maintenance_checklist_variable_value m_mnt_var_value_variable_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_maintenance_checklist_variable_value
    ADD CONSTRAINT m_mnt_var_value_variable_fk FOREIGN KEY (tenant_id, variable_id) REFERENCES public.aset_m_maintenance_checklist_variable(tenant_id, id) ON DELETE CASCADE;


--
-- Name: aset_m_model_aset m_model_aset_tenant_id_jenis_aset_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_model_aset
    ADD CONSTRAINT m_model_aset_tenant_id_jenis_aset_id_foreign FOREIGN KEY (tenant_id, jenis_aset_id) REFERENCES public.aset_m_jenis_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_model_aset m_model_aset_tenant_id_pabrikan_aset_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_model_aset
    ADD CONSTRAINT m_model_aset_tenant_id_pabrikan_aset_id_foreign FOREIGN KEY (tenant_id, pabrikan_aset_id) REFERENCES public.aset_m_pabrikan_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_m_tipe_atribut_nilai m_tipe_atribut_nilai_tenant_id_tipe_atribut_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_m_tipe_atribut_nilai
    ADD CONSTRAINT m_tipe_atribut_nilai_tenant_id_tipe_atribut_id_foreign FOREIGN KEY (tenant_id, tipe_atribut_id) REFERENCES public.aset_m_tipe_atribut(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_penempatan_aset t_aset_penempatan_tenant_id_asset_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penempatan_aset
    ADD CONSTRAINT t_aset_penempatan_tenant_id_asset_id_foreign FOREIGN KEY (tenant_id, aset_id) REFERENCES public.aset_tr_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_penempatan_aset t_aset_penempatan_tenant_id_asset_location_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penempatan_aset
    ADD CONSTRAINT t_aset_penempatan_tenant_id_asset_location_id_foreign FOREIGN KEY (tenant_id, lokasi_aset_id) REFERENCES public.aset_m_lokasi_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_aset t_aset_tenant_id_asset_location_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_aset
    ADD CONSTRAINT t_aset_tenant_id_asset_location_id_foreign FOREIGN KEY (tenant_id, lokasi_aset_id) REFERENCES public.aset_m_lokasi_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_aset t_aset_tenant_id_group_aset_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_aset
    ADD CONSTRAINT t_aset_tenant_id_group_aset_id_foreign FOREIGN KEY (tenant_id, group_aset_id) REFERENCES public.aset_m_group_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_aset t_aset_tenant_id_jenis_aset_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_aset
    ADD CONSTRAINT t_aset_tenant_id_jenis_aset_id_foreign FOREIGN KEY (tenant_id, jenis_aset_id) REFERENCES public.aset_m_jenis_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_aset t_aset_tenant_id_kondisi_aset_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_aset
    ADD CONSTRAINT t_aset_tenant_id_kondisi_aset_id_foreign FOREIGN KEY (tenant_id, kondisi_aset_id) REFERENCES public.aset_m_kondisi_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_aset t_aset_tenant_id_model_aset_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_aset
    ADD CONSTRAINT t_aset_tenant_id_model_aset_id_foreign FOREIGN KEY (tenant_id, model_aset_id) REFERENCES public.aset_m_model_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_aset t_aset_tenant_id_pabrikan_aset_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_aset
    ADD CONSTRAINT t_aset_tenant_id_pabrikan_aset_id_foreign FOREIGN KEY (tenant_id, pabrikan_aset_id) REFERENCES public.aset_m_pabrikan_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_aset t_aset_tenant_id_parent_asset_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_aset
    ADD CONSTRAINT t_aset_tenant_id_parent_asset_id_foreign FOREIGN KEY (tenant_id, induk_aset_id) REFERENCES public.aset_tr_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_buku_aset t_buku_aset_tenant_id_asset_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_buku_aset
    ADD CONSTRAINT t_buku_aset_tenant_id_asset_id_foreign FOREIGN KEY (tenant_id, aset_id) REFERENCES public.aset_tr_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_buku_aset t_buku_aset_tenant_id_depreciation_profile_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_buku_aset
    ADD CONSTRAINT t_buku_aset_tenant_id_depreciation_profile_id_foreign FOREIGN KEY (tenant_id, depreciation_profile_id) REFERENCES public.aset_m_profil_penyusutan(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_dokumen_siklus_aset t_dokumen_siklus_aset_tenant_id_asset_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_dokumen_siklus_aset
    ADD CONSTRAINT t_dokumen_siklus_aset_tenant_id_asset_id_foreign FOREIGN KEY (tenant_id, aset_id) REFERENCES public.aset_tr_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_export_penyusutan t_export_penyusutan_tenant_id_depreciation_period_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_export_penyusutan
    ADD CONSTRAINT t_export_penyusutan_tenant_id_depreciation_period_id_foreign FOREIGN KEY (tenant_id, depreciation_period_id) REFERENCES public.aset_tr_penyusutan_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_penyusutan_aset t_penyusutan_periode_tenant_id_asset_book_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_penyusutan_aset
    ADD CONSTRAINT t_penyusutan_periode_tenant_id_asset_book_id_foreign FOREIGN KEY (tenant_id, buku_aset_id) REFERENCES public.aset_tr_buku_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_aset_atribut tr_aset_atribut_tenant_id_asset_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_aset_atribut
    ADD CONSTRAINT tr_aset_atribut_tenant_id_asset_id_foreign FOREIGN KEY (tenant_id, aset_id) REFERENCES public.aset_tr_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_aset_atribut tr_aset_atribut_tenant_id_tipe_atribut_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_aset_atribut
    ADD CONSTRAINT tr_aset_atribut_tenant_id_tipe_atribut_id_foreign FOREIGN KEY (tenant_id, tipe_atribut_id) REFERENCES public.aset_m_tipe_atribut(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_aset_atribut tr_aset_atribut_tenant_id_tipe_atribut_nilai_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_aset_atribut
    ADD CONSTRAINT tr_aset_atribut_tenant_id_tipe_atribut_nilai_id_foreign FOREIGN KEY (tenant_id, tipe_atribut_nilai_id) REFERENCES public.aset_m_tipe_atribut_nilai(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_buku_aset tr_buku_aset_tenant_id_alternative_profile_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_buku_aset
    ADD CONSTRAINT tr_buku_aset_tenant_id_alternative_profile_id_foreign FOREIGN KEY (tenant_id, alternative_profile_id) REFERENCES public.aset_m_profil_penyusutan(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_buku_aset tr_buku_aset_tenant_id_buku_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_buku_aset
    ADD CONSTRAINT tr_buku_aset_tenant_id_buku_id_foreign FOREIGN KEY (tenant_id, buku_id) REFERENCES public.aset_m_buku_penyusutan(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_aset tr_penerimaan_aset_tenant_id_kelompok_harta_fiskal_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_aset
    ADD CONSTRAINT tr_penerimaan_aset_tenant_id_kelompok_harta_fiskal_id_foreign FOREIGN KEY (tenant_id, kelompok_harta_fiskal_id) REFERENCES public.aset_m_kelompok_harta_fiskal(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_perencanaan_aset_details tr_perencanaan_aset_details_tenant_id_jenis_aset_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_perencanaan_aset_details
    ADD CONSTRAINT tr_perencanaan_aset_details_tenant_id_jenis_aset_id_foreign FOREIGN KEY (tenant_id, jenis_aset_id) REFERENCES public.aset_m_jenis_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_perencanaan_aset_details tr_perencanaan_aset_details_tenant_id_planning_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_perencanaan_aset_details
    ADD CONSTRAINT tr_perencanaan_aset_details_tenant_id_planning_id_foreign FOREIGN KEY (tenant_id, planning_id) REFERENCES public.aset_tr_perencanaan_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_permintaan_pengadaan_aset_details tr_permintaan_pengadaan_aset_details_tenant_id_jenis_aset_id_fo; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_permintaan_pengadaan_aset_details
    ADD CONSTRAINT tr_permintaan_pengadaan_aset_details_tenant_id_jenis_aset_id_fo FOREIGN KEY (tenant_id, jenis_aset_id) REFERENCES public.aset_m_jenis_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_permintaan_pengadaan_aset_details tr_permintaan_pengadaan_aset_details_tenant_id_request_id_forei; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_permintaan_pengadaan_aset_details
    ADD CONSTRAINT tr_permintaan_pengadaan_aset_details_tenant_id_request_id_forei FOREIGN KEY (tenant_id, request_id) REFERENCES public.aset_tr_permintaan_pengadaan_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_pemeliharaan_aset_checklist tr_wo_check_job_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pemeliharaan_aset_checklist
    ADD CONSTRAINT tr_wo_check_job_fk FOREIGN KEY (tenant_id, pemeliharaan_aset_detail_id) REFERENCES public.aset_tr_pemeliharaan_aset_details(tenant_id, id) ON DELETE CASCADE;


--
-- Name: aset_tr_pemeliharaan_aset_details tr_wo_job_asset_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pemeliharaan_aset_details
    ADD CONSTRAINT tr_wo_job_asset_fk FOREIGN KEY (tenant_id, aset_id) REFERENCES public.aset_tr_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_pemeliharaan_aset_details tr_wo_job_header_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pemeliharaan_aset_details
    ADD CONSTRAINT tr_wo_job_header_fk FOREIGN KEY (tenant_id, pemeliharaan_aset_id) REFERENCES public.aset_tr_pemeliharaan_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_pemeliharaan_aset_details tr_wo_job_location_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pemeliharaan_aset_details
    ADD CONSTRAINT tr_wo_job_location_fk FOREIGN KEY (tenant_id, lokasi_aset_id) REFERENCES public.aset_m_lokasi_aset(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_pemeliharaan_aset_details tr_wo_job_sebab_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pemeliharaan_aset_details
    ADD CONSTRAINT tr_wo_job_sebab_fk FOREIGN KEY (tenant_id, sebab_kerusakan_id) REFERENCES public.aset_m_sebab_kerusakan(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_pemeliharaan_aset_details tr_wo_job_tindakan_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pemeliharaan_aset_details
    ADD CONSTRAINT tr_wo_job_tindakan_fk FOREIGN KEY (tenant_id, tindakan_perbaikan_id) REFERENCES public.aset_m_tindakan_perbaikan(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_pemeliharaan_aset_details tr_wo_job_trade_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pemeliharaan_aset_details
    ADD CONSTRAINT tr_wo_job_trade_fk FOREIGN KEY (tenant_id, trade_id) REFERENCES public.aset_m_trade(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_pemeliharaan_aset_details tr_wo_job_type_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pemeliharaan_aset_details
    ADD CONSTRAINT tr_wo_job_type_fk FOREIGN KEY (tenant_id, maintenance_job_type_id) REFERENCES public.aset_m_maintenance_job_type(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_pemeliharaan_aset_details tr_wo_job_variant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pemeliharaan_aset_details
    ADD CONSTRAINT tr_wo_job_variant_fk FOREIGN KEY (tenant_id, variant_id) REFERENCES public.aset_m_maintenance_job_type_variant(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_pemeliharaan_aset tr_wo_layanan_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pemeliharaan_aset
    ADD CONSTRAINT tr_wo_layanan_fk FOREIGN KEY (tenant_id, tingkat_layanan_id) REFERENCES public.aset_m_tingkat_layanan(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: aset_tr_pemeliharaan_aset_status_log tr_wo_log_header_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pemeliharaan_aset_status_log
    ADD CONSTRAINT tr_wo_log_header_fk FOREIGN KEY (tenant_id, pemeliharaan_aset_id) REFERENCES public.aset_tr_pemeliharaan_aset(tenant_id, id) ON DELETE CASCADE;


--
-- Name: aset_tr_pemeliharaan_aset tr_wo_tipe_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aset_tr_pemeliharaan_aset
    ADD CONSTRAINT tr_wo_tipe_fk FOREIGN KEY (tenant_id, tipe_work_order_id) REFERENCES public.aset_m_tipe_work_order(tenant_id, id) ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--


