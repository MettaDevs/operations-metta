-- Skema CoreERP pada commit 6b3cf584 tanpa objek module aset: keluaran pg_restore --schema-only --no-owner
-- --no-privileges dari seed CoreERP. Dua perubahan: baris \restrict dan \unrestrict dibuang karena keduanya perintah
-- psql, bukan SQL, dan setiap entri milik tabel aset_ (tabel, index, constraint, foreign key, trigger) serta function
-- aset_ pindah ke modules/asset-management/database/migrations/0001_baseline.sql.

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
-- Name: coreerp_bump_row_version(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.coreerp_bump_row_version() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Argumen trigger: kolom aktivitas mesin. Yang berubah hanya kolom itu: versi tetap.
    IF TG_NARGS > 0 AND to_jsonb(NEW) <> to_jsonb(OLD)
       AND (to_jsonb(NEW) - TG_ARGV) = (to_jsonb(OLD) - TG_ARGV) THEN
        NEW.version := OLD.version;
    ELSE
        NEW.version := OLD.version + 1;
    END IF;
    RETURN NEW;
END
$$;


--
-- Name: coreerp_forbid_change_log_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.coreerp_forbid_change_log_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'Entri log perubahan tidak dapat diubah.';
END
$$;


--
-- Name: coreerp_log_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.coreerp_log_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    tenant text;
    source text;
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
        SELECT r.tenant_id::text INTO tenant FROM roles r WHERE r.id = role_ref;
    ELSIF TG_TABLE_NAME = 'security_duty_privileges' THEN
        IF TG_OP = 'DELETE' THEN code_ref := OLD.duty_code; ELSE code_ref := NEW.duty_code; END IF;
        SELECT d.tenant_id::text INTO tenant FROM security_duties d WHERE d.code = code_ref;
    ELSIF TG_TABLE_NAME = 'security_privilege_permissions' THEN
        IF TG_OP = 'DELETE' THEN code_ref := OLD.privilege_code; ELSE code_ref := NEW.privilege_code; END IF;
        SELECT p.tenant_id::text INTO tenant FROM security_privileges p WHERE p.code = code_ref;
    ELSIF TG_OP = 'DELETE' THEN
        tenant := OLD.tenant_id::text;
    ELSE
        tenant := NEW.tenant_id::text;
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


--
-- Name: coreerp_stamp_audit_actor(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.coreerp_stamp_audit_actor() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    actor bigint := NULLIF(current_setting('coreerp.user_id', true), '')::bigint;
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.created_by_user_id := COALESCE(actor, NEW.created_by_user_id);
        NEW.updated_by_user_id := COALESCE(actor, NEW.updated_by_user_id, NEW.created_by_user_id);
    ELSE
        NEW.created_by_user_id := OLD.created_by_user_id;
        NEW.updated_by_user_id := actor;
    END IF;
    RETURN NEW;
END
$$;


--
-- Name: operator_audit_events_tolak_ubah(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.operator_audit_events_tolak_ubah() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'operator_audit_events hanya boleh ditambah, tidak diubah atau dihapus';
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: access_audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.access_audit_events (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    membership_id character(26),
    action character varying(100) NOT NULL,
    payload json NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: address_books; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.address_books (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    name character varying(120) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: analytics_dashboards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_dashboards (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    user_id bigint NOT NULL,
    name character varying(80) NOT NULL,
    description text,
    shared boolean DEFAULT false NOT NULL,
    layout jsonb DEFAULT '[]'::jsonb NOT NULL,
    slicers jsonb DEFAULT '[]'::jsonb NOT NULL,
    template_code character varying(160),
    template_version integer,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: analytics_query_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_query_cache (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    cache_key character(64) NOT NULL,
    dataset_code character varying(160) NOT NULL,
    payload bytea NOT NULL,
    size_bytes integer NOT NULL,
    expires_at timestamp(0) without time zone NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: analytics_query_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_query_log (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    principal character varying(120) NOT NULL,
    source character varying(20) NOT NULL,
    dataset_code character varying(160) NOT NULL,
    dataset_version integer,
    query_hash character(64) NOT NULL,
    query jsonb NOT NULL,
    status character varying(12) NOT NULL,
    error_code character varying(60),
    duration_ms integer NOT NULL,
    row_count integer,
    truncated boolean DEFAULT false NOT NULL,
    cached boolean DEFAULT false NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT analytics_query_log_status_check CHECK (((status)::text = ANY ((ARRAY['success'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: analytics_saved_queries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_saved_queries (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    user_id bigint NOT NULL,
    code character varying(80) NOT NULL,
    name character varying(120) NOT NULL,
    description text,
    shared boolean DEFAULT false NOT NULL,
    dataset_code character varying(160) NOT NULL,
    dataset_version integer NOT NULL,
    query jsonb NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: analytics_widgets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_widgets (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    dashboard_id character(26) NOT NULL,
    title character varying(120) NOT NULL,
    type character varying(20) NOT NULL,
    dataset_code character varying(160),
    dataset_version integer,
    query jsonb,
    visual jsonb DEFAULT '{}'::jsonb NOT NULL,
    cache_ttl_seconds integer,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: app_data_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_data_policies (
    code character varying(160) NOT NULL,
    app_id character varying(80) NOT NULL,
    name character varying(150) NOT NULL,
    protected_permissions json NOT NULL,
    requires_legal_entity boolean DEFAULT false NOT NULL,
    requires_operating_unit boolean DEFAULT false NOT NULL,
    allows_descendants boolean DEFAULT false NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: app_dependencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_dependencies (
    app_id character varying(80) NOT NULL,
    depends_on_app_id character varying(80) NOT NULL,
    version_range character varying(40) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: app_entry_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_entry_points (
    code character varying(160) NOT NULL,
    app_id character varying(80) NOT NULL,
    name character varying(255) NOT NULL,
    type character varying(30) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: app_installations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_installations (
    id character(26) NOT NULL,
    app_placement_id character(26) NOT NULL,
    operation character varying(20) NOT NULL,
    release_version character varying(40) NOT NULL,
    status character varying(20) NOT NULL,
    failure_stage character varying(30),
    failure_message character varying(500),
    started_at timestamp(0) without time zone NOT NULL,
    finished_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: app_number_sequence_references; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_number_sequence_references (
    id character(26) NOT NULL,
    app_id character varying(80) NOT NULL,
    code character varying(160) NOT NULL,
    name character varying(150) NOT NULL,
    allowed_scopes json NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    default_prefix character varying(10),
    default_settings jsonb
);


--
-- Name: app_placements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_placements (
    id character(26) NOT NULL,
    app_id character varying(80) NOT NULL,
    release_version character varying(40) NOT NULL,
    profile character varying(30) NOT NULL,
    placement character varying(120) NOT NULL,
    artifact_status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    migration_status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    runtime_status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    ready_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: app_releases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_releases (
    id character(26) NOT NULL,
    app_id character varying(80) NOT NULL,
    version character varying(40) NOT NULL,
    manifest_sha256 character(64) NOT NULL,
    bundle_path character varying(255) NOT NULL,
    compose_file character varying(120) NOT NULL,
    compose_project character varying(120) NOT NULL,
    api_service character varying(120),
    ui_service character varying(120),
    database_service character varying(120),
    status character varying(20) DEFAULT 'available'::character varying NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    edition_image character varying(500) NOT NULL
);


--
-- Name: app_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_reports (
    id character(26) NOT NULL,
    app_id character varying(80) NOT NULL,
    code character varying(160) NOT NULL,
    name character varying(160) NOT NULL,
    description character varying(500),
    permission character varying(160) NOT NULL,
    parameters json NOT NULL,
    builtin_layouts json NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: app_service_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_service_credentials (
    id character(26) NOT NULL,
    app_id character varying(80) NOT NULL,
    name character varying(150) NOT NULL,
    secret_hash character varying(255),
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    last_used_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    tenant_id character(26),
    token_digest character varying(64),
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: apps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.apps (
    id character varying(80) NOT NULL,
    name character varying(255) NOT NULL,
    version character varying(40) NOT NULL,
    status character varying(20) NOT NULL,
    database_name character varying(255),
    description text,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    repository_url character varying(2048),
    contract_url character varying(2048),
    navigation jsonb,
    has_ui boolean DEFAULT false NOT NULL
);


--
-- Name: automatic_role_assignment_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automatic_role_assignment_rules (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    role_id character(26) NOT NULL,
    position_id character(26) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    policy_code character varying(255),
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cache (
    key character varying(255) NOT NULL,
    value text NOT NULL,
    expiration bigint NOT NULL
);


--
-- Name: cache_locks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cache_locks (
    key character varying(255) NOT NULL,
    owner character varying(255) NOT NULL,
    expiration bigint NOT NULL
);


--
-- Name: change_log_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.change_log_entries (
    id bigint NOT NULL,
    tenant_id character(26) NOT NULL,
    changed_at timestamp(0) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    table_name character varying(100) NOT NULL,
    record_id character varying(191),
    field_name character varying(100) NOT NULL,
    change_type character varying(12) NOT NULL,
    old_value text,
    new_value text,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT change_log_entries_type_check CHECK (((change_type)::text = ANY ((ARRAY['insertion'::character varying, 'modification'::character varying, 'deletion'::character varying])::text[])))
);


--
-- Name: change_log_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.change_log_entries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: change_log_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.change_log_entries_id_seq OWNED BY public.change_log_entries.id;


--
-- Name: change_log_setup_fields; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.change_log_setup_fields (
    id character(26) NOT NULL,
    tenant_id character(26),
    table_name character varying(100) NOT NULL,
    field_name character varying(100) NOT NULL,
    field_caption character varying(150),
    log_insertion boolean DEFAULT false NOT NULL,
    log_modification boolean DEFAULT false NOT NULL,
    log_deletion boolean DEFAULT false NOT NULL,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: change_log_setup_tables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.change_log_setup_tables (
    id character(26) NOT NULL,
    tenant_id character(26),
    table_name character varying(100) NOT NULL,
    table_caption character varying(150),
    log_insertion character varying(10) DEFAULT 'none'::character varying NOT NULL,
    log_modification character varying(10) DEFAULT 'none'::character varying NOT NULL,
    log_deletion character varying(10) DEFAULT 'none'::character varying NOT NULL,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT change_log_setup_tables_mode_check CHECK ((((log_insertion)::text = ANY ((ARRAY['none'::character varying, 'some'::character varying, 'all'::character varying])::text[])) AND ((log_modification)::text = ANY ((ARRAY['none'::character varying, 'some'::character varying, 'all'::character varying])::text[])) AND ((log_deletion)::text = ANY ((ARRAY['none'::character varying, 'some'::character varying, 'all'::character varying])::text[]))))
);


--
-- Name: clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clients (
    id character(26) NOT NULL,
    legal_name character varying(255) NOT NULL,
    slug character varying(255) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: console_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.console_settings (
    key character varying(80) NOT NULL,
    value text NOT NULL,
    updated_at timestamp(0) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint
);


--
-- Name: core_module_installations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.core_module_installations (
    tenant_id character(26) NOT NULL,
    module_id character varying(100) NOT NULL,
    version character varying(50) NOT NULL,
    status character varying(20) DEFAULT 'installed'::character varying NOT NULL,
    seeded_at timestamp(0) with time zone,
    installed_at timestamp(0) with time zone NOT NULL,
    disabled_at timestamp(0) with time zone,
    uninstalled_at timestamp(0) with time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    CONSTRAINT core_module_installations_status_check CHECK (((status)::text = ANY ((ARRAY['installed'::character varying, 'disabled'::character varying, 'uninstalled'::character varying])::text[])))
);


--
-- Name: core_module_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.core_module_migrations (
    id integer NOT NULL,
    module_id character varying(100) NOT NULL,
    migration character varying(255) NOT NULL,
    batch integer NOT NULL
);


--
-- Name: core_module_migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.core_module_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: core_module_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.core_module_migrations_id_seq OWNED BY public.core_module_migrations.id;


--
-- Name: country_regions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.country_regions (
    code character(2) NOT NULL,
    iso3 character(3),
    name character varying(100) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    phone_code character varying(10),
    timezone character varying(50),
    active boolean DEFAULT true NOT NULL
);


--
-- Name: currency_precisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.currency_precisions (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    currency_code character(3) NOT NULL,
    amount_decimals smallint NOT NULL,
    unit_amount_decimals smallint NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT currency_precisions_range_check CHECK ((((amount_decimals >= 0) AND (amount_decimals <= 4)) AND ((unit_amount_decimals >= 0) AND (unit_amount_decimals <= 6)) AND (unit_amount_decimals >= amount_decimals)))
);


--
-- Name: document_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_attachments (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    record_type character varying(64) NOT NULL,
    record_id character varying(64) NOT NULL,
    line_number integer,
    file_name character varying(250) NOT NULL,
    mime_type character varying(150) NOT NULL,
    size_bytes bigint NOT NULL,
    storage_path character varying(300) NOT NULL,
    content_hash character(64) NOT NULL,
    data_class character varying(40) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    kind character varying(16) DEFAULT 'document'::character varying NOT NULL,
    CONSTRAINT document_attachments_kind_check CHECK ((((kind)::text = ANY ((ARRAY['document'::character varying, 'picture'::character varying])::text[])) AND (((kind)::text <> 'picture'::text) OR (line_number IS NULL))))
);


--
-- Name: document_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_notes (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    record_type character varying(64) NOT NULL,
    record_id character varying(64) NOT NULL,
    content text NOT NULL,
    data_class character varying(40) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: electronic_addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.electronic_addresses (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    type character varying(20) NOT NULL,
    value character varying(250) NOT NULL,
    purpose character varying(30),
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    location_id character(26) NOT NULL,
    deleted_at timestamp(0) without time zone,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: environment_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.environment_members (
    environment_id character(26) NOT NULL,
    user_id bigint NOT NULL,
    status character varying(20) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT environment_members_status_dikenal CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'suspended'::character varying])::text[])))
);


--
-- Name: environment_operations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.environment_operations (
    id character(26) NOT NULL,
    environment_id character(26) NOT NULL,
    operation character varying(30) NOT NULL,
    status character varying(20) NOT NULL,
    requested_by bigint,
    source_environment_id character(26),
    step character varying(60),
    failure_message text,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    started_at timestamp(0) without time zone NOT NULL,
    finished_at timestamp(0) without time zone,
    lease_until timestamp(0) without time zone,
    CONSTRAINT environment_operations_berjalan_bertenggat CHECK ((((status)::text <> 'running'::text) OR (lease_until IS NOT NULL))),
    CONSTRAINT environment_operations_gagal_beralasan CHECK ((((status)::text <> 'failed'::text) OR (failure_message IS NOT NULL))),
    CONSTRAINT environment_operations_jenis_dikenal CHECK (((operation)::text = ANY ((ARRAY['provision'::character varying, 'copy'::character varying, 'migrate'::character varying, 'convert'::character varying, 'disarm'::character varying, 'suspend'::character varying, 'resume'::character varying, 'soft_delete'::character varying, 'restore'::character varying, 'purge'::character varying, 'expire'::character varying])::text[]))),
    CONSTRAINT environment_operations_selesai_sejalan CHECK ((((status)::text = 'running'::text) = (finished_at IS NULL))),
    CONSTRAINT environment_operations_status_dikenal CHECK (((status)::text = ANY ((ARRAY['running'::character varying, 'succeeded'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: environments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.environments (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    kind character varying(20) NOT NULL,
    name character varying(100) NOT NULL,
    slug character varying(120) NOT NULL,
    database_name character varying(63),
    status character varying(20) NOT NULL,
    source_environment_id character(26),
    copied_at timestamp(0) without time zone,
    expires_at timestamp(0) without time zone,
    outbound_allowed boolean NOT NULL,
    schema_migrated_at timestamp(0) without time zone,
    schema_fingerprint character varying(255),
    deleted_at timestamp(0) without time zone,
    purge_after timestamp(0) without time zone,
    created_by bigint,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    purged_at timestamp(0) without time zone,
    hosting character varying(20) DEFAULT 'provider'::character varying NOT NULL,
    CONSTRAINT environments_buang_sesudah_hapus_lunak CHECK (((purged_at IS NULL) OR (deleted_at IS NOT NULL))),
    CONSTRAINT environments_demo_berakhir CHECK ((((kind)::text <> 'demo'::text) OR (expires_at IS NOT NULL))),
    CONSTRAINT environments_hapus_berpasangan CHECK (((deleted_at IS NULL) = (purge_after IS NULL))),
    CONSTRAINT environments_hosting_dikenal CHECK (((hosting)::text = ANY ((ARRAY['provider'::character varying, 'client_server'::character varying])::text[]))),
    CONSTRAINT environments_keluar_ikut_jenis CHECK ((outbound_allowed = ((kind)::text = 'production'::text))),
    CONSTRAINT environments_kind_dikenal CHECK (((kind)::text = ANY ((ARRAY['production'::character varying, 'sandbox'::character varying, 'demo'::character varying])::text[]))),
    CONSTRAINT environments_produksi_tidak_dibuang CHECK (((purged_at IS NULL) OR ((kind)::text <> 'production'::text))),
    CONSTRAINT environments_server_klien_hanya_produksi CHECK ((((hosting)::text = 'provider'::text) OR (((kind)::text = 'production'::text) AND (database_name IS NULL)))),
    CONSTRAINT environments_status_dikenal CHECK (((status)::text = ANY ((ARRAY['provisioning'::character varying, 'copying'::character varying, 'active'::character varying, 'maintenance'::character varying, 'degraded'::character varying, 'suspended'::character varying, 'soft_deleted'::character varying])::text[]))),
    CONSTRAINT environments_status_hapus_sejalan CHECK ((((status)::text = 'soft_deleted'::text) = (deleted_at IS NOT NULL))),
    CONSTRAINT environments_sumber_hanya_sandbox CHECK (((source_environment_id IS NULL) OR ((kind)::text = 'sandbox'::text)))
);


--
-- Name: external_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_identities (
    id character(26) NOT NULL,
    user_id bigint NOT NULL,
    issuer character varying(255) NOT NULL,
    subject character varying(255) NOT NULL,
    email_at_link character varying(255),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone
);


--
-- Name: failed_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.failed_jobs (
    id bigint NOT NULL,
    uuid character varying(255) NOT NULL,
    connection character varying(255) NOT NULL,
    queue character varying(255) NOT NULL,
    payload text NOT NULL,
    exception text NOT NULL,
    failed_at timestamp(0) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: failed_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.failed_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: failed_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.failed_jobs_id_seq OWNED BY public.failed_jobs.id;


--
-- Name: finance_posting_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_posting_deliveries (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    finance_posting_id character(26) NOT NULL,
    integration_client_id character(26) NOT NULL,
    status character varying(20) NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    first_attempt_at timestamp(0) without time zone,
    last_attempt_at timestamp(0) without time zone,
    next_attempt_at timestamp(0) without time zone,
    last_status_code smallint,
    last_error character varying(500),
    delivered_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT finance_posting_deliveries_status_check CHECK (((status)::text = ANY ((ARRAY['retrying'::character varying, 'delivered'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: finance_posting_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_posting_events (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    finance_posting_id character(26) NOT NULL,
    event character varying(40) NOT NULL,
    from_status character varying(20),
    to_status character varying(20),
    integration_client_id character(26),
    user_id bigint,
    data json,
    created_at timestamp(0) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: finance_posting_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_posting_lines (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    finance_posting_id character(26) NOT NULL,
    line_no smallint NOT NULL,
    account_id character(26),
    account_external_id character varying(64),
    account_code character varying(50),
    debit numeric(24,6) DEFAULT '0'::numeric NOT NULL,
    credit numeric(24,6) DEFAULT '0'::numeric NOT NULL,
    description character varying(255),
    org_unit_id character(26),
    business_unit_code character varying(30),
    department_code character varying(30),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT finance_posting_lines_one_side_check CHECK (((debit >= (0)::numeric) AND (credit >= (0)::numeric) AND ((debit = (0)::numeric) <> (credit = (0)::numeric))))
);


--
-- Name: finance_posting_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_posting_settings (
    legal_entity_id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    cutover_date date,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT finance_posting_settings_enabled_needs_cutover CHECK (((NOT enabled) OR (cutover_date IS NOT NULL)))
);


--
-- Name: finance_postings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_postings (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    legal_entity_id character(26) NOT NULL,
    posting_id character varying(120) NOT NULL,
    posting_type character varying(80) NOT NULL,
    contract_version smallint DEFAULT '1'::smallint NOT NULL,
    source_module character varying(80) NOT NULL,
    source_type character varying(80) NOT NULL,
    source_number character varying(80),
    source_id character varying(64),
    currency_code character(3) NOT NULL,
    currency_decimals smallint NOT NULL,
    posting_date date NOT NULL,
    document_date date NOT NULL,
    occurred_at timestamp(0) without time zone NOT NULL,
    published_at timestamp(0) without time zone NOT NULL,
    settlement_mode character varying(20),
    status character varying(20) NOT NULL,
    manual_reason character varying(30),
    hold_reasons json,
    vendor_id character(26),
    reverses_posting_id character varying(120),
    adjusts_posting_id character varying(120),
    total_debit numeric(24,6) NOT NULL,
    total_credit numeric(24,6) NOT NULL,
    payload jsonb NOT NULL,
    input jsonb NOT NULL,
    input_hash character(64) NOT NULL,
    external_reference character varying(120),
    reason_code character varying(40),
    reason text,
    acknowledged_at timestamp(0) without time zone,
    acknowledged_by_client_id character(26),
    served_count integer DEFAULT 0 NOT NULL,
    last_served_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT finance_postings_balanced_check CHECK (((total_debit = total_credit) AND (total_debit > (0)::numeric))),
    CONSTRAINT finance_postings_manual_reason_check CHECK (((((status)::text = 'manual'::text) = (manual_reason IS NOT NULL)) AND ((manual_reason IS NULL) OR ((manual_reason)::text = ANY ((ARRAY['before_cutover'::character varying, 'feed_disabled'::character varying, 'user'::character varying])::text[]))))),
    CONSTRAINT finance_postings_posted_reference_check CHECK ((((status)::text <> 'posted'::text) OR (external_reference IS NOT NULL))),
    CONSTRAINT finance_postings_rejected_reason_check CHECK ((((status)::text <> 'rejected'::text) OR (reason_code IS NOT NULL))),
    CONSTRAINT finance_postings_status_check CHECK (((status)::text = ANY ((ARRAY['held'::character varying, 'pending'::character varying, 'posted'::character varying, 'rejected'::character varying, 'manual'::character varying])::text[])))
);


--
-- Name: finance_reference_account_imports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_reference_account_imports (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    legal_entity_id character(26),
    file_name character varying(255) NOT NULL,
    imported_by_user_id character varying(64),
    status character varying(20) NOT NULL,
    created_count integer DEFAULT 0 NOT NULL,
    updated_count integer DEFAULT 0 NOT NULL,
    unchanged_count integer DEFAULT 0 NOT NULL,
    missing_count integer DEFAULT 0 NOT NULL,
    rejected_count integer DEFAULT 0 NOT NULL,
    rejected_rows json,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT finance_reference_account_imports_status_check CHECK (((status)::text = ANY ((ARRAY['applied'::character varying, 'rejected'::character varying])::text[])))
);


--
-- Name: finance_reference_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_reference_accounts (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    legal_entity_id character(26),
    external_id character varying(64) NOT NULL,
    code character varying(50) NOT NULL,
    name character varying(200) NOT NULL,
    type character varying(20) NOT NULL,
    active boolean DEFAULT true NOT NULL,
    synced_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT finance_reference_accounts_type_check CHECK (((type)::text = ANY ((ARRAY['balance_sheet'::character varying, 'profit_loss'::character varying])::text[])))
);


--
-- Name: finance_settlement_modes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_settlement_modes (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    legal_entity_id character(26) NOT NULL,
    mode character varying(20) NOT NULL,
    effective_from date NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT finance_settlement_modes_mode_check CHECK (((mode)::text = ANY ((ARRAY['direct_payable'::character varying, 'clearing'::character varying])::text[])))
);


--
-- Name: fiscal_calendars; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fiscal_calendars (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    code character varying(50) NOT NULL,
    name character varying(150) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: fiscal_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fiscal_periods (
    id character(26) NOT NULL,
    fiscal_year_id character(26) NOT NULL,
    ordinal smallint NOT NULL,
    name character varying(40) NOT NULL,
    starts_on date NOT NULL,
    ends_on date NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: fiscal_years; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fiscal_years (
    id character(26) NOT NULL,
    fiscal_calendar_id character(26) NOT NULL,
    name character varying(40) NOT NULL,
    starts_on date NOT NULL,
    ends_on date NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: funding_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.funding_sources (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    code character varying(50),
    name character varying(250) NOT NULL,
    active boolean DEFAULT true NOT NULL,
    creation_key character varying(154),
    creation_payload_hash character varying(64),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    description text
);


--
-- Name: hierarchy_purpose_organization_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hierarchy_purpose_organization_types (
    purpose_id character(26) NOT NULL,
    organization_type character varying(40) NOT NULL
);


--
-- Name: hierarchy_purposes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hierarchy_purposes (
    id character(26) NOT NULL,
    code character varying(60) NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: integration_clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integration_clients (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    name character varying(120) NOT NULL,
    token_digest character varying(64) NOT NULL,
    scopes json NOT NULL,
    allowed_ips json,
    posting_type_prefixes json,
    delivery_mode character varying(10) DEFAULT 'pull'::character varying NOT NULL,
    push_url character varying(500),
    signing_secret text,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    last_used_at timestamp(0) without time zone,
    last_pulled_at timestamp(0) without time zone,
    revoked_at timestamp(0) without time zone,
    created_by_user_id bigint,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    updated_by_user_id bigint,
    user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT integration_clients_mode_check CHECK (((delivery_mode)::text = ANY ((ARRAY['pull'::character varying, 'push'::character varying])::text[]))),
    CONSTRAINT integration_clients_push_check CHECK ((((delivery_mode)::text <> 'push'::text) OR (((push_url)::text ~~ 'https://%'::text) AND (signing_secret IS NOT NULL)))),
    CONSTRAINT integration_clients_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'revoked'::character varying])::text[])))
);


--
-- Name: integration_scopes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integration_scopes (
    code character varying(120) NOT NULL,
    name character varying(255) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone
);


--
-- Name: invitation_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitation_codes (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    code_hash character varying(64) NOT NULL,
    created_by bigint NOT NULL,
    expires_at timestamp(0) without time zone,
    revoked_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    code_ciphertext text,
    label character varying(120),
    sso_issuer character varying(255),
    sso_subject character varying(255),
    sso_email_at_invite character varying(255),
    sso_name_at_invite character varying(255),
    sso_checked_at timestamp(0) without time zone,
    sso_notified_at timestamp(0) without time zone,
    sso_redeemed_at timestamp(0) without time zone,
    sso_redeemed_by bigint,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT undangan_sso_tertukar_hanya_bila_terikat CHECK (((sso_redeemed_at IS NULL) OR (sso_subject IS NOT NULL))),
    CONSTRAINT undangan_sso_tertukar_lengkap CHECK (((sso_redeemed_at IS NULL) = (sso_redeemed_by IS NULL))),
    CONSTRAINT undangan_sso_utuh CHECK ((((sso_issuer IS NULL) AND (sso_subject IS NULL) AND (sso_email_at_invite IS NULL)) OR ((sso_issuer IS NOT NULL) AND (sso_subject IS NOT NULL) AND (sso_email_at_invite IS NOT NULL))))
);


--
-- Name: invitation_data_policy_scopes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitation_data_policy_scopes (
    id character(26) NOT NULL,
    invitation_id character(26) NOT NULL,
    role_id character(26) NOT NULL,
    policy_code character varying(255) NOT NULL,
    legal_entity_id character(26),
    organization_id character(26),
    hierarchy_id character(26),
    hierarchy_version_id character(26),
    include_descendants boolean DEFAULT false NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: invitation_role_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitation_role_assignments (
    invitation_id character(26) NOT NULL,
    role_id character(26) NOT NULL
);


--
-- Name: job_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_batches (
    id character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    total_jobs integer NOT NULL,
    pending_jobs integer NOT NULL,
    failed_jobs integer NOT NULL,
    failed_job_ids text NOT NULL,
    options text,
    cancelled_at integer,
    created_at integer NOT NULL,
    finished_at integer
);


--
-- Name: jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jobs (
    id bigint NOT NULL,
    queue character varying(255) NOT NULL,
    payload text NOT NULL,
    attempts smallint NOT NULL,
    reserved_at integer,
    available_at integer NOT NULL,
    created_at integer NOT NULL
);


--
-- Name: jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.jobs_id_seq OWNED BY public.jobs.id;


--
-- Name: legal_entities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legal_entities (
    organization_id character(26) NOT NULL,
    company_code character varying(50) NOT NULL,
    country_code character(2) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    tenant_id character(26),
    fiscal_calendar_id character(26),
    created_by_user_id bigint,
    updated_by_user_id bigint,
    timezone character varying(40) DEFAULT 'Asia/Jakarta'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: location_purposes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.location_purposes (
    code character varying(30) NOT NULL,
    name character varying(60) NOT NULL,
    sort_order smallint NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.locations (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    name character varying(120) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    owner_party_id character(26)
);


--
-- Name: managed_product_tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.managed_product_tenants (
    id uuid NOT NULL,
    product character varying(60) NOT NULL,
    profile character varying(60) NOT NULL,
    name character varying(150) NOT NULL,
    slug character varying(63) NOT NULL,
    owner_name character varying(100) NOT NULL,
    owner_email character varying(250) NOT NULL,
    idempotency_key uuid NOT NULL,
    request_hash character varying(64) NOT NULL,
    release jsonb NOT NULL,
    status character varying(20) DEFAULT 'queued'::character varying NOT NULL,
    public_url text,
    failure_message text,
    lease_until timestamp(0) without time zone,
    expires_at timestamp(0) without time zone,
    requested_by bigint,
    retry_requested boolean DEFAULT false NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    owner_customer_id uuid,
    pending_sso_revocation jsonb,
    CONSTRAINT managed_product_tenants_status CHECK (((status)::text = ANY ((ARRAY['queued'::character varying, 'provisioning'::character varying, 'ready'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.migrations (
    id integer NOT NULL,
    migration character varying(255) NOT NULL,
    batch integer NOT NULL
);


--
-- Name: migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.migrations_id_seq OWNED BY public.migrations.id;


--
-- Name: number_sequence_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.number_sequence_allocations (
    id character(26) NOT NULL,
    sequence_id character(26) NOT NULL,
    scope_key character varying(180) NOT NULL,
    period_key character varying(40) DEFAULT 'all'::character varying NOT NULL,
    first_number bigint NOT NULL,
    last_number bigint NOT NULL,
    next_number bigint NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: number_sequence_audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.number_sequence_audit_events (
    id character(26) NOT NULL,
    sequence_id character(26) NOT NULL,
    app_id character varying(80),
    user_id bigint,
    event_type character varying(40) NOT NULL,
    formatted_value character varying(255),
    details json,
    occurred_at timestamp(0) without time zone NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: number_sequence_continuous_pool; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.number_sequence_continuous_pool (
    sequence_id character(26) NOT NULL,
    scope_key character varying(180) NOT NULL,
    period_key character varying(40) DEFAULT 'all'::character varying NOT NULL,
    numeric_value bigint NOT NULL,
    status character varying(30) DEFAULT 'available'::character varying NOT NULL,
    reservation_id character(26),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: number_sequence_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.number_sequence_counters (
    id character(26) NOT NULL,
    sequence_id character(26) NOT NULL,
    scope_key character varying(180) NOT NULL,
    period_key character varying(40) DEFAULT 'all'::character varying NOT NULL,
    next_number bigint DEFAULT '1'::bigint NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: number_sequence_issues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.number_sequence_issues (
    id character(26) NOT NULL,
    sequence_id character(26) NOT NULL,
    app_id character varying(80) NOT NULL,
    scope_key character varying(180) NOT NULL,
    period_key character varying(40) DEFAULT 'all'::character varying NOT NULL,
    numeric_value bigint,
    formatted_value character varying(255) NOT NULL,
    idempotency_key character varying(160) NOT NULL,
    is_manual boolean DEFAULT false NOT NULL,
    issued_at timestamp(0) without time zone NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: number_sequence_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.number_sequence_profiles (
    code character varying(80) NOT NULL,
    name character varying(150) NOT NULL,
    is_continuous boolean DEFAULT false NOT NULL,
    allow_manual boolean DEFAULT false NOT NULL,
    preallocation_enabled boolean DEFAULT true NOT NULL,
    preallocation_quantity smallint DEFAULT '20'::smallint NOT NULL,
    segments json NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: number_sequence_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.number_sequence_reservations (
    id character(26) NOT NULL,
    sequence_id character(26) NOT NULL,
    app_id character varying(80) NOT NULL,
    scope_key character varying(180) NOT NULL,
    period_key character varying(40) DEFAULT 'all'::character varying NOT NULL,
    numeric_value bigint NOT NULL,
    formatted_value character varying(255) NOT NULL,
    idempotency_key character varying(160) NOT NULL,
    status character varying(30) DEFAULT 'reserved'::character varying NOT NULL,
    expires_at timestamp(0) without time zone,
    confirmed_at timestamp(0) without time zone,
    cancelled_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: number_sequence_reusable_numbers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.number_sequence_reusable_numbers (
    sequence_id character(26) NOT NULL,
    scope_key character varying(180) NOT NULL,
    period_key character varying(40) DEFAULT 'all'::character varying NOT NULL,
    numeric_value bigint NOT NULL
);


--
-- Name: operating_units; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operating_units (
    organization_id character(26) NOT NULL,
    type character varying(40) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    tenant_id character(26),
    number character varying(30),
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: operator_audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operator_audit_events (
    id character(26) NOT NULL,
    user_id bigint,
    action character varying(60) NOT NULL,
    subject_type character varying(40) NOT NULL,
    subject_id character varying(40),
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    ip_address character varying(45),
    occurred_at timestamp(0) without time zone NOT NULL
);


--
-- Name: organization_hierarchies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_hierarchies (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    name character varying(255) NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: organization_hierarchy_closures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_hierarchy_closures (
    version_id character(26) NOT NULL,
    ancestor_organization_id character(26) NOT NULL,
    descendant_organization_id character(26) NOT NULL,
    distance integer NOT NULL
);


--
-- Name: organization_hierarchy_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_hierarchy_nodes (
    id character(26) NOT NULL,
    version_id character(26) NOT NULL,
    organization_id character(26) NOT NULL,
    parent_node_id character(26),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: organization_hierarchy_purposes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_hierarchy_purposes (
    hierarchy_id character(26) NOT NULL,
    purpose_id character(26) NOT NULL
);


--
-- Name: organization_hierarchy_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_hierarchy_versions (
    id character(26) NOT NULL,
    hierarchy_id character(26) NOT NULL,
    version_number integer NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    effective_from timestamp(0) without time zone NOT NULL,
    published_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: organization_parties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_parties (
    organization_id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    party_id character(26) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    name character varying(255) NOT NULL,
    classification character varying(30) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: outbox_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbox_events (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    type character varying(120) NOT NULL,
    payload json NOT NULL,
    occurred_at timestamp(0) without time zone NOT NULL,
    published_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    correlation_id character(26),
    legal_entity_id character(26),
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: parties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parties (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    type character varying(20) NOT NULL,
    name character varying(200) NOT NULL,
    search_name character varying(200) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(0) without time zone,
    number character varying(40),
    creation_key character varying(160),
    known_as character varying(200),
    language character varying(200),
    personal_title character varying(200),
    personal_suffix character varying(200),
    first_name character varying(200),
    middle_name character varying(200),
    last_name character varying(200),
    initials character varying(200),
    professional_title character varying(200),
    professional_suffix character varying(200),
    gender character varying(200),
    marital_status character varying(200),
    organization_number character varying(200),
    duns_number character varying(200),
    abc_code character varying(200),
    birth_date date,
    anniversary_date date,
    number_of_children integer,
    number_of_employees integer,
    interests text,
    memo text,
    tax_number character varying(32)
);


--
-- Name: party_address_books; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.party_address_books (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    party_id character(26) NOT NULL,
    address_book_id character(26) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: party_location_purposes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.party_location_purposes (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    party_location_id character(26) NOT NULL,
    purpose_code character varying(30) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: party_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.party_locations (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    party_id character(26) NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    valid_from date,
    valid_to date,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    location_id character(26) NOT NULL,
    deleted_at timestamp(0) without time zone,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: party_reference_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.party_reference_values (
    category character varying(40) NOT NULL,
    code character varying(40) NOT NULL,
    name character varying(120) NOT NULL
);


--
-- Name: party_relationship_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.party_relationship_types (
    code character varying(40) NOT NULL,
    name character varying(120) NOT NULL,
    inverse_name character varying(120) NOT NULL,
    from_type character varying(20) NOT NULL,
    to_type character varying(20) NOT NULL
);


--
-- Name: party_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.party_relationships (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    from_party_id character(26) NOT NULL,
    to_party_id character(26) NOT NULL,
    relationship_type_code character varying(40) NOT NULL,
    valid_from date NOT NULL,
    valid_to date,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT party_relationships_dates CHECK (((valid_to IS NULL) OR (valid_to >= valid_from))),
    CONSTRAINT party_relationships_distinct_parties CHECK ((from_party_id <> to_party_id))
);


--
-- Name: party_role_registrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.party_role_registrations (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    party_id character(26) NOT NULL,
    role_code character varying(40) NOT NULL,
    legal_entity_id character(26) NOT NULL,
    owning_app_id character varying(80) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: party_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.party_types (
    code character varying(32) NOT NULL,
    name character varying(100) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: passkeys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.passkeys (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    name character varying(255) NOT NULL,
    credential_id character varying(255) NOT NULL,
    credential json NOT NULL,
    last_used_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: passkeys_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.passkeys_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: passkeys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.passkeys_id_seq OWNED BY public.passkeys.id;


--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_reset_tokens (
    email character varying(255) NOT NULL,
    token character varying(255) NOT NULL,
    created_at timestamp(0) without time zone
);


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    code character varying(160) NOT NULL,
    app_id character varying(80) NOT NULL,
    entry_point_code character varying(160) NOT NULL,
    access_level character varying(30) NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: planning_years; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.planning_years (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    legal_entity_id character(26) NOT NULL,
    year smallint NOT NULL,
    active boolean DEFAULT true NOT NULL,
    creation_key character varying(154),
    creation_payload_hash character varying(64),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: postal_addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.postal_addresses (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    location_id character(26) NOT NULL,
    country_region_code character(2) NOT NULL,
    province character varying(100),
    city character varying(100),
    district character varying(100),
    street character varying(250),
    building character varying(120),
    postbox character varying(60),
    postal_code character varying(20),
    formatted character varying(600) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    village character varying(100),
    rt character varying(3),
    rw character varying(3),
    province_id character(26),
    regency_id character(26),
    district_id character(26),
    village_id character(26),
    postal_code_id character(26)
);


--
-- Name: print_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.print_identities (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    organization_id character(26) NOT NULL,
    display_name character varying(200),
    parent_lines json NOT NULL,
    tax_id character varying(60),
    registration_id character varying(60),
    footer_text text,
    logos json NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: product_auth_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_auth_attempts (
    state_hash character varying(64) NOT NULL,
    id uuid NOT NULL,
    browser_challenge character varying(64) NOT NULL,
    nonce character varying(128) NOT NULL,
    code_verifier text NOT NULL,
    expires_at timestamp(0) with time zone NOT NULL,
    consumed_at timestamp(0) with time zone,
    created_at timestamp(0) with time zone,
    updated_at timestamp(0) with time zone,
    deleted_at timestamp(0) with time zone
);


--
-- Name: product_customer_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_customer_sessions (
    token_hash character varying(64) NOT NULL,
    customer_id uuid NOT NULL,
    expires_at timestamp(0) with time zone NOT NULL,
    revoked_at timestamp(0) with time zone,
    created_at timestamp(0) with time zone,
    updated_at timestamp(0) with time zone,
    deleted_at timestamp(0) with time zone
);


--
-- Name: product_customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_customers (
    id uuid NOT NULL,
    identity_hash character varying(64) NOT NULL,
    issuer text NOT NULL,
    subject character varying(255) NOT NULL,
    name character varying(100) NOT NULL,
    email character varying(250),
    verified_email character varying(250),
    email_verified_at timestamp(0) with time zone,
    created_at timestamp(0) with time zone,
    updated_at timestamp(0) with time zone,
    deleted_at timestamp(0) with time zone,
    user_id bigint
);


--
-- Name: product_email_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_email_challenges (
    token_hash character varying(64) NOT NULL,
    customer_id uuid NOT NULL,
    email character varying(250) NOT NULL,
    expires_at timestamp(0) with time zone NOT NULL,
    consumed_at timestamp(0) with time zone,
    created_at timestamp(0) with time zone,
    updated_at timestamp(0) with time zone,
    deleted_at timestamp(0) with time zone
);


--
-- Name: provider_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_access (
    user_id bigint NOT NULL,
    role character varying(30) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: ref_address_parameters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ref_address_parameters (
    country_code character(2) NOT NULL,
    use_province boolean DEFAULT true NOT NULL,
    use_regency boolean DEFAULT true NOT NULL,
    use_district boolean DEFAULT true NOT NULL,
    use_village boolean DEFAULT true NOT NULL,
    use_rt_rw boolean DEFAULT true NOT NULL,
    use_postal_code boolean DEFAULT true NOT NULL,
    use_building boolean DEFAULT true NOT NULL,
    address_format character varying(500),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: ref_administrative_division_external_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ref_administrative_division_external_codes (
    id character(26) NOT NULL,
    division_id character varying(50) NOT NULL,
    system character varying(50) NOT NULL,
    external_code character varying(100) NOT NULL,
    description character varying(255),
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: ref_administrative_division_timezones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ref_administrative_division_timezones (
    id character(26) NOT NULL,
    division_type character varying(30) NOT NULL,
    division_id character varying(40) NOT NULL,
    timezone character varying(100) NOT NULL,
    is_default boolean DEFAULT true NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: ref_administrative_division_translations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ref_administrative_division_translations (
    id character(26) NOT NULL,
    division_id character varying(50) NOT NULL,
    locale character varying(10) NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: ref_administrative_divisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ref_administrative_divisions (
    id character(26) NOT NULL,
    country_id character(2) NOT NULL,
    parent_id character(26),
    level smallint NOT NULL,
    type character varying(30) NOT NULL,
    official_code character varying(50) NOT NULL,
    name character varying(255) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    lineage json,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    display_code character varying(50)
);


--
-- Name: ref_buildings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ref_buildings (
    id character(26) NOT NULL,
    tenant_id character varying(36),
    village_id character(26) NOT NULL,
    street_id character(26),
    name character varying(200) NOT NULL,
    unit character varying(50),
    floor character varying(20),
    block character varying(20),
    active boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    postal_code character varying(10),
    postal_code_id character(26),
    override_postal_code boolean DEFAULT false NOT NULL,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: ref_countries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ref_countries (
    code character varying(3) NOT NULL,
    iso3 character varying(3),
    name character varying(100) NOT NULL,
    phone_code character varying(10),
    active boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    timezone character varying(50) DEFAULT 'UTC+07:00'::character varying NOT NULL
);


--
-- Name: ref_country_hierarchy_levels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ref_country_hierarchy_levels (
    id character(26) NOT NULL,
    country_code character(2) NOT NULL,
    level smallint NOT NULL,
    level_code character varying(30) NOT NULL,
    level_name character varying(100) NOT NULL,
    description character varying(255),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: ref_districts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ref_districts (
    id character(26) NOT NULL,
    tenant_id character varying(36),
    regency_id character(26) NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(150) NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    display_code character varying(50),
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: ref_group_of_houses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ref_group_of_houses (
    id character(26) NOT NULL,
    tenant_id character varying(36),
    village_id character(26) NOT NULL,
    code character varying(30),
    name character varying(200) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    postal_code character varying(10),
    postal_code_id character(26),
    override_postal_code boolean DEFAULT false NOT NULL,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: ref_land_plots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ref_land_plots (
    id character(26) NOT NULL,
    tenant_id character varying(36),
    village_id character(26) NOT NULL,
    street_id character(26),
    group_of_houses_id character(26),
    plot_number character varying(50) NOT NULL,
    name character varying(200),
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    postal_code character varying(10),
    postal_code_id character(26),
    override_postal_code boolean DEFAULT false NOT NULL,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: ref_postal_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ref_postal_codes (
    id character(26) NOT NULL,
    tenant_id character varying(36),
    country_code character(2) DEFAULT 'ID'::character varying NOT NULL,
    postal_code character varying(10) NOT NULL,
    province_id character(26),
    regency_id character(26),
    district_id character(26),
    village_id character(26),
    active boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    area_name character varying(200),
    source character varying(100) DEFAULT 'POS_INDONESIA'::character varying NOT NULL,
    source_reference character varying(255),
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: ref_provinces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ref_provinces (
    id character(26) NOT NULL,
    tenant_id character varying(36),
    country_code character(2) NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(150) NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    timezone character varying(50) DEFAULT 'UTC+07:00'::character varying NOT NULL,
    intrastat character varying(50),
    it_state_code character varying(50),
    state_code character varying(50),
    default_state boolean DEFAULT false NOT NULL,
    union_territory boolean DEFAULT false NOT NULL,
    display_code character varying(50),
    description text,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: ref_regencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ref_regencies (
    id character(26) NOT NULL,
    tenant_id character varying(36),
    province_id character(26) NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(150) NOT NULL,
    type character varying(20) DEFAULT 'kabupaten'::character varying NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    it_county_code character varying(50),
    es_county_code character varying(50),
    display_code character varying(50),
    description text,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: ref_streets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ref_streets (
    id character(26) NOT NULL,
    tenant_id character varying(36),
    village_id character(26) NOT NULL,
    rt character varying(5),
    rw character varying(5),
    name character varying(200),
    active boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    postal_code character varying(10),
    postal_code_id character(26),
    override_postal_code boolean DEFAULT false NOT NULL,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: ref_villages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ref_villages (
    id character(26) NOT NULL,
    tenant_id character varying(36),
    district_id character(26) NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(150) NOT NULL,
    type character varying(20) DEFAULT 'kelurahan'::character varying NOT NULL,
    postal_code character varying(10),
    active boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    display_code character varying(50),
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: report_exports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_exports (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    membership_id character(26) NOT NULL,
    user_id bigint NOT NULL,
    legal_entity_id character(26),
    org_unit_id character(26),
    app_id character varying(80) NOT NULL,
    report_code character varying(160) NOT NULL,
    report_name character varying(160) NOT NULL,
    layout_ref character varying(60) NOT NULL,
    layout_name character varying(120) NOT NULL,
    format character varying(10) NOT NULL,
    parameters json NOT NULL,
    status character varying(20) DEFAULT 'queued'::character varying NOT NULL,
    progress smallint DEFAULT '0'::smallint NOT NULL,
    row_count integer,
    file_path character varying(255),
    file_name character varying(200),
    file_mime character varying(120),
    file_size bigint,
    failure_message text,
    started_at timestamp(0) without time zone,
    finished_at timestamp(0) without time zone,
    expires_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    kind character varying(20) DEFAULT 'layout'::character varying NOT NULL
);


--
-- Name: report_last_used_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_last_used_options (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    user_id bigint NOT NULL,
    report_code character varying(160) NOT NULL,
    parameters jsonb NOT NULL,
    format character varying(10),
    layout_ref character varying(60),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: report_layout_defaults; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_layout_defaults (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    legal_entity_id character(26),
    scope_key character varying(40) NOT NULL,
    report_code character varying(160) NOT NULL,
    layout_ref character varying(60) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: report_layouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_layouts (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    legal_entity_id character(26),
    report_code character varying(160) NOT NULL,
    name character varying(120) NOT NULL,
    description text,
    format character varying(10) NOT NULL,
    file_path character varying(255) NOT NULL,
    file_size integer NOT NULL,
    created_by_user_id bigint,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: report_presets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_presets (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    user_id bigint NOT NULL,
    report_code character varying(160) NOT NULL,
    name character varying(80) NOT NULL,
    shared boolean DEFAULT false NOT NULL,
    parameters jsonb NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: retention_policy_log_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retention_policy_log_entries (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    policy_code character varying(60) NOT NULL,
    deleted_count bigint DEFAULT '0'::bigint NOT NULL,
    cutoff_at timestamp(0) with time zone NOT NULL,
    status character varying(12) NOT NULL,
    message character varying(300),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT retention_policy_log_entries_status_check CHECK (((status)::text = ANY ((ARRAY['success'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: retention_policy_setups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retention_policy_setups (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    policy_code character varying(60) NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    retention_days integer,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: role_assignment_data_policy_scopes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_assignment_data_policy_scopes (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    role_assignment_id character(26) NOT NULL,
    policy_code character varying(160) NOT NULL,
    legal_entity_id character(26),
    organization_id character(26),
    hierarchy_id character(26),
    hierarchy_version_id character(26),
    include_descendants boolean DEFAULT false NOT NULL,
    valid_from timestamp(0) without time zone NOT NULL,
    valid_until timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: role_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_assignments (
    id character(26) NOT NULL,
    membership_id character(26) NOT NULL,
    role_id character(26) NOT NULL,
    source character varying(20) DEFAULT 'manual'::character varying NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    valid_from timestamp(0) without time zone NOT NULL,
    valid_until timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    source_reference character varying(255)
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    name character varying(255) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    is_owner boolean DEFAULT false NOT NULL,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: security_duties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_duties (
    code character varying(160) NOT NULL,
    app_id character varying(80),
    name character varying(255) NOT NULL,
    description text,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    tenant_id character(26),
    source character varying(20) DEFAULT 'manifest'::character varying NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    published_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: security_duty_privileges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_duty_privileges (
    duty_code character varying(160) NOT NULL,
    privilege_code character varying(160) NOT NULL
);


--
-- Name: security_privilege_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_privilege_permissions (
    privilege_code character varying(160) NOT NULL,
    permission_code character varying(160) NOT NULL
);


--
-- Name: security_privileges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_privileges (
    code character varying(160) NOT NULL,
    app_id character varying(80),
    name character varying(255) NOT NULL,
    description text,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    tenant_id character(26),
    source character varying(20) DEFAULT 'manifest'::character varying NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    published_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: security_role_children; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_role_children (
    tenant_id character(26) NOT NULL,
    parent_role_id character(26) NOT NULL,
    child_role_id character(26) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: security_role_duties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_role_duties (
    role_id character(26) NOT NULL,
    duty_code character varying(160) NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id character varying(255) NOT NULL,
    user_id bigint,
    ip_address character varying(45),
    user_agent text,
    payload text NOT NULL,
    last_activity integer NOT NULL
);


--
-- Name: site_enrollment_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_enrollment_tokens (
    id character(26) NOT NULL,
    site_id character(26) NOT NULL,
    token_hash character(64) NOT NULL,
    expires_at timestamp(0) without time zone NOT NULL,
    used_at timestamp(0) without time zone,
    created_by bigint,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: site_operations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_operations (
    id character(26) NOT NULL,
    site_id character(26) NOT NULL,
    operation character varying(30) NOT NULL,
    parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(20) NOT NULL,
    requested_by bigint,
    step character varying(120),
    failure_message text,
    requested_at timestamp(0) without time zone NOT NULL,
    expires_at timestamp(0) without time zone NOT NULL,
    started_at timestamp(0) without time zone,
    lease_until timestamp(0) without time zone,
    finished_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    registry_robot_id bigint,
    registry_robot_name character varying(255),
    CONSTRAINT site_operations_berjalan_bertenggat CHECK ((((status)::text <> 'running'::text) OR ((lease_until IS NOT NULL) AND (started_at IS NOT NULL)))),
    CONSTRAINT site_operations_gagal_beralasan CHECK ((((status)::text <> 'failed'::text) OR (failure_message IS NOT NULL))),
    CONSTRAINT site_operations_hash_sandi_hanya_saat_terbuka CHECK ((((status)::text = ANY ((ARRAY['requested'::character varying, 'running'::character varying])::text[])) OR (NOT (parameters ? 'admin_password_hash'::text)))),
    CONSTRAINT site_operations_jenis_dikenal CHECK (((operation)::text = ANY ((ARRAY['install'::character varying, 'upgrade'::character varying, 'backup'::character varying, 'install_license'::character varying, 'rotate_key'::character varying, 'send_diagnostics'::character varying])::text[]))),
    CONSTRAINT site_operations_robot_berpasangan CHECK (((registry_robot_id IS NULL) = (registry_robot_name IS NULL))),
    CONSTRAINT site_operations_robot_hanya_penarik CHECK (((registry_robot_id IS NULL) OR ((operation)::text = ANY ((ARRAY['install'::character varying, 'upgrade'::character varying])::text[])))),
    CONSTRAINT site_operations_selesai_sejalan CHECK ((((status)::text = ANY ((ARRAY['requested'::character varying, 'running'::character varying])::text[])) = (finished_at IS NULL))),
    CONSTRAINT site_operations_status_dikenal CHECK (((status)::text = ANY ((ARRAY['requested'::character varying, 'running'::character varying, 'succeeded'::character varying, 'failed'::character varying, 'cancelled'::character varying, 'expired'::character varying])::text[])))
);


--
-- Name: site_releases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_releases (
    id character(26) NOT NULL,
    edition character varying(80) NOT NULL,
    release character varying(40) NOT NULL,
    image character varying(255) NOT NULL,
    digest character varying(100) NOT NULL,
    manifest text NOT NULL,
    compose text NOT NULL,
    update_script text NOT NULL,
    checksums text NOT NULL,
    signature text NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: site_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_reports (
    id character(26) NOT NULL,
    site_id character(26) NOT NULL,
    payload jsonb NOT NULL,
    payload_hash character(64) NOT NULL,
    reported_at timestamp(0) without time zone NOT NULL,
    received_at timestamp(0) without time zone NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: sites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sites (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    name character varying(100) NOT NULL,
    profile character varying(30) NOT NULL,
    edition character varying(80) NOT NULL,
    address character varying(255),
    update_window_start time(0) without time zone,
    update_window_end time(0) without time zone,
    timezone character varying(40) DEFAULT 'Asia/Jakarta'::character varying NOT NULL,
    public_key text,
    enrolled_at timestamp(0) without time zone,
    revoked_at timestamp(0) without time zone,
    reported_edition character varying(80),
    reported_release character varying(40),
    reported_digest character varying(100),
    last_seen_at timestamp(0) without time zone,
    last_report jsonb,
    created_by bigint,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    environment_id character(26),
    license_issued_at timestamp(0) without time zone,
    license_valid_until date,
    license_suspended_at timestamp(0) without time zone,
    server_address character varying(255),
    last_seen_ip character varying(45),
    dns_record_id character varying(64),
    dns_name character varying(255),
    dns_target character varying(255),
    dns_synced_at timestamp(0) without time zone,
    license_perpetual boolean DEFAULT false NOT NULL,
    license_valid_days smallint,
    license_renew_before_days smallint,
    license_issued_perpetual boolean DEFAULT false NOT NULL,
    CONSTRAINT sites_alamat_server_polos CHECK (((server_address IS NULL) OR (((server_address)::text <> ''::text) AND ((server_address)::text = lower((server_address)::text)) AND ((server_address)::text !~ '[[:space:]/@]'::text)))),
    CONSTRAINT sites_dns_berpasangan CHECK ((((dns_record_id IS NULL) = (dns_name IS NULL)) AND ((dns_name IS NULL) = (dns_target IS NULL)) AND ((dns_target IS NULL) = (dns_synced_at IS NULL)))),
    CONSTRAINT sites_jendela_berpasangan CHECK (((update_window_start IS NULL) = (update_window_end IS NULL))),
    CONSTRAINT sites_kunci_berpasangan CHECK (((public_key IS NULL) = (enrolled_at IS NULL))),
    CONSTRAINT sites_lisensi_berpasangan CHECK ((((license_issued_at IS NULL) AND (license_valid_until IS NULL) AND (license_issued_perpetual = false)) OR ((license_issued_at IS NOT NULL) AND (license_valid_until IS NOT NULL) AND (license_issued_perpetual = false)) OR ((license_issued_at IS NOT NULL) AND (license_valid_until IS NULL) AND (license_issued_perpetual = true)))),
    CONSTRAINT sites_masa_lisensi_masuk_akal CHECK ((((license_valid_days IS NULL) OR ((license_valid_days >= 1) AND (license_valid_days <= 3650))) AND ((license_renew_before_days IS NULL) OR ((license_renew_before_days >= 1) AND (license_renew_before_days <= 365))) AND ((license_valid_days IS NULL) OR (license_renew_before_days IS NULL) OR (license_renew_before_days < license_valid_days)))),
    CONSTRAINT sites_profil_dikenal CHECK (((profile)::text = 'managed_on_prem'::text))
);


--
-- Name: sod_conflicts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sod_conflicts (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    membership_id character(26) NOT NULL,
    sod_rule_id character(26) NOT NULL,
    status character varying(20) NOT NULL,
    mitigation_note text,
    approved_by_membership_id character(26),
    approved_at timestamp(0) without time zone,
    valid_until timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: sod_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sod_rules (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    first_duty_code character varying(160) NOT NULL,
    second_duty_code character varying(160) NOT NULL,
    severity character varying(20) NOT NULL,
    risk text NOT NULL,
    allows_mitigation boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: sso_login_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sso_login_attempts (
    id character(26) NOT NULL,
    state_hash character varying(64) NOT NULL,
    browser_secret_hash character varying(64) NOT NULL,
    nonce character varying(64) NOT NULL,
    code_verifier text NOT NULL,
    tenant_id character(26) NOT NULL,
    environment_id character(26) NOT NULL,
    return_origin character varying(255) NOT NULL,
    redirect_uri character varying(255) NOT NULL,
    user_id bigint,
    link_user_id bigint,
    subject character varying(255),
    subject_email character varying(255),
    handoff_token_hash character varying(64),
    expires_at timestamp(0) without time zone NOT NULL,
    completed_at timestamp(0) without time zone,
    consumed_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    invitation_id character(26)
);


--
-- Name: tenant_app_entitlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_app_entitlements (
    id bigint NOT NULL,
    tenant_id character(26) NOT NULL,
    app_id character varying(80) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    starts_at timestamp(0) without time zone NOT NULL,
    ends_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: tenant_app_entitlements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tenant_app_entitlements_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenant_app_entitlements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tenant_app_entitlements_id_seq OWNED BY public.tenant_app_entitlements.id;


--
-- Name: tenant_creation_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_creation_requests (
    id character(26) NOT NULL,
    actor_scope character varying(100) NOT NULL,
    idempotency_key uuid NOT NULL,
    request_hash character varying(64) NOT NULL,
    actor_user_id bigint,
    principal_id bigint NOT NULL,
    tenant_id character(26) NOT NULL,
    membership_id character(26) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone
);


--
-- Name: tenant_deployments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_deployments (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    profile character varying(30) NOT NULL,
    placement character varying(120) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: tenant_identity_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_identity_providers (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    mode character varying(20) NOT NULL,
    protokol character varying(20),
    setelan jsonb DEFAULT '{}'::jsonb NOT NULL,
    domain_email jsonb DEFAULT '[]'::jsonb NOT NULL,
    aktif boolean DEFAULT false NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT tenant_idp_aktif_bukan_lokal CHECK (((aktif = false) OR ((mode)::text <> 'lokal'::text))),
    CONSTRAINT tenant_idp_mode_dikenal CHECK (((mode)::text = ANY ((ARRAY['lokal'::character varying, 'bersama'::character varying, 'sendiri'::character varying])::text[]))),
    CONSTRAINT tenant_idp_protokol_dikenal CHECK (((protokol IS NULL) OR ((protokol)::text = ANY ((ARRAY['oidc'::character varying, 'saml'::character varying])::text[])))),
    CONSTRAINT tenant_idp_sendiri_berprotokol CHECK ((((mode)::text <> 'sendiri'::text) OR (protokol IS NOT NULL)))
);


--
-- Name: tenant_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_memberships (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    user_id bigint NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: tenant_number_sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_number_sequences (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    reference_id character(26) NOT NULL,
    profile_code character varying(80) NOT NULL,
    scope_type character varying(30) DEFAULT 'tenant'::character varying NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    is_continuous boolean DEFAULT false NOT NULL,
    allow_manual boolean DEFAULT false NOT NULL,
    preallocation_enabled boolean DEFAULT true NOT NULL,
    preallocation_quantity smallint DEFAULT '20'::smallint NOT NULL,
    minimum_number bigint DEFAULT '1'::bigint NOT NULL,
    maximum_number bigint,
    segments json NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    reset_period character varying(20) DEFAULT 'never'::character varying NOT NULL,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    allow_automatic boolean DEFAULT true NOT NULL
);


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenants (
    id character(26) NOT NULL,
    client_id character(26) NOT NULL,
    name character varying(255) NOT NULL,
    slug character varying(255) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: time_zones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.time_zones (
    id character varying(36) NOT NULL,
    iana_name character varying(100) NOT NULL,
    display_name character varying(150) NOT NULL,
    utc_offset character varying(10) NOT NULL,
    country_code character(2) NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: units_of_measure; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.units_of_measure (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    uom_class_id character(26) NOT NULL,
    uom_system_id character(26),
    code character varying(50) NOT NULL,
    name character varying(150) NOT NULL,
    symbol character varying(30),
    decimal_places smallint DEFAULT '2'::smallint NOT NULL,
    active boolean DEFAULT true NOT NULL,
    deleted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: uom_classes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.uom_classes (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    code character varying(50) NOT NULL,
    name character varying(150) NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: uom_conversions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.uom_conversions (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    from_unit_id character(26) NOT NULL,
    to_unit_id character(26) NOT NULL,
    factor numeric(28,12) NOT NULL,
    "offset" numeric(28,12) DEFAULT '0'::numeric NOT NULL,
    rounding_scale smallint,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: uom_external_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.uom_external_codes (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    unit_id character(26) NOT NULL,
    scheme character varying(80) NOT NULL,
    code character varying(80) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: uom_systems; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.uom_systems (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    code character varying(50) NOT NULL,
    name character varying(150) NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: uom_translations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.uom_translations (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    unit_id character(26) NOT NULL,
    locale character varying(20) NOT NULL,
    name character varying(150) NOT NULL,
    description character varying(2000),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    name character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    email_verified_at timestamp(0) without time zone,
    password character varying(255) NOT NULL,
    remember_token character varying(100),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    two_factor_secret text,
    two_factor_recovery_codes text,
    two_factor_confirmed_at timestamp(0) without time zone,
    last_login_at timestamp(0) without time zone,
    must_change_password boolean DEFAULT false NOT NULL,
    account_type character varying(20) DEFAULT 'person'::character varying NOT NULL,
    timezone character varying(40),
    CONSTRAINT users_account_type_check CHECK (((account_type)::text = ANY ((ARRAY['person'::character varying, 'application'::character varying])::text[])))
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: vendors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendors (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    legal_entity_id character(26) NOT NULL,
    party_id character(26) NOT NULL,
    number character varying(40) NOT NULL,
    tax_number character varying(32),
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    creation_key character varying(160),
    created_by_user_id bigint,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    payment_priority integer,
    CONSTRAINT vendors_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])))
);


--
-- Name: workflow_configuration_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_configuration_versions (
    id character(26) NOT NULL,
    configuration_id character(26) NOT NULL,
    version integer NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    effective_from date,
    published_at timestamp(0) without time zone,
    published_by_user_id character(26),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: workflow_configurations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_configurations (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    workflow_type_id character(26) NOT NULL,
    name character varying(160) NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    legal_entity_id character(26),
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: workflow_elements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_elements (
    id character(26) NOT NULL,
    version_id character(26) NOT NULL,
    key character varying(100) NOT NULL,
    kind character varying(30) NOT NULL,
    label character varying(160) NOT NULL,
    configuration json DEFAULT '{}'::json NOT NULL,
    position_x integer DEFAULT 0 NOT NULL,
    position_y integer DEFAULT 0 NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: workflow_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_history (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    instance_id character(26) NOT NULL,
    event_type character varying(60) NOT NULL,
    actor_membership_id character(26),
    details json DEFAULT '{}'::json NOT NULL,
    occurred_at timestamp(0) without time zone NOT NULL,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: workflow_instances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_instances (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    workflow_type_id character(26) NOT NULL,
    configuration_version_id character(26) NOT NULL,
    source_document_type character varying(120) NOT NULL,
    source_document_id character varying(26) NOT NULL,
    idempotency_key character varying(160) NOT NULL,
    decision_context json NOT NULL,
    status character varying(30) DEFAULT 'submitted'::character varying NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    initiator_membership_id character(26),
    correlation_id character(26),
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: workflow_parameters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_parameters (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    code character varying(80) NOT NULL,
    value jsonb NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: workflow_transitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_transitions (
    id character(26) NOT NULL,
    version_id character(26) NOT NULL,
    from_element_id character(26) NOT NULL,
    to_element_id character(26) NOT NULL,
    outcome character varying(40),
    condition json,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: workflow_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_types (
    id character(26) NOT NULL,
    app_id character varying(80) NOT NULL,
    code character varying(120) NOT NULL,
    name character varying(160) NOT NULL,
    decision_context_schema json NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    scope character varying(20) DEFAULT 'legal_entity'::character varying NOT NULL
);


--
-- Name: workflow_work_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_work_items (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    instance_id character(26) NOT NULL,
    element_id character(26) NOT NULL,
    assigned_membership_id character(26),
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    due_at timestamp(0) without time zone,
    completed_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    review_url character varying(1000),
    email_notified_at timestamp(0) without time zone,
    email_next_attempt_at timestamp(0) without time zone,
    email_attempts integer DEFAULT 0 NOT NULL,
    email_last_error character varying(250)
);


--
-- Name: working_time_calendar_days; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.working_time_calendar_days (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    working_time_calendar_id character(26) NOT NULL,
    date date NOT NULL,
    day_of_week smallint NOT NULL,
    control character varying(20) DEFAULT 'open'::character varying NOT NULL,
    closed_for_pickup boolean DEFAULT false NOT NULL,
    hours numeric(5,2) DEFAULT '0'::numeric NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: working_time_calendar_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.working_time_calendar_lines (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    working_time_calendar_day_id character(26) NOT NULL,
    from_time time(0) without time zone,
    to_time time(0) without time zone,
    efficiency numeric(5,2) DEFAULT '100'::numeric NOT NULL,
    property character varying(50),
    hours numeric(5,2) DEFAULT '0'::numeric NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: working_time_calendars; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.working_time_calendars (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    legal_entity_id character(26),
    code character varying(50) NOT NULL,
    name character varying(150) NOT NULL,
    description text,
    base_calendar_id character(26),
    standard_work_hours numeric(5,2) DEFAULT '8'::numeric NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: working_time_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.working_time_lines (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    working_time_template_id character(26) NOT NULL,
    day_of_week smallint NOT NULL,
    from_time time(0) without time zone,
    to_time time(0) without time zone,
    efficiency numeric(5,2) DEFAULT '100'::numeric NOT NULL,
    property character varying(50),
    closed_for_pickup boolean DEFAULT false NOT NULL,
    hours numeric(5,2) DEFAULT '0'::numeric NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: working_time_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.working_time_templates (
    id character(26) NOT NULL,
    tenant_id character(26) NOT NULL,
    legal_entity_id character(26),
    code character varying(50) NOT NULL,
    name character varying(150) NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id bigint,
    updated_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: change_log_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_log_entries ALTER COLUMN id SET DEFAULT nextval('public.change_log_entries_id_seq'::regclass);


--
-- Name: core_module_migrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.core_module_migrations ALTER COLUMN id SET DEFAULT nextval('public.core_module_migrations_id_seq'::regclass);


--
-- Name: failed_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.failed_jobs ALTER COLUMN id SET DEFAULT nextval('public.failed_jobs_id_seq'::regclass);


--
-- Name: jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs ALTER COLUMN id SET DEFAULT nextval('public.jobs_id_seq'::regclass);


--
-- Name: migrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migrations ALTER COLUMN id SET DEFAULT nextval('public.migrations_id_seq'::regclass);


--
-- Name: passkeys id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkeys ALTER COLUMN id SET DEFAULT nextval('public.passkeys_id_seq'::regclass);


--
-- Name: tenant_app_entitlements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_app_entitlements ALTER COLUMN id SET DEFAULT nextval('public.tenant_app_entitlements_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: access_audit_events access_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_audit_events
    ADD CONSTRAINT access_audit_events_pkey PRIMARY KEY (id);


--
-- Name: address_books address_books_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.address_books
    ADD CONSTRAINT address_books_pkey PRIMARY KEY (id);


--
-- Name: address_books address_books_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.address_books
    ADD CONSTRAINT address_books_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: analytics_dashboards analytics_dashboards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_dashboards
    ADD CONSTRAINT analytics_dashboards_pkey PRIMARY KEY (id);


--
-- Name: analytics_query_cache analytics_query_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_query_cache
    ADD CONSTRAINT analytics_query_cache_pkey PRIMARY KEY (id);


--
-- Name: analytics_query_cache analytics_query_cache_tenant_id_cache_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_query_cache
    ADD CONSTRAINT analytics_query_cache_tenant_id_cache_key_unique UNIQUE (tenant_id, cache_key);


--
-- Name: analytics_query_log analytics_query_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_query_log
    ADD CONSTRAINT analytics_query_log_pkey PRIMARY KEY (id);


--
-- Name: analytics_saved_queries analytics_saved_queries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_saved_queries
    ADD CONSTRAINT analytics_saved_queries_pkey PRIMARY KEY (id);


--
-- Name: analytics_widgets analytics_widgets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_widgets
    ADD CONSTRAINT analytics_widgets_pkey PRIMARY KEY (id);


--
-- Name: app_data_policies app_data_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_data_policies
    ADD CONSTRAINT app_data_policies_pkey PRIMARY KEY (code);


--
-- Name: app_dependencies app_dependencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_dependencies
    ADD CONSTRAINT app_dependencies_pkey PRIMARY KEY (app_id, depends_on_app_id);


--
-- Name: app_entry_points app_entry_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_entry_points
    ADD CONSTRAINT app_entry_points_pkey PRIMARY KEY (code);


--
-- Name: app_installations app_installations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_installations
    ADD CONSTRAINT app_installations_pkey PRIMARY KEY (id);


--
-- Name: app_number_sequence_references app_number_sequence_references_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_number_sequence_references
    ADD CONSTRAINT app_number_sequence_references_code_unique UNIQUE (code);


--
-- Name: app_number_sequence_references app_number_sequence_references_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_number_sequence_references
    ADD CONSTRAINT app_number_sequence_references_pkey PRIMARY KEY (id);


--
-- Name: app_placements app_placements_app_id_placement_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_placements
    ADD CONSTRAINT app_placements_app_id_placement_unique UNIQUE (app_id, placement);


--
-- Name: app_placements app_placements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_placements
    ADD CONSTRAINT app_placements_pkey PRIMARY KEY (id);


--
-- Name: app_releases app_releases_app_id_version_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_releases
    ADD CONSTRAINT app_releases_app_id_version_unique UNIQUE (app_id, version);


--
-- Name: app_releases app_releases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_releases
    ADD CONSTRAINT app_releases_pkey PRIMARY KEY (id);


--
-- Name: app_reports app_reports_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_reports
    ADD CONSTRAINT app_reports_code_unique UNIQUE (code);


--
-- Name: app_reports app_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_reports
    ADD CONSTRAINT app_reports_pkey PRIMARY KEY (id);


--
-- Name: app_service_credentials app_service_credentials_app_id_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_service_credentials
    ADD CONSTRAINT app_service_credentials_app_id_name_unique UNIQUE (app_id, name);


--
-- Name: app_service_credentials app_service_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_service_credentials
    ADD CONSTRAINT app_service_credentials_pkey PRIMARY KEY (id);


--
-- Name: apps apps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apps
    ADD CONSTRAINT apps_pkey PRIMARY KEY (id);


--
-- Name: automatic_role_assignment_rules automatic_role_assignment_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automatic_role_assignment_rules
    ADD CONSTRAINT automatic_role_assignment_rules_pkey PRIMARY KEY (id);


--
-- Name: automatic_role_assignment_rules automatic_role_assignment_rules_tenant_id_role_id_position_id_u; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automatic_role_assignment_rules
    ADD CONSTRAINT automatic_role_assignment_rules_tenant_id_role_id_position_id_u UNIQUE (tenant_id, role_id, position_id);


--
-- Name: cache_locks cache_locks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cache_locks
    ADD CONSTRAINT cache_locks_pkey PRIMARY KEY (key);


--
-- Name: cache cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cache
    ADD CONSTRAINT cache_pkey PRIMARY KEY (key);


--
-- Name: change_log_entries change_log_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_log_entries
    ADD CONSTRAINT change_log_entries_pkey PRIMARY KEY (id);


--
-- Name: change_log_setup_fields change_log_setup_fields_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_log_setup_fields
    ADD CONSTRAINT change_log_setup_fields_pkey PRIMARY KEY (id);


--
-- Name: change_log_setup_tables change_log_setup_tables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_log_setup_tables
    ADD CONSTRAINT change_log_setup_tables_pkey PRIMARY KEY (id);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: clients clients_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_slug_unique UNIQUE (slug);


--
-- Name: console_settings console_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.console_settings
    ADD CONSTRAINT console_settings_pkey PRIMARY KEY (key);


--
-- Name: core_module_installations core_module_installations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.core_module_installations
    ADD CONSTRAINT core_module_installations_pkey PRIMARY KEY (tenant_id, module_id);


--
-- Name: core_module_migrations core_module_migrations_module_id_migration_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.core_module_migrations
    ADD CONSTRAINT core_module_migrations_module_id_migration_unique UNIQUE (module_id, migration);


--
-- Name: core_module_migrations core_module_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.core_module_migrations
    ADD CONSTRAINT core_module_migrations_pkey PRIMARY KEY (id);


--
-- Name: country_regions country_regions_iso3_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.country_regions
    ADD CONSTRAINT country_regions_iso3_unique UNIQUE (iso3);


--
-- Name: country_regions country_regions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.country_regions
    ADD CONSTRAINT country_regions_pkey PRIMARY KEY (code);


--
-- Name: currency_precisions currency_precisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currency_precisions
    ADD CONSTRAINT currency_precisions_pkey PRIMARY KEY (id);


--
-- Name: currency_precisions currency_precisions_tenant_id_currency_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currency_precisions
    ADD CONSTRAINT currency_precisions_tenant_id_currency_code_unique UNIQUE (tenant_id, currency_code);


--
-- Name: document_attachments document_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_attachments
    ADD CONSTRAINT document_attachments_pkey PRIMARY KEY (id);


--
-- Name: document_notes document_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_notes
    ADD CONSTRAINT document_notes_pkey PRIMARY KEY (id);


--
-- Name: electronic_addresses electronic_addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.electronic_addresses
    ADD CONSTRAINT electronic_addresses_pkey PRIMARY KEY (id);


--
-- Name: electronic_addresses electronic_addresses_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.electronic_addresses
    ADD CONSTRAINT electronic_addresses_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: environment_members environment_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_members
    ADD CONSTRAINT environment_members_pkey PRIMARY KEY (environment_id, user_id);


--
-- Name: environment_operations environment_operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_operations
    ADD CONSTRAINT environment_operations_pkey PRIMARY KEY (id);


--
-- Name: environments environments_database_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environments
    ADD CONSTRAINT environments_database_name_unique UNIQUE (database_name);


--
-- Name: environments environments_id_tenant_unik; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environments
    ADD CONSTRAINT environments_id_tenant_unik UNIQUE (id, tenant_id);


--
-- Name: environments environments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environments
    ADD CONSTRAINT environments_pkey PRIMARY KEY (id);


--
-- Name: external_identities external_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_identities
    ADD CONSTRAINT external_identities_pkey PRIMARY KEY (id);


--
-- Name: failed_jobs failed_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.failed_jobs
    ADD CONSTRAINT failed_jobs_pkey PRIMARY KEY (id);


--
-- Name: failed_jobs failed_jobs_uuid_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.failed_jobs
    ADD CONSTRAINT failed_jobs_uuid_unique UNIQUE (uuid);


--
-- Name: finance_posting_deliveries finance_posting_deliveries_finance_posting_id_integration_clien; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_posting_deliveries
    ADD CONSTRAINT finance_posting_deliveries_finance_posting_id_integration_clien UNIQUE (finance_posting_id, integration_client_id);


--
-- Name: finance_posting_deliveries finance_posting_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_posting_deliveries
    ADD CONSTRAINT finance_posting_deliveries_pkey PRIMARY KEY (id);


--
-- Name: finance_posting_events finance_posting_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_posting_events
    ADD CONSTRAINT finance_posting_events_pkey PRIMARY KEY (id);


--
-- Name: finance_posting_lines finance_posting_lines_finance_posting_id_line_no_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_posting_lines
    ADD CONSTRAINT finance_posting_lines_finance_posting_id_line_no_unique UNIQUE (finance_posting_id, line_no);


--
-- Name: finance_posting_lines finance_posting_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_posting_lines
    ADD CONSTRAINT finance_posting_lines_pkey PRIMARY KEY (id);


--
-- Name: finance_posting_settings finance_posting_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_posting_settings
    ADD CONSTRAINT finance_posting_settings_pkey PRIMARY KEY (legal_entity_id);


--
-- Name: finance_postings finance_postings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_postings
    ADD CONSTRAINT finance_postings_pkey PRIMARY KEY (id);


--
-- Name: finance_postings finance_postings_tenant_id_posting_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_postings
    ADD CONSTRAINT finance_postings_tenant_id_posting_id_unique UNIQUE (tenant_id, posting_id);


--
-- Name: finance_reference_account_imports finance_reference_account_imports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_reference_account_imports
    ADD CONSTRAINT finance_reference_account_imports_pkey PRIMARY KEY (id);


--
-- Name: finance_reference_accounts finance_reference_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_reference_accounts
    ADD CONSTRAINT finance_reference_accounts_pkey PRIMARY KEY (id);


--
-- Name: finance_settlement_modes finance_settlement_modes_legal_entity_id_effective_from_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_settlement_modes
    ADD CONSTRAINT finance_settlement_modes_legal_entity_id_effective_from_unique UNIQUE (legal_entity_id, effective_from);


--
-- Name: finance_settlement_modes finance_settlement_modes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_settlement_modes
    ADD CONSTRAINT finance_settlement_modes_pkey PRIMARY KEY (id);


--
-- Name: fiscal_calendars fiscal_calendars_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_calendars
    ADD CONSTRAINT fiscal_calendars_pkey PRIMARY KEY (id);


--
-- Name: fiscal_calendars fiscal_calendars_tenant_id_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_calendars
    ADD CONSTRAINT fiscal_calendars_tenant_id_code_unique UNIQUE (tenant_id, code);


--
-- Name: fiscal_periods fiscal_periods_fiscal_year_id_ordinal_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_periods
    ADD CONSTRAINT fiscal_periods_fiscal_year_id_ordinal_unique UNIQUE (fiscal_year_id, ordinal);


--
-- Name: fiscal_periods fiscal_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_periods
    ADD CONSTRAINT fiscal_periods_pkey PRIMARY KEY (id);


--
-- Name: fiscal_years fiscal_years_fiscal_calendar_id_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_years
    ADD CONSTRAINT fiscal_years_fiscal_calendar_id_name_unique UNIQUE (fiscal_calendar_id, name);


--
-- Name: fiscal_years fiscal_years_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_years
    ADD CONSTRAINT fiscal_years_pkey PRIMARY KEY (id);


--
-- Name: funding_sources funding_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funding_sources
    ADD CONSTRAINT funding_sources_pkey PRIMARY KEY (id);


--
-- Name: funding_sources funding_sources_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funding_sources
    ADD CONSTRAINT funding_sources_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: funding_sources funding_sources_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funding_sources
    ADD CONSTRAINT funding_sources_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: hierarchy_purpose_organization_types hierarchy_purpose_organization_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hierarchy_purpose_organization_types
    ADD CONSTRAINT hierarchy_purpose_organization_types_pkey PRIMARY KEY (purpose_id, organization_type);


--
-- Name: hierarchy_purposes hierarchy_purposes_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hierarchy_purposes
    ADD CONSTRAINT hierarchy_purposes_code_unique UNIQUE (code);


--
-- Name: hierarchy_purposes hierarchy_purposes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hierarchy_purposes
    ADD CONSTRAINT hierarchy_purposes_pkey PRIMARY KEY (id);


--
-- Name: integration_clients integration_clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_clients
    ADD CONSTRAINT integration_clients_pkey PRIMARY KEY (id);


--
-- Name: integration_clients integration_clients_tenant_id_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_clients
    ADD CONSTRAINT integration_clients_tenant_id_name_unique UNIQUE (tenant_id, name);


--
-- Name: integration_scopes integration_scopes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_scopes
    ADD CONSTRAINT integration_scopes_pkey PRIMARY KEY (code);


--
-- Name: invitation_codes invitation_codes_code_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_codes
    ADD CONSTRAINT invitation_codes_code_hash_unique UNIQUE (code_hash);


--
-- Name: invitation_codes invitation_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_codes
    ADD CONSTRAINT invitation_codes_pkey PRIMARY KEY (id);


--
-- Name: invitation_data_policy_scopes invitation_data_policy_scopes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_data_policy_scopes
    ADD CONSTRAINT invitation_data_policy_scopes_pkey PRIMARY KEY (id);


--
-- Name: invitation_role_assignments invitation_role_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_role_assignments
    ADD CONSTRAINT invitation_role_assignments_pkey PRIMARY KEY (invitation_id, role_id);


--
-- Name: job_batches job_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_batches
    ADD CONSTRAINT job_batches_pkey PRIMARY KEY (id);


--
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);


--
-- Name: legal_entities legal_entities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_entities
    ADD CONSTRAINT legal_entities_pkey PRIMARY KEY (organization_id);


--
-- Name: legal_entities legal_entities_tenant_id_company_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_entities
    ADD CONSTRAINT legal_entities_tenant_id_company_code_unique UNIQUE (tenant_id, company_code);


--
-- Name: location_purposes location_purposes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_purposes
    ADD CONSTRAINT location_purposes_pkey PRIMARY KEY (code);


--
-- Name: locations locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_pkey PRIMARY KEY (id);


--
-- Name: locations locations_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: managed_product_tenants managed_product_tenants_idempotency_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.managed_product_tenants
    ADD CONSTRAINT managed_product_tenants_idempotency_key_unique UNIQUE (idempotency_key);


--
-- Name: managed_product_tenants managed_product_tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.managed_product_tenants
    ADD CONSTRAINT managed_product_tenants_pkey PRIMARY KEY (id);


--
-- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migrations
    ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);


--
-- Name: number_sequence_allocations number_sequence_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_sequence_allocations
    ADD CONSTRAINT number_sequence_allocations_pkey PRIMARY KEY (id);


--
-- Name: number_sequence_audit_events number_sequence_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_sequence_audit_events
    ADD CONSTRAINT number_sequence_audit_events_pkey PRIMARY KEY (id);


--
-- Name: number_sequence_continuous_pool number_sequence_continuous_pool_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_sequence_continuous_pool
    ADD CONSTRAINT number_sequence_continuous_pool_pkey PRIMARY KEY (sequence_id, scope_key, period_key, numeric_value);


--
-- Name: number_sequence_counters number_sequence_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_sequence_counters
    ADD CONSTRAINT number_sequence_counters_pkey PRIMARY KEY (id);


--
-- Name: number_sequence_counters number_sequence_counters_sequence_id_scope_key_period_key_uniqu; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_sequence_counters
    ADD CONSTRAINT number_sequence_counters_sequence_id_scope_key_period_key_uniqu UNIQUE (sequence_id, scope_key, period_key);


--
-- Name: number_sequence_issues number_sequence_issues_formatted_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_sequence_issues
    ADD CONSTRAINT number_sequence_issues_formatted_unique UNIQUE (sequence_id, scope_key, period_key, formatted_value);


--
-- Name: number_sequence_issues number_sequence_issues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_sequence_issues
    ADD CONSTRAINT number_sequence_issues_pkey PRIMARY KEY (id);


--
-- Name: number_sequence_issues number_sequence_issues_sequence_id_app_id_idempotency_key_uniqu; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_sequence_issues
    ADD CONSTRAINT number_sequence_issues_sequence_id_app_id_idempotency_key_uniqu UNIQUE (sequence_id, app_id, idempotency_key);


--
-- Name: number_sequence_issues number_sequence_issues_sequence_id_scope_key_period_key_numeric; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_sequence_issues
    ADD CONSTRAINT number_sequence_issues_sequence_id_scope_key_period_key_numeric UNIQUE (sequence_id, scope_key, period_key, numeric_value);


--
-- Name: number_sequence_issues number_sequence_issues_value_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_sequence_issues
    ADD CONSTRAINT number_sequence_issues_value_unique UNIQUE (sequence_id, scope_key, formatted_value);


--
-- Name: number_sequence_profiles number_sequence_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_sequence_profiles
    ADD CONSTRAINT number_sequence_profiles_pkey PRIMARY KEY (code);


--
-- Name: number_sequence_reservations number_sequence_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_sequence_reservations
    ADD CONSTRAINT number_sequence_reservations_pkey PRIMARY KEY (id);


--
-- Name: number_sequence_reservations number_sequence_reservations_sequence_id_app_id_idempotency_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_sequence_reservations
    ADD CONSTRAINT number_sequence_reservations_sequence_id_app_id_idempotency_key UNIQUE (sequence_id, app_id, idempotency_key);


--
-- Name: number_sequence_reusable_numbers number_sequence_reusable_numbers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_sequence_reusable_numbers
    ADD CONSTRAINT number_sequence_reusable_numbers_pkey PRIMARY KEY (sequence_id, scope_key, period_key, numeric_value);


--
-- Name: operating_units operating_units_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operating_units
    ADD CONSTRAINT operating_units_pkey PRIMARY KEY (organization_id);


--
-- Name: operator_audit_events operator_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_audit_events
    ADD CONSTRAINT operator_audit_events_pkey PRIMARY KEY (id);


--
-- Name: organization_hierarchies organization_hierarchies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_hierarchies
    ADD CONSTRAINT organization_hierarchies_pkey PRIMARY KEY (id);


--
-- Name: organization_hierarchies organization_hierarchies_tenant_id_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_hierarchies
    ADD CONSTRAINT organization_hierarchies_tenant_id_name_unique UNIQUE (tenant_id, name);


--
-- Name: organization_hierarchy_closures organization_hierarchy_closures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_hierarchy_closures
    ADD CONSTRAINT organization_hierarchy_closures_pkey PRIMARY KEY (version_id, ancestor_organization_id, descendant_organization_id);


--
-- Name: organization_hierarchy_nodes organization_hierarchy_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_hierarchy_nodes
    ADD CONSTRAINT organization_hierarchy_nodes_pkey PRIMARY KEY (id);


--
-- Name: organization_hierarchy_nodes organization_hierarchy_nodes_version_id_organization_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_hierarchy_nodes
    ADD CONSTRAINT organization_hierarchy_nodes_version_id_organization_id_unique UNIQUE (version_id, organization_id);


--
-- Name: organization_hierarchy_purposes organization_hierarchy_purposes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_hierarchy_purposes
    ADD CONSTRAINT organization_hierarchy_purposes_pkey PRIMARY KEY (hierarchy_id, purpose_id);


--
-- Name: organization_hierarchy_versions organization_hierarchy_versions_hierarchy_id_version_number_uni; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_hierarchy_versions
    ADD CONSTRAINT organization_hierarchy_versions_hierarchy_id_version_number_uni UNIQUE (hierarchy_id, version_number);


--
-- Name: organization_hierarchy_versions organization_hierarchy_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_hierarchy_versions
    ADD CONSTRAINT organization_hierarchy_versions_pkey PRIMARY KEY (id);


--
-- Name: organization_parties organization_parties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_parties
    ADD CONSTRAINT organization_parties_pkey PRIMARY KEY (organization_id);


--
-- Name: organization_parties organization_parties_tenant_id_party_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_parties
    ADD CONSTRAINT organization_parties_tenant_id_party_id_unique UNIQUE (tenant_id, party_id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: outbox_events outbox_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox_events
    ADD CONSTRAINT outbox_events_pkey PRIMARY KEY (id);


--
-- Name: parties parties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parties
    ADD CONSTRAINT parties_pkey PRIMARY KEY (id);


--
-- Name: parties parties_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parties
    ADD CONSTRAINT parties_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: party_address_books party_address_books_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.party_address_books
    ADD CONSTRAINT party_address_books_pkey PRIMARY KEY (id);


--
-- Name: party_location_purposes party_location_purposes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.party_location_purposes
    ADD CONSTRAINT party_location_purposes_pkey PRIMARY KEY (id);


--
-- Name: party_location_purposes party_location_purposes_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.party_location_purposes
    ADD CONSTRAINT party_location_purposes_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: party_locations party_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.party_locations
    ADD CONSTRAINT party_locations_pkey PRIMARY KEY (id);


--
-- Name: party_locations party_locations_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.party_locations
    ADD CONSTRAINT party_locations_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: party_reference_values party_reference_values_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.party_reference_values
    ADD CONSTRAINT party_reference_values_pkey PRIMARY KEY (category, code);


--
-- Name: party_relationship_types party_relationship_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.party_relationship_types
    ADD CONSTRAINT party_relationship_types_pkey PRIMARY KEY (code);


--
-- Name: party_relationships party_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.party_relationships
    ADD CONSTRAINT party_relationships_pkey PRIMARY KEY (id);


--
-- Name: party_role_registrations party_role_registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.party_role_registrations
    ADD CONSTRAINT party_role_registrations_pkey PRIMARY KEY (id);


--
-- Name: party_role_registrations party_role_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.party_role_registrations
    ADD CONSTRAINT party_role_unique UNIQUE (tenant_id, party_id, role_code, legal_entity_id);


--
-- Name: party_types party_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.party_types
    ADD CONSTRAINT party_types_pkey PRIMARY KEY (code);


--
-- Name: passkeys passkeys_credential_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkeys
    ADD CONSTRAINT passkeys_credential_id_unique UNIQUE (credential_id);


--
-- Name: passkeys passkeys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkeys
    ADD CONSTRAINT passkeys_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (email);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (code);


--
-- Name: planning_years planning_years_company_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planning_years
    ADD CONSTRAINT planning_years_company_id_unique UNIQUE (tenant_id, legal_entity_id, id);


--
-- Name: planning_years planning_years_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planning_years
    ADD CONSTRAINT planning_years_pkey PRIMARY KEY (id);


--
-- Name: planning_years planning_years_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planning_years
    ADD CONSTRAINT planning_years_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: postal_addresses postal_addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postal_addresses
    ADD CONSTRAINT postal_addresses_pkey PRIMARY KEY (id);


--
-- Name: postal_addresses postal_addresses_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postal_addresses
    ADD CONSTRAINT postal_addresses_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: postal_addresses postal_addresses_tenant_id_location_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postal_addresses
    ADD CONSTRAINT postal_addresses_tenant_id_location_id_unique UNIQUE (tenant_id, location_id);


--
-- Name: print_identities print_identities_organization_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_identities
    ADD CONSTRAINT print_identities_organization_id_unique UNIQUE (organization_id);


--
-- Name: print_identities print_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_identities
    ADD CONSTRAINT print_identities_pkey PRIMARY KEY (id);


--
-- Name: product_auth_attempts product_auth_attempts_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_auth_attempts
    ADD CONSTRAINT product_auth_attempts_id_unique UNIQUE (id);


--
-- Name: product_auth_attempts product_auth_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_auth_attempts
    ADD CONSTRAINT product_auth_attempts_pkey PRIMARY KEY (state_hash);


--
-- Name: product_customer_sessions product_customer_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_customer_sessions
    ADD CONSTRAINT product_customer_sessions_pkey PRIMARY KEY (token_hash);


--
-- Name: product_customers product_customers_identity_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_customers
    ADD CONSTRAINT product_customers_identity_hash_unique UNIQUE (identity_hash);


--
-- Name: product_customers product_customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_customers
    ADD CONSTRAINT product_customers_pkey PRIMARY KEY (id);


--
-- Name: product_email_challenges product_email_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_email_challenges
    ADD CONSTRAINT product_email_challenges_pkey PRIMARY KEY (token_hash);


--
-- Name: provider_access provider_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_access
    ADD CONSTRAINT provider_access_pkey PRIMARY KEY (user_id);


--
-- Name: ref_address_parameters ref_address_parameters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_address_parameters
    ADD CONSTRAINT ref_address_parameters_pkey PRIMARY KEY (country_code);


--
-- Name: ref_administrative_division_external_codes ref_administrative_division_external_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_administrative_division_external_codes
    ADD CONSTRAINT ref_administrative_division_external_codes_pkey PRIMARY KEY (id);


--
-- Name: ref_administrative_division_timezones ref_administrative_division_timezones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_administrative_division_timezones
    ADD CONSTRAINT ref_administrative_division_timezones_pkey PRIMARY KEY (id);


--
-- Name: ref_administrative_division_translations ref_administrative_division_translations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_administrative_division_translations
    ADD CONSTRAINT ref_administrative_division_translations_pkey PRIMARY KEY (id);


--
-- Name: ref_administrative_divisions ref_administrative_divisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_administrative_divisions
    ADD CONSTRAINT ref_administrative_divisions_pkey PRIMARY KEY (id);


--
-- Name: ref_buildings ref_buildings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_buildings
    ADD CONSTRAINT ref_buildings_pkey PRIMARY KEY (id);


--
-- Name: ref_countries ref_countries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_countries
    ADD CONSTRAINT ref_countries_pkey PRIMARY KEY (code);


--
-- Name: ref_country_hierarchy_levels ref_country_hier_level_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_country_hierarchy_levels
    ADD CONSTRAINT ref_country_hier_level_unique UNIQUE (country_code, level);


--
-- Name: ref_country_hierarchy_levels ref_country_hierarchy_levels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_country_hierarchy_levels
    ADD CONSTRAINT ref_country_hierarchy_levels_pkey PRIMARY KEY (id);


--
-- Name: ref_districts ref_districts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_districts
    ADD CONSTRAINT ref_districts_pkey PRIMARY KEY (id);


--
-- Name: ref_districts ref_districts_reg_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_districts
    ADD CONSTRAINT ref_districts_reg_code_unique UNIQUE (regency_id, code);


--
-- Name: ref_administrative_division_timezones ref_div_tz_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_administrative_division_timezones
    ADD CONSTRAINT ref_div_tz_unique UNIQUE (division_type, division_id, timezone);


--
-- Name: ref_group_of_houses ref_group_of_houses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_group_of_houses
    ADD CONSTRAINT ref_group_of_houses_pkey PRIMARY KEY (id);


--
-- Name: ref_land_plots ref_land_plots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_land_plots
    ADD CONSTRAINT ref_land_plots_pkey PRIMARY KEY (id);


--
-- Name: ref_postal_codes ref_postal_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_postal_codes
    ADD CONSTRAINT ref_postal_codes_pkey PRIMARY KEY (id);


--
-- Name: ref_provinces ref_provinces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_provinces
    ADD CONSTRAINT ref_provinces_pkey PRIMARY KEY (id);


--
-- Name: ref_regencies ref_regencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_regencies
    ADD CONSTRAINT ref_regencies_pkey PRIMARY KEY (id);


--
-- Name: ref_regencies ref_regencies_prov_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_regencies
    ADD CONSTRAINT ref_regencies_prov_code_unique UNIQUE (province_id, code);


--
-- Name: ref_streets ref_streets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_streets
    ADD CONSTRAINT ref_streets_pkey PRIMARY KEY (id);


--
-- Name: ref_villages ref_villages_dist_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_villages
    ADD CONSTRAINT ref_villages_dist_code_unique UNIQUE (district_id, code);


--
-- Name: ref_villages ref_villages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_villages
    ADD CONSTRAINT ref_villages_pkey PRIMARY KEY (id);


--
-- Name: report_exports report_exports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_exports
    ADD CONSTRAINT report_exports_pkey PRIMARY KEY (id);


--
-- Name: report_last_used_options report_last_used_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_last_used_options
    ADD CONSTRAINT report_last_used_options_pkey PRIMARY KEY (id);


--
-- Name: report_layout_defaults report_layout_defaults_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_layout_defaults
    ADD CONSTRAINT report_layout_defaults_pkey PRIMARY KEY (id);


--
-- Name: report_layout_defaults report_layout_defaults_tenant_id_report_code_scope_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_layout_defaults
    ADD CONSTRAINT report_layout_defaults_tenant_id_report_code_scope_key_unique UNIQUE (tenant_id, report_code, scope_key);


--
-- Name: report_layouts report_layouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_layouts
    ADD CONSTRAINT report_layouts_pkey PRIMARY KEY (id);


--
-- Name: report_presets report_presets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_presets
    ADD CONSTRAINT report_presets_pkey PRIMARY KEY (id);


--
-- Name: retention_policy_log_entries retention_policy_log_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retention_policy_log_entries
    ADD CONSTRAINT retention_policy_log_entries_pkey PRIMARY KEY (id);


--
-- Name: retention_policy_setups retention_policy_setups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retention_policy_setups
    ADD CONSTRAINT retention_policy_setups_pkey PRIMARY KEY (id);


--
-- Name: retention_policy_setups retention_policy_setups_tenant_id_policy_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retention_policy_setups
    ADD CONSTRAINT retention_policy_setups_tenant_id_policy_code_unique UNIQUE (tenant_id, policy_code);


--
-- Name: role_assignment_data_policy_scopes role_assignment_data_policy_scopes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_assignment_data_policy_scopes
    ADD CONSTRAINT role_assignment_data_policy_scopes_pkey PRIMARY KEY (id);


--
-- Name: role_assignments role_assignment_source_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_assignments
    ADD CONSTRAINT role_assignment_source_unique UNIQUE (membership_id, role_id, source, source_reference);


--
-- Name: role_assignments role_assignments_membership_id_role_id_source_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_assignments
    ADD CONSTRAINT role_assignments_membership_id_role_id_source_unique UNIQUE (membership_id, role_id, source);


--
-- Name: role_assignments role_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_assignments
    ADD CONSTRAINT role_assignments_pkey PRIMARY KEY (id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: roles roles_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: roles roles_tenant_id_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_tenant_id_name_unique UNIQUE (tenant_id, name);


--
-- Name: security_duties security_duties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_duties
    ADD CONSTRAINT security_duties_pkey PRIMARY KEY (code);


--
-- Name: security_duty_privileges security_duty_privileges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_duty_privileges
    ADD CONSTRAINT security_duty_privileges_pkey PRIMARY KEY (duty_code, privilege_code);


--
-- Name: security_privilege_permissions security_privilege_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_privilege_permissions
    ADD CONSTRAINT security_privilege_permissions_pkey PRIMARY KEY (privilege_code, permission_code);


--
-- Name: security_privileges security_privileges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_privileges
    ADD CONSTRAINT security_privileges_pkey PRIMARY KEY (code);


--
-- Name: security_role_children security_role_children_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_role_children
    ADD CONSTRAINT security_role_children_pkey PRIMARY KEY (parent_role_id, child_role_id);


--
-- Name: security_role_duties security_role_duties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_role_duties
    ADD CONSTRAINT security_role_duties_pkey PRIMARY KEY (role_id, duty_code);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: site_enrollment_tokens site_enrollment_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_enrollment_tokens
    ADD CONSTRAINT site_enrollment_tokens_pkey PRIMARY KEY (id);


--
-- Name: site_enrollment_tokens site_enrollment_tokens_token_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_enrollment_tokens
    ADD CONSTRAINT site_enrollment_tokens_token_hash_unique UNIQUE (token_hash);


--
-- Name: site_operations site_operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_operations
    ADD CONSTRAINT site_operations_pkey PRIMARY KEY (id);


--
-- Name: site_releases site_releases_edition_release_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_releases
    ADD CONSTRAINT site_releases_edition_release_unique UNIQUE (edition, release);


--
-- Name: site_releases site_releases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_releases
    ADD CONSTRAINT site_releases_pkey PRIMARY KEY (id);


--
-- Name: site_reports site_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_reports
    ADD CONSTRAINT site_reports_pkey PRIMARY KEY (id);


--
-- Name: sites sites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_pkey PRIMARY KEY (id);


--
-- Name: sites sites_tenant_id_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_tenant_id_name_unique UNIQUE (tenant_id, name);


--
-- Name: sod_conflicts sod_conflicts_membership_id_sod_rule_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sod_conflicts
    ADD CONSTRAINT sod_conflicts_membership_id_sod_rule_id_unique UNIQUE (membership_id, sod_rule_id);


--
-- Name: sod_conflicts sod_conflicts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sod_conflicts
    ADD CONSTRAINT sod_conflicts_pkey PRIMARY KEY (id);


--
-- Name: sod_rules sod_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sod_rules
    ADD CONSTRAINT sod_rules_pkey PRIMARY KEY (id);


--
-- Name: sod_rules sod_rules_tenant_id_first_duty_code_second_duty_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sod_rules
    ADD CONSTRAINT sod_rules_tenant_id_first_duty_code_second_duty_code_unique UNIQUE (tenant_id, first_duty_code, second_duty_code);


--
-- Name: sso_login_attempts sso_login_attempts_handoff_token_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sso_login_attempts
    ADD CONSTRAINT sso_login_attempts_handoff_token_hash_unique UNIQUE (handoff_token_hash);


--
-- Name: sso_login_attempts sso_login_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sso_login_attempts
    ADD CONSTRAINT sso_login_attempts_pkey PRIMARY KEY (id);


--
-- Name: sso_login_attempts sso_login_attempts_state_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sso_login_attempts
    ADD CONSTRAINT sso_login_attempts_state_hash_unique UNIQUE (state_hash);


--
-- Name: tenant_app_entitlements tenant_app_entitlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_app_entitlements
    ADD CONSTRAINT tenant_app_entitlements_pkey PRIMARY KEY (id);


--
-- Name: tenant_app_entitlements tenant_app_entitlements_tenant_id_app_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_app_entitlements
    ADD CONSTRAINT tenant_app_entitlements_tenant_id_app_id_unique UNIQUE (tenant_id, app_id);


--
-- Name: tenant_creation_requests tenant_creation_actor_request_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_creation_requests
    ADD CONSTRAINT tenant_creation_actor_request_unique UNIQUE (actor_scope, idempotency_key);


--
-- Name: tenant_creation_requests tenant_creation_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_creation_requests
    ADD CONSTRAINT tenant_creation_requests_pkey PRIMARY KEY (id);


--
-- Name: tenant_deployments tenant_deployments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_deployments
    ADD CONSTRAINT tenant_deployments_pkey PRIMARY KEY (id);


--
-- Name: tenant_deployments tenant_deployments_tenant_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_deployments
    ADD CONSTRAINT tenant_deployments_tenant_id_unique UNIQUE (tenant_id);


--
-- Name: tenant_identity_providers tenant_identity_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_identity_providers
    ADD CONSTRAINT tenant_identity_providers_pkey PRIMARY KEY (id);


--
-- Name: tenant_identity_providers tenant_identity_providers_tenant_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_identity_providers
    ADD CONSTRAINT tenant_identity_providers_tenant_id_unique UNIQUE (tenant_id);


--
-- Name: tenant_memberships tenant_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_memberships
    ADD CONSTRAINT tenant_memberships_pkey PRIMARY KEY (id);


--
-- Name: tenant_memberships tenant_memberships_tenant_id_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_memberships
    ADD CONSTRAINT tenant_memberships_tenant_id_user_id_unique UNIQUE (tenant_id, user_id);


--
-- Name: tenant_number_sequences tenant_number_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_number_sequences
    ADD CONSTRAINT tenant_number_sequences_pkey PRIMARY KEY (id);


--
-- Name: tenant_number_sequences tenant_number_sequences_tenant_id_reference_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_number_sequences
    ADD CONSTRAINT tenant_number_sequences_tenant_id_reference_id_unique UNIQUE (tenant_id, reference_id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_slug_unique UNIQUE (slug);


--
-- Name: time_zones time_zones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_zones
    ADD CONSTRAINT time_zones_pkey PRIMARY KEY (id);


--
-- Name: ref_administrative_divisions unique_country_level_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_administrative_divisions
    ADD CONSTRAINT unique_country_level_code UNIQUE (country_id, level, official_code);


--
-- Name: ref_administrative_division_translations unique_division_locale; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_administrative_division_translations
    ADD CONSTRAINT unique_division_locale UNIQUE (division_id, locale);


--
-- Name: ref_administrative_division_external_codes unique_division_sys_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_administrative_division_external_codes
    ADD CONSTRAINT unique_division_sys_code UNIQUE (division_id, system, external_code);


--
-- Name: units_of_measure units_of_measure_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.units_of_measure
    ADD CONSTRAINT units_of_measure_pkey PRIMARY KEY (id);


--
-- Name: units_of_measure units_of_measure_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.units_of_measure
    ADD CONSTRAINT units_of_measure_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: uom_classes uom_classes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uom_classes
    ADD CONSTRAINT uom_classes_pkey PRIMARY KEY (id);


--
-- Name: uom_classes uom_classes_tenant_id_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uom_classes
    ADD CONSTRAINT uom_classes_tenant_id_code_unique UNIQUE (tenant_id, code);


--
-- Name: uom_classes uom_classes_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uom_classes
    ADD CONSTRAINT uom_classes_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: uom_conversions uom_conversions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uom_conversions
    ADD CONSTRAINT uom_conversions_pkey PRIMARY KEY (id);


--
-- Name: uom_conversions uom_conversions_tenant_id_from_unit_id_to_unit_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uom_conversions
    ADD CONSTRAINT uom_conversions_tenant_id_from_unit_id_to_unit_id_unique UNIQUE (tenant_id, from_unit_id, to_unit_id);


--
-- Name: uom_external_codes uom_external_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uom_external_codes
    ADD CONSTRAINT uom_external_codes_pkey PRIMARY KEY (id);


--
-- Name: uom_external_codes uom_external_codes_tenant_id_scheme_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uom_external_codes
    ADD CONSTRAINT uom_external_codes_tenant_id_scheme_code_unique UNIQUE (tenant_id, scheme, code);


--
-- Name: uom_systems uom_systems_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uom_systems
    ADD CONSTRAINT uom_systems_pkey PRIMARY KEY (id);


--
-- Name: uom_systems uom_systems_tenant_id_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uom_systems
    ADD CONSTRAINT uom_systems_tenant_id_code_unique UNIQUE (tenant_id, code);


--
-- Name: uom_systems uom_systems_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uom_systems
    ADD CONSTRAINT uom_systems_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: uom_translations uom_translations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uom_translations
    ADD CONSTRAINT uom_translations_pkey PRIMARY KEY (id);


--
-- Name: uom_translations uom_translations_tenant_id_unit_id_locale_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uom_translations
    ADD CONSTRAINT uom_translations_tenant_id_unit_id_locale_unique UNIQUE (tenant_id, unit_id, locale);


--
-- Name: ref_postal_codes uq_postal_codes_country_code_village; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_postal_codes
    ADD CONSTRAINT uq_postal_codes_country_code_village UNIQUE (country_code, postal_code, village_id);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: vendors vendors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_pkey PRIMARY KEY (id);


--
-- Name: vendors vendors_tenant_id_creation_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_tenant_id_creation_key_unique UNIQUE (tenant_id, creation_key);


--
-- Name: vendors vendors_tenant_id_legal_entity_id_number_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_tenant_id_legal_entity_id_number_unique UNIQUE (tenant_id, legal_entity_id, number);


--
-- Name: vendors vendors_tenant_id_legal_entity_id_party_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_tenant_id_legal_entity_id_party_id_unique UNIQUE (tenant_id, legal_entity_id, party_id);


--
-- Name: workflow_configuration_versions workflow_configuration_versions_configuration_id_version_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_configuration_versions
    ADD CONSTRAINT workflow_configuration_versions_configuration_id_version_unique UNIQUE (configuration_id, version);


--
-- Name: workflow_configuration_versions workflow_configuration_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_configuration_versions
    ADD CONSTRAINT workflow_configuration_versions_pkey PRIMARY KEY (id);


--
-- Name: workflow_configurations workflow_configurations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_configurations
    ADD CONSTRAINT workflow_configurations_pkey PRIMARY KEY (id);


--
-- Name: workflow_configurations workflow_configurations_tenant_id_workflow_type_id_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_configurations
    ADD CONSTRAINT workflow_configurations_tenant_id_workflow_type_id_name_unique UNIQUE (tenant_id, workflow_type_id, name);


--
-- Name: workflow_elements workflow_elements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_elements
    ADD CONSTRAINT workflow_elements_pkey PRIMARY KEY (id);


--
-- Name: workflow_elements workflow_elements_version_id_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_elements
    ADD CONSTRAINT workflow_elements_version_id_key_unique UNIQUE (version_id, key);


--
-- Name: workflow_history workflow_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_history
    ADD CONSTRAINT workflow_history_pkey PRIMARY KEY (id);


--
-- Name: workflow_instances workflow_instances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_instances
    ADD CONSTRAINT workflow_instances_pkey PRIMARY KEY (id);


--
-- Name: workflow_instances workflow_instances_tenant_id_workflow_type_id_idempotency_key_u; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_instances
    ADD CONSTRAINT workflow_instances_tenant_id_workflow_type_id_idempotency_key_u UNIQUE (tenant_id, workflow_type_id, idempotency_key);


--
-- Name: workflow_parameters workflow_parameters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_parameters
    ADD CONSTRAINT workflow_parameters_pkey PRIMARY KEY (id);


--
-- Name: workflow_parameters workflow_parameters_tenant_id_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_parameters
    ADD CONSTRAINT workflow_parameters_tenant_id_code_unique UNIQUE (tenant_id, code);


--
-- Name: workflow_transitions workflow_transitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_transitions
    ADD CONSTRAINT workflow_transitions_pkey PRIMARY KEY (id);


--
-- Name: workflow_transitions workflow_transitions_version_id_from_element_id_to_element_id_o; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_transitions
    ADD CONSTRAINT workflow_transitions_version_id_from_element_id_to_element_id_o UNIQUE (version_id, from_element_id, to_element_id, outcome);


--
-- Name: workflow_types workflow_types_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_types
    ADD CONSTRAINT workflow_types_code_unique UNIQUE (code);


--
-- Name: workflow_types workflow_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_types
    ADD CONSTRAINT workflow_types_pkey PRIMARY KEY (id);


--
-- Name: workflow_work_items workflow_work_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_work_items
    ADD CONSTRAINT workflow_work_items_pkey PRIMARY KEY (id);


--
-- Name: working_time_calendar_days working_time_calendar_days_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.working_time_calendar_days
    ADD CONSTRAINT working_time_calendar_days_pkey PRIMARY KEY (id);


--
-- Name: working_time_calendar_days working_time_calendar_days_working_time_calendar_id_date_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.working_time_calendar_days
    ADD CONSTRAINT working_time_calendar_days_working_time_calendar_id_date_unique UNIQUE (working_time_calendar_id, date);


--
-- Name: working_time_calendar_lines working_time_calendar_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.working_time_calendar_lines
    ADD CONSTRAINT working_time_calendar_lines_pkey PRIMARY KEY (id);


--
-- Name: working_time_calendars working_time_calendars_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.working_time_calendars
    ADD CONSTRAINT working_time_calendars_pkey PRIMARY KEY (id);


--
-- Name: working_time_calendars working_time_calendars_tenant_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.working_time_calendars
    ADD CONSTRAINT working_time_calendars_tenant_id_id_unique UNIQUE (tenant_id, id);


--
-- Name: working_time_lines working_time_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.working_time_lines
    ADD CONSTRAINT working_time_lines_pkey PRIMARY KEY (id);


--
-- Name: working_time_templates working_time_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.working_time_templates
    ADD CONSTRAINT working_time_templates_pkey PRIMARY KEY (id);


--
-- Name: access_audit_events_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX access_audit_events_tenant_id_index ON public.access_audit_events USING btree (tenant_id);


--
-- Name: address_books_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX address_books_name_unique ON public.address_books USING btree (tenant_id, lower((name)::text)) WHERE (deleted_at IS NULL);


--
-- Name: analytics_dashboards_owner_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX analytics_dashboards_owner_name_unique ON public.analytics_dashboards USING btree (tenant_id, user_id, lower((name)::text)) WHERE ((deleted_at IS NULL) AND (NOT shared));


--
-- Name: analytics_dashboards_shared_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX analytics_dashboards_shared_name_unique ON public.analytics_dashboards USING btree (tenant_id, lower((name)::text)) WHERE ((deleted_at IS NULL) AND shared);


--
-- Name: analytics_dashboards_tenant_id_shared_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_dashboards_tenant_id_shared_index ON public.analytics_dashboards USING btree (tenant_id, shared);


--
-- Name: analytics_dashboards_tenant_id_user_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_dashboards_tenant_id_user_id_index ON public.analytics_dashboards USING btree (tenant_id, user_id);


--
-- Name: analytics_query_cache_tenant_id_expires_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_query_cache_tenant_id_expires_at_index ON public.analytics_query_cache USING btree (tenant_id, expires_at);


--
-- Name: analytics_query_log_tenant_id_created_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_query_log_tenant_id_created_at_index ON public.analytics_query_log USING btree (tenant_id, created_at);


--
-- Name: analytics_saved_queries_code_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX analytics_saved_queries_code_unique ON public.analytics_saved_queries USING btree (tenant_id, lower((code)::text)) WHERE (deleted_at IS NULL);


--
-- Name: analytics_saved_queries_tenant_id_user_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_saved_queries_tenant_id_user_id_index ON public.analytics_saved_queries USING btree (tenant_id, user_id);


--
-- Name: analytics_widgets_tenant_id_dashboard_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_widgets_tenant_id_dashboard_id_index ON public.analytics_widgets USING btree (tenant_id, dashboard_id);


--
-- Name: analytics_widgets_tenant_id_dataset_code_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_widgets_tenant_id_dataset_code_index ON public.analytics_widgets USING btree (tenant_id, dataset_code);


--
-- Name: app_installations_app_placement_id_started_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_installations_app_placement_id_started_at_index ON public.app_installations USING btree (app_placement_id, started_at);


--
-- Name: app_service_credentials_app_id_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_service_credentials_app_id_status_index ON public.app_service_credentials USING btree (app_id, status);


--
-- Name: app_service_credentials_token_digest_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_service_credentials_token_digest_index ON public.app_service_credentials USING btree (token_digest);


--
-- Name: automatic_role_assignment_rules_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automatic_role_assignment_rules_tenant_id_index ON public.automatic_role_assignment_rules USING btree (tenant_id);


--
-- Name: cache_expiration_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cache_expiration_index ON public.cache USING btree (expiration);


--
-- Name: cache_locks_expiration_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cache_locks_expiration_index ON public.cache_locks USING btree (expiration);


--
-- Name: change_log_entries_retention; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX change_log_entries_retention ON public.change_log_entries USING btree (tenant_id, changed_at);


--
-- Name: change_log_entries_tenant_id_table_name_record_id_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX change_log_entries_tenant_id_table_name_record_id_id_index ON public.change_log_entries USING btree (tenant_id, table_name, record_id, id);


--
-- Name: change_log_setup_fields_scope_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX change_log_setup_fields_scope_unique ON public.change_log_setup_fields USING btree (tenant_id, table_name, field_name) NULLS NOT DISTINCT;


--
-- Name: change_log_setup_tables_scope_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX change_log_setup_tables_scope_unique ON public.change_log_setup_tables USING btree (tenant_id, table_name) NULLS NOT DISTINCT;


--
-- Name: core_module_installations_tenant_id_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX core_module_installations_tenant_id_status_index ON public.core_module_installations USING btree (tenant_id, status);


--
-- Name: document_attachments_tenant_id_record_type_record_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_attachments_tenant_id_record_type_record_id_index ON public.document_attachments USING btree (tenant_id, record_type, record_id);


--
-- Name: document_notes_tenant_id_record_type_record_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_notes_tenant_id_record_type_record_id_index ON public.document_notes USING btree (tenant_id, record_type, record_id);


--
-- Name: electronic_addresses_one_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX electronic_addresses_one_primary ON public.electronic_addresses USING btree (tenant_id, location_id, type) WHERE (is_primary AND (deleted_at IS NULL));


--
-- Name: electronic_addresses_tenant_id_location_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX electronic_addresses_tenant_id_location_id_index ON public.electronic_addresses USING btree (tenant_id, location_id);


--
-- Name: environment_members_user_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX environment_members_user_id_index ON public.environment_members USING btree (user_id);


--
-- Name: environment_operations_environment_id_started_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX environment_operations_environment_id_started_at_index ON public.environment_operations USING btree (environment_id, started_at);


--
-- Name: environment_operations_satu_berjalan; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX environment_operations_satu_berjalan ON public.environment_operations USING btree (environment_id) WHERE ((status)::text = 'running'::text);


--
-- Name: environment_operations_satu_salinan_per_sumber; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX environment_operations_satu_salinan_per_sumber ON public.environment_operations USING btree (source_environment_id) WHERE (((status)::text = 'running'::text) AND (source_environment_id IS NOT NULL));


--
-- Name: environments_satu_per_jenis; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX environments_satu_per_jenis ON public.environments USING btree (tenant_id, kind) WHERE (((kind)::text = ANY ((ARRAY['demo'::character varying, 'sandbox'::character varying])::text[])) AND (deleted_at IS NULL));


--
-- Name: environments_satu_produksi; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX environments_satu_produksi ON public.environments USING btree (tenant_id) WHERE (((kind)::text = 'production'::text) AND (deleted_at IS NULL));


--
-- Name: environments_slug_per_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX environments_slug_per_tenant ON public.environments USING btree (tenant_id, slug) WHERE (deleted_at IS NULL);


--
-- Name: environments_tenant_id_kind_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX environments_tenant_id_kind_index ON public.environments USING btree (tenant_id, kind);


--
-- Name: external_identities_issuer_subject_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX external_identities_issuer_subject_unique ON public.external_identities USING btree (issuer, subject) WHERE (deleted_at IS NULL);


--
-- Name: external_identities_user_id_issuer_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX external_identities_user_id_issuer_unique ON public.external_identities USING btree (user_id, issuer) WHERE (deleted_at IS NULL);


--
-- Name: failed_jobs_connection_queue_failed_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX failed_jobs_connection_queue_failed_at_index ON public.failed_jobs USING btree (connection, queue, failed_at);


--
-- Name: finance_posting_deliveries_integration_client_id_status_next_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_posting_deliveries_integration_client_id_status_next_at ON public.finance_posting_deliveries USING btree (integration_client_id, status, next_attempt_at);


--
-- Name: finance_posting_events_finance_posting_id_created_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_posting_events_finance_posting_id_created_at_index ON public.finance_posting_events USING btree (finance_posting_id, created_at);


--
-- Name: finance_posting_lines_tenant_id_business_unit_code_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_posting_lines_tenant_id_business_unit_code_index ON public.finance_posting_lines USING btree (tenant_id, business_unit_code);


--
-- Name: finance_posting_lines_tenant_id_department_code_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_posting_lines_tenant_id_department_code_index ON public.finance_posting_lines USING btree (tenant_id, department_code);


--
-- Name: finance_posting_settings_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_posting_settings_tenant_id_index ON public.finance_posting_settings USING btree (tenant_id);


--
-- Name: finance_postings_tenant_id_legal_entity_id_posting_date_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_postings_tenant_id_legal_entity_id_posting_date_index ON public.finance_postings USING btree (tenant_id, legal_entity_id, posting_date);


--
-- Name: finance_postings_tenant_id_status_posting_date_published_at_ind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_postings_tenant_id_status_posting_date_published_at_ind ON public.finance_postings USING btree (tenant_id, status, posting_date, published_at);


--
-- Name: finance_reference_account_imports_tenant_id_created_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_reference_account_imports_tenant_id_created_at_index ON public.finance_reference_account_imports USING btree (tenant_id, created_at);


--
-- Name: finance_reference_accounts_entity_external_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX finance_reference_accounts_entity_external_unique ON public.finance_reference_accounts USING btree (tenant_id, legal_entity_id, external_id) WHERE (legal_entity_id IS NOT NULL);


--
-- Name: finance_reference_accounts_tenant_external_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX finance_reference_accounts_tenant_external_unique ON public.finance_reference_accounts USING btree (tenant_id, external_id) WHERE (legal_entity_id IS NULL);


--
-- Name: finance_reference_accounts_tenant_id_code_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_reference_accounts_tenant_id_code_index ON public.finance_reference_accounts USING btree (tenant_id, code);


--
-- Name: finance_reference_accounts_tenant_id_legal_entity_id_active_ind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_reference_accounts_tenant_id_legal_entity_id_active_ind ON public.finance_reference_accounts USING btree (tenant_id, legal_entity_id, active);


--
-- Name: finance_settlement_modes_tenant_id_legal_entity_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_settlement_modes_tenant_id_legal_entity_id_index ON public.finance_settlement_modes USING btree (tenant_id, legal_entity_id);


--
-- Name: fiscal_periods_fiscal_year_id_starts_on_ends_on_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fiscal_periods_fiscal_year_id_starts_on_ends_on_index ON public.fiscal_periods USING btree (fiscal_year_id, starts_on, ends_on);


--
-- Name: fiscal_years_fiscal_calendar_id_starts_on_ends_on_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fiscal_years_fiscal_calendar_id_starts_on_ends_on_index ON public.fiscal_years USING btree (fiscal_calendar_id, starts_on, ends_on);


--
-- Name: funding_sources_active_code_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX funding_sources_active_code_unique ON public.funding_sources USING btree (tenant_id, code) WHERE (deleted_at IS NULL);


--
-- Name: funding_sources_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX funding_sources_tenant_id_index ON public.funding_sources USING btree (tenant_id);


--
-- Name: idx_postal_codes_district_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_postal_codes_district_id ON public.ref_postal_codes USING btree (district_id);


--
-- Name: idx_postal_codes_province_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_postal_codes_province_id ON public.ref_postal_codes USING btree (province_id);


--
-- Name: idx_postal_codes_regency_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_postal_codes_regency_id ON public.ref_postal_codes USING btree (regency_id);


--
-- Name: idx_postal_codes_village_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_postal_codes_village_id ON public.ref_postal_codes USING btree (village_id);


--
-- Name: idx_villages_district_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_villages_district_code ON public.ref_villages USING btree (district_id, code);


--
-- Name: idx_villages_district_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_villages_district_type ON public.ref_villages USING btree (district_id, type);


--
-- Name: idx_villages_postal_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_villages_postal_code ON public.ref_villages USING btree (postal_code);


--
-- Name: integration_clients_tenant_id_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX integration_clients_tenant_id_status_index ON public.integration_clients USING btree (tenant_id, status);


--
-- Name: invitation_codes_sso_issuer_sso_subject_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invitation_codes_sso_issuer_sso_subject_index ON public.invitation_codes USING btree (sso_issuer, sso_subject);


--
-- Name: invitation_data_policy_scopes_invitation_id_role_id_policy_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invitation_data_policy_scopes_invitation_id_role_id_policy_code ON public.invitation_data_policy_scopes USING btree (invitation_id, role_id, policy_code);


--
-- Name: jobs_queue_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jobs_queue_index ON public.jobs USING btree (queue);


--
-- Name: locations_lookup_cursor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX locations_lookup_cursor ON public.locations USING btree (tenant_id, name, id) WHERE (deleted_at IS NULL);


--
-- Name: managed_product_tenants_customer_product_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX managed_product_tenants_customer_product_active ON public.managed_product_tenants USING btree (owner_customer_id, product) WHERE ((deleted_at IS NULL) AND (owner_customer_id IS NOT NULL));


--
-- Name: managed_product_tenants_product_slug_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX managed_product_tenants_product_slug_active ON public.managed_product_tenants USING btree (product, slug) WHERE (deleted_at IS NULL);


--
-- Name: managed_product_tenants_status_lease_until_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX managed_product_tenants_status_lease_until_index ON public.managed_product_tenants USING btree (status, lease_until);


--
-- Name: number_sequence_allocations_live; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX number_sequence_allocations_live ON public.number_sequence_allocations USING btree (sequence_id, scope_key, period_key, created_at) WHERE (next_number <= last_number);


--
-- Name: number_sequence_allocations_sequence_id_scope_key_period_key_in; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX number_sequence_allocations_sequence_id_scope_key_period_key_in ON public.number_sequence_allocations USING btree (sequence_id, scope_key, period_key);


--
-- Name: number_sequence_audit_events_sequence_id_occurred_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX number_sequence_audit_events_sequence_id_occurred_at_index ON public.number_sequence_audit_events USING btree (sequence_id, occurred_at);


--
-- Name: number_sequence_continuous_pool_available; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX number_sequence_continuous_pool_available ON public.number_sequence_continuous_pool USING btree (sequence_id, scope_key, period_key, status, numeric_value);


--
-- Name: number_sequence_continuous_pool_confirmed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX number_sequence_continuous_pool_confirmed ON public.number_sequence_continuous_pool USING btree (updated_at) WHERE ((status)::text = 'confirmed'::text);


--
-- Name: number_sequence_continuous_pool_reservation_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX number_sequence_continuous_pool_reservation_id_index ON public.number_sequence_continuous_pool USING btree (reservation_id);


--
-- Name: number_sequence_reservations_sequence_id_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX number_sequence_reservations_sequence_id_status_index ON public.number_sequence_reservations USING btree (sequence_id, status);


--
-- Name: number_sequence_reservations_status_expires_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX number_sequence_reservations_status_expires_at_index ON public.number_sequence_reservations USING btree (status, expires_at);


--
-- Name: operating_units_tenant_number_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX operating_units_tenant_number_unique ON public.operating_units USING btree (tenant_id, number) WHERE (number IS NOT NULL);


--
-- Name: operator_audit_events_subject_type_subject_id_occurred_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX operator_audit_events_subject_type_subject_id_occurred_at_index ON public.operator_audit_events USING btree (subject_type, subject_id, occurred_at);


--
-- Name: operator_audit_events_user_id_occurred_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX operator_audit_events_user_id_occurred_at_index ON public.operator_audit_events USING btree (user_id, occurred_at);


--
-- Name: organizations_lookup_cursor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organizations_lookup_cursor ON public.organizations USING btree (tenant_id, classification, name, id);


--
-- Name: outbox_event_correlation_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outbox_event_correlation_index ON public.outbox_events USING btree (tenant_id, correlation_id);


--
-- Name: outbox_events_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outbox_events_tenant_id_index ON public.outbox_events USING btree (tenant_id);


--
-- Name: outbox_events_type_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outbox_events_type_index ON public.outbox_events USING btree (type);


--
-- Name: parties_creation_key_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX parties_creation_key_unique ON public.parties USING btree (tenant_id, creation_key) WHERE (creation_key IS NOT NULL);


--
-- Name: parties_lookup_cursor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX parties_lookup_cursor ON public.parties USING btree (tenant_id, status, name, id) WHERE (deleted_at IS NULL);


--
-- Name: parties_name_text_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX parties_name_text_search ON public.parties USING gin (to_tsvector('simple'::regconfig, regexp_replace(NORMALIZE(COALESCE((name)::text, ''::text), NFC), '[^[:alnum:]]+'::text, ' '::text, 'g'::text))) WHERE (deleted_at IS NULL);


--
-- Name: parties_number_active_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX parties_number_active_unique ON public.parties USING btree (tenant_id, number) WHERE (deleted_at IS NULL);


--
-- Name: parties_tenant_id_search_name_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX parties_tenant_id_search_name_index ON public.parties USING btree (tenant_id, search_name);


--
-- Name: parties_tenant_id_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX parties_tenant_id_status_index ON public.parties USING btree (tenant_id, status);


--
-- Name: party_address_books_active_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX party_address_books_active_unique ON public.party_address_books USING btree (tenant_id, party_id, address_book_id) WHERE (deleted_at IS NULL);


--
-- Name: party_location_purposes_one_each; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX party_location_purposes_one_each ON public.party_location_purposes USING btree (party_location_id, purpose_code) WHERE (deleted_at IS NULL);


--
-- Name: party_location_purposes_tenant_id_party_location_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX party_location_purposes_tenant_id_party_location_id_index ON public.party_location_purposes USING btree (tenant_id, party_location_id);


--
-- Name: party_locations_one_link; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX party_locations_one_link ON public.party_locations USING btree (tenant_id, party_id, location_id) WHERE (deleted_at IS NULL);


--
-- Name: party_locations_one_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX party_locations_one_primary ON public.party_locations USING btree (tenant_id, party_id) WHERE (is_primary AND (deleted_at IS NULL));


--
-- Name: party_locations_tenant_id_location_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX party_locations_tenant_id_location_id_index ON public.party_locations USING btree (tenant_id, location_id);


--
-- Name: party_locations_tenant_id_party_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX party_locations_tenant_id_party_id_index ON public.party_locations USING btree (tenant_id, party_id);


--
-- Name: party_relationships_active_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX party_relationships_active_unique ON public.party_relationships USING btree (tenant_id, from_party_id, to_party_id, relationship_type_code, valid_from) WHERE (deleted_at IS NULL);


--
-- Name: party_role_registrations_tenant_id_role_code_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX party_role_registrations_tenant_id_role_code_index ON public.party_role_registrations USING btree (tenant_id, role_code);


--
-- Name: passkeys_user_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX passkeys_user_id_index ON public.passkeys USING btree (user_id);


--
-- Name: planning_years_active_year_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX planning_years_active_year_unique ON public.planning_years USING btree (tenant_id, legal_entity_id, year) WHERE (deleted_at IS NULL);


--
-- Name: planning_years_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX planning_years_tenant_id_index ON public.planning_years USING btree (tenant_id);


--
-- Name: postal_addresses_tenant_id_location_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX postal_addresses_tenant_id_location_id_index ON public.postal_addresses USING btree (tenant_id, location_id);


--
-- Name: product_customer_sessions_customer_id_expires_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_customer_sessions_customer_id_expires_at_index ON public.product_customer_sessions USING btree (customer_id, expires_at);


--
-- Name: product_customers_verified_email_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX product_customers_verified_email_active ON public.product_customers USING btree (verified_email) WHERE ((deleted_at IS NULL) AND (verified_email IS NOT NULL));


--
-- Name: product_email_challenges_customer_id_created_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_email_challenges_customer_id_created_at_index ON public.product_email_challenges USING btree (customer_id, created_at);


--
-- Name: ref_administrative_division_external_codes_division_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_administrative_division_external_codes_division_id_index ON public.ref_administrative_division_external_codes USING btree (division_id);


--
-- Name: ref_administrative_division_external_codes_system_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_administrative_division_external_codes_system_index ON public.ref_administrative_division_external_codes USING btree (system);


--
-- Name: ref_administrative_division_timezones_division_type_division_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_administrative_division_timezones_division_type_division_id ON public.ref_administrative_division_timezones USING btree (division_type, division_id);


--
-- Name: ref_administrative_division_translations_division_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_administrative_division_translations_division_id_index ON public.ref_administrative_division_translations USING btree (division_id);


--
-- Name: ref_administrative_division_translations_locale_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_administrative_division_translations_locale_index ON public.ref_administrative_division_translations USING btree (locale);


--
-- Name: ref_administrative_divisions_country_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_administrative_divisions_country_id_index ON public.ref_administrative_divisions USING btree (country_id);


--
-- Name: ref_administrative_divisions_display_code_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_administrative_divisions_display_code_index ON public.ref_administrative_divisions USING btree (display_code);


--
-- Name: ref_administrative_divisions_level_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_administrative_divisions_level_index ON public.ref_administrative_divisions USING btree (level);


--
-- Name: ref_administrative_divisions_official_code_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_administrative_divisions_official_code_index ON public.ref_administrative_divisions USING btree (official_code);


--
-- Name: ref_administrative_divisions_parent_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_administrative_divisions_parent_id_index ON public.ref_administrative_divisions USING btree (parent_id);


--
-- Name: ref_administrative_divisions_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_administrative_divisions_status_index ON public.ref_administrative_divisions USING btree (status);


--
-- Name: ref_administrative_divisions_type_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_administrative_divisions_type_index ON public.ref_administrative_divisions USING btree (type);


--
-- Name: ref_buildings_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_buildings_tenant_id_index ON public.ref_buildings USING btree (tenant_id);


--
-- Name: ref_buildings_village_id_name_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_buildings_village_id_name_index ON public.ref_buildings USING btree (village_id, name);


--
-- Name: ref_country_hierarchy_levels_country_code_level_code_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_country_hierarchy_levels_country_code_level_code_index ON public.ref_country_hierarchy_levels USING btree (country_code, level_code);


--
-- Name: ref_districts_display_code_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_districts_display_code_index ON public.ref_districts USING btree (display_code);


--
-- Name: ref_districts_regency_id_code_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_districts_regency_id_code_index ON public.ref_districts USING btree (regency_id, code);


--
-- Name: ref_districts_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_districts_tenant_id_index ON public.ref_districts USING btree (tenant_id);


--
-- Name: ref_group_of_houses_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_group_of_houses_tenant_id_index ON public.ref_group_of_houses USING btree (tenant_id);


--
-- Name: ref_group_of_houses_village_id_name_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_group_of_houses_village_id_name_index ON public.ref_group_of_houses USING btree (village_id, name);


--
-- Name: ref_land_plots_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_land_plots_tenant_id_index ON public.ref_land_plots USING btree (tenant_id);


--
-- Name: ref_land_plots_village_id_plot_number_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_land_plots_village_id_plot_number_index ON public.ref_land_plots USING btree (village_id, plot_number);


--
-- Name: ref_postal_codes_postal_code_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_postal_codes_postal_code_index ON public.ref_postal_codes USING btree (postal_code);


--
-- Name: ref_postal_codes_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_postal_codes_tenant_id_index ON public.ref_postal_codes USING btree (tenant_id);


--
-- Name: ref_provinces_country_code_code_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_provinces_country_code_code_index ON public.ref_provinces USING btree (country_code, code);


--
-- Name: ref_provinces_display_code_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_provinces_display_code_index ON public.ref_provinces USING btree (display_code);


--
-- Name: ref_provinces_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_provinces_tenant_id_index ON public.ref_provinces USING btree (tenant_id);


--
-- Name: ref_regencies_display_code_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_regencies_display_code_index ON public.ref_regencies USING btree (display_code);


--
-- Name: ref_regencies_province_id_code_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_regencies_province_id_code_index ON public.ref_regencies USING btree (province_id, code);


--
-- Name: ref_regencies_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_regencies_tenant_id_index ON public.ref_regencies USING btree (tenant_id);


--
-- Name: ref_streets_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_streets_tenant_id_index ON public.ref_streets USING btree (tenant_id);


--
-- Name: ref_streets_village_id_rt_rw_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_streets_village_id_rt_rw_index ON public.ref_streets USING btree (village_id, rt, rw);


--
-- Name: ref_villages_display_code_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_villages_display_code_index ON public.ref_villages USING btree (display_code);


--
-- Name: ref_villages_district_id_code_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_villages_district_id_code_index ON public.ref_villages USING btree (district_id, code);


--
-- Name: ref_villages_postal_code_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_villages_postal_code_index ON public.ref_villages USING btree (postal_code);


--
-- Name: ref_villages_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_villages_tenant_id_index ON public.ref_villages USING btree (tenant_id);


--
-- Name: report_exports_expires_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_exports_expires_at_index ON public.report_exports USING btree (expires_at);


--
-- Name: report_exports_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_exports_tenant_id_index ON public.report_exports USING btree (tenant_id);


--
-- Name: report_exports_tenant_id_user_id_created_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_exports_tenant_id_user_id_created_at_index ON public.report_exports USING btree (tenant_id, user_id, created_at);


--
-- Name: report_last_used_options_user_report_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX report_last_used_options_user_report_unique ON public.report_last_used_options USING btree (tenant_id, user_id, report_code) WHERE (deleted_at IS NULL);


--
-- Name: report_layout_defaults_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_layout_defaults_tenant_id_index ON public.report_layout_defaults USING btree (tenant_id);


--
-- Name: report_layouts_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_layouts_tenant_id_index ON public.report_layouts USING btree (tenant_id);


--
-- Name: report_layouts_tenant_id_report_code_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_layouts_tenant_id_report_code_index ON public.report_layouts USING btree (tenant_id, report_code);


--
-- Name: report_presets_owner_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX report_presets_owner_name_unique ON public.report_presets USING btree (tenant_id, report_code, user_id, lower((name)::text)) WHERE ((deleted_at IS NULL) AND (NOT shared));


--
-- Name: report_presets_shared_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX report_presets_shared_name_unique ON public.report_presets USING btree (tenant_id, report_code, lower((name)::text)) WHERE ((deleted_at IS NULL) AND shared);


--
-- Name: report_presets_tenant_id_report_code_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_presets_tenant_id_report_code_index ON public.report_presets USING btree (tenant_id, report_code);


--
-- Name: retention_policy_log_entries_tenant_id_created_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retention_policy_log_entries_tenant_id_created_at_index ON public.retention_policy_log_entries USING btree (tenant_id, created_at);


--
-- Name: role_assignment_data_policy_scopes_role_assignment_id_policy_co; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX role_assignment_data_policy_scopes_role_assignment_id_policy_co ON public.role_assignment_data_policy_scopes USING btree (role_assignment_id, policy_code);


--
-- Name: role_assignment_data_policy_scopes_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX role_assignment_data_policy_scopes_tenant_id_index ON public.role_assignment_data_policy_scopes USING btree (tenant_id);


--
-- Name: role_assignment_data_policy_scopes_tenant_id_policy_code_valid_; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX role_assignment_data_policy_scopes_tenant_id_policy_code_valid_ ON public.role_assignment_data_policy_scopes USING btree (tenant_id, policy_code, valid_from);


--
-- Name: roles_satu_owner_per_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX roles_satu_owner_per_tenant ON public.roles USING btree (tenant_id) WHERE is_owner;


--
-- Name: security_duties_tenant_id_source_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX security_duties_tenant_id_source_status_index ON public.security_duties USING btree (tenant_id, source, status);


--
-- Name: security_privileges_tenant_id_source_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX security_privileges_tenant_id_source_status_index ON public.security_privileges USING btree (tenant_id, source, status);


--
-- Name: security_role_children_child_role_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX security_role_children_child_role_id_index ON public.security_role_children USING btree (child_role_id);


--
-- Name: sessions_last_activity_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_last_activity_index ON public.sessions USING btree (last_activity);


--
-- Name: sessions_user_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_user_id_index ON public.sessions USING btree (user_id);


--
-- Name: site_enrollment_tokens_site_id_created_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX site_enrollment_tokens_site_id_created_at_index ON public.site_enrollment_tokens USING btree (site_id, created_at);


--
-- Name: site_operations_robot_tersisa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX site_operations_robot_tersisa ON public.site_operations USING btree (site_id) WHERE (registry_robot_id IS NOT NULL);


--
-- Name: site_operations_satu_berjalan; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX site_operations_satu_berjalan ON public.site_operations USING btree (site_id) WHERE ((status)::text = 'running'::text);


--
-- Name: site_operations_satu_permintaan_per_jenis; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX site_operations_satu_permintaan_per_jenis ON public.site_operations USING btree (site_id, operation) WHERE ((status)::text = 'requested'::text);


--
-- Name: site_operations_site_id_requested_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX site_operations_site_id_requested_at_index ON public.site_operations USING btree (site_id, requested_at);


--
-- Name: site_reports_site_id_received_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX site_reports_site_id_received_at_index ON public.site_reports USING btree (site_id, received_at);


--
-- Name: sites_satu_per_lingkungan; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sites_satu_per_lingkungan ON public.sites USING btree (environment_id) WHERE (environment_id IS NOT NULL);


--
-- Name: sso_login_attempts_invitation_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sso_login_attempts_invitation_id_index ON public.sso_login_attempts USING btree (invitation_id);


--
-- Name: tenant_deployments_placement_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tenant_deployments_placement_status_index ON public.tenant_deployments USING btree (placement, status);


--
-- Name: time_zones_country_code_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX time_zones_country_code_index ON public.time_zones USING btree (country_code);


--
-- Name: time_zones_iana_name_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX time_zones_iana_name_index ON public.time_zones USING btree (iana_name);


--
-- Name: undangan_sso_satu_yang_terbuka; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX undangan_sso_satu_yang_terbuka ON public.invitation_codes USING btree (tenant_id, sso_issuer, sso_subject) WHERE ((sso_subject IS NOT NULL) AND (revoked_at IS NULL) AND (sso_redeemed_at IS NULL));


--
-- Name: units_of_measure_tenant_id_code_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX units_of_measure_tenant_id_code_unique ON public.units_of_measure USING btree (tenant_id, code) WHERE (deleted_at IS NULL);


--
-- Name: units_of_measure_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX units_of_measure_tenant_id_index ON public.units_of_measure USING btree (tenant_id);


--
-- Name: uom_classes_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX uom_classes_tenant_id_index ON public.uom_classes USING btree (tenant_id);


--
-- Name: uom_conversions_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX uom_conversions_tenant_id_index ON public.uom_conversions USING btree (tenant_id);


--
-- Name: uom_external_codes_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX uom_external_codes_tenant_id_index ON public.uom_external_codes USING btree (tenant_id);


--
-- Name: uom_systems_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX uom_systems_tenant_id_index ON public.uom_systems USING btree (tenant_id);


--
-- Name: uom_translations_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX uom_translations_tenant_id_index ON public.uom_translations USING btree (tenant_id);


--
-- Name: vendors_number_text_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vendors_number_text_search ON public.vendors USING gin (to_tsvector('simple'::regconfig, ((regexp_replace(NORMALIZE(COALESCE((number)::text, ''::text), NFC), '[^[:alnum:]]+'::text, ' '::text, 'g'::text) || ' '::text) || regexp_replace(NORMALIZE(COALESCE((number)::text, ''::text), NFC), '[[:space:].\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff-]+'::text, ''::text, 'g'::text))));


--
-- Name: vendors_tax_number_text_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vendors_tax_number_text_search ON public.vendors USING gin (to_tsvector('simple'::regconfig, ((regexp_replace(NORMALIZE(COALESCE((tax_number)::text, ''::text), NFC), '[^[:alnum:]]+'::text, ' '::text, 'g'::text) || ' '::text) || regexp_replace(NORMALIZE(COALESCE((tax_number)::text, ''::text), NFC), '[[:space:].\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff-]+'::text, ''::text, 'g'::text))));


--
-- Name: vendors_tenant_id_updated_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vendors_tenant_id_updated_at_index ON public.vendors USING btree (tenant_id, updated_at);


--
-- Name: vendors_tenant_number_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX vendors_tenant_number_unique ON public.vendors USING btree (tenant_id, number);


--
-- Name: workflow_configuration_scope_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_configuration_scope_index ON public.workflow_configurations USING btree (tenant_id, workflow_type_id, legal_entity_id);


--
-- Name: workflow_configurations_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_configurations_tenant_id_index ON public.workflow_configurations USING btree (tenant_id);


--
-- Name: workflow_history_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_history_tenant_id_index ON public.workflow_history USING btree (tenant_id);


--
-- Name: workflow_instance_correlation_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_instance_correlation_index ON public.workflow_instances USING btree (tenant_id, correlation_id);


--
-- Name: workflow_instances_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_instances_tenant_id_index ON public.workflow_instances USING btree (tenant_id);


--
-- Name: workflow_work_items_inbox_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_work_items_inbox_index ON public.workflow_work_items USING btree (tenant_id, assigned_membership_id, status);


--
-- Name: workflow_work_items_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_work_items_tenant_id_index ON public.workflow_work_items USING btree (tenant_id);


--
-- Name: working_time_calendar_days_tenant_id_working_time_calendar_id_d; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX working_time_calendar_days_tenant_id_working_time_calendar_id_d ON public.working_time_calendar_days USING btree (tenant_id, working_time_calendar_id, date);


--
-- Name: working_time_calendar_lines_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX working_time_calendar_lines_tenant_id_index ON public.working_time_calendar_lines USING btree (tenant_id);


--
-- Name: working_time_calendar_lines_working_time_calendar_day_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX working_time_calendar_lines_working_time_calendar_day_id_index ON public.working_time_calendar_lines USING btree (working_time_calendar_day_id);


--
-- Name: working_time_calendars_base_calendar_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX working_time_calendars_base_calendar_id_index ON public.working_time_calendars USING btree (base_calendar_id);


--
-- Name: working_time_calendars_code_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX working_time_calendars_code_unique ON public.working_time_calendars USING btree (tenant_id, legal_entity_id, code) WHERE (deleted_at IS NULL);


--
-- Name: working_time_calendars_tenant_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX working_time_calendars_tenant_id_index ON public.working_time_calendars USING btree (tenant_id);


--
-- Name: working_time_calendars_tenant_id_legal_entity_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX working_time_calendars_tenant_id_legal_entity_id_index ON public.working_time_calendars USING btree (tenant_id, legal_entity_id);


--
-- Name: working_time_lines_working_time_template_id_day_of_week_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX working_time_lines_working_time_template_id_day_of_week_index ON public.working_time_lines USING btree (working_time_template_id, day_of_week);


--
-- Name: working_time_templates_tenant_id_legal_entity_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX working_time_templates_tenant_id_legal_entity_id_index ON public.working_time_templates USING btree (tenant_id, legal_entity_id);


--
-- Name: access_audit_events bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.access_audit_events FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: address_books bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.address_books FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: analytics_dashboards bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.analytics_dashboards FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: analytics_query_cache bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.analytics_query_cache FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: analytics_query_log bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.analytics_query_log FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: analytics_saved_queries bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.analytics_saved_queries FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: analytics_widgets bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.analytics_widgets FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: app_service_credentials bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.app_service_credentials FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version('last_used_at', 'updated_at');


--
-- Name: automatic_role_assignment_rules bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.automatic_role_assignment_rules FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: change_log_entries bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.change_log_entries FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: change_log_setup_fields bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.change_log_setup_fields FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: change_log_setup_tables bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.change_log_setup_tables FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: currency_precisions bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.currency_precisions FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: document_attachments bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.document_attachments FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: document_notes bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.document_notes FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: electronic_addresses bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.electronic_addresses FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: finance_posting_deliveries bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.finance_posting_deliveries FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: finance_posting_events bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.finance_posting_events FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: finance_posting_lines bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.finance_posting_lines FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: finance_posting_settings bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.finance_posting_settings FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: finance_postings bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.finance_postings FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: finance_reference_account_imports bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.finance_reference_account_imports FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: finance_reference_accounts bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.finance_reference_accounts FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: finance_settlement_modes bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.finance_settlement_modes FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: fiscal_calendars bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.fiscal_calendars FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: funding_sources bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.funding_sources FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: integration_clients bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.integration_clients FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version('last_used_at', 'last_pulled_at', 'updated_at');


--
-- Name: invitation_codes bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.invitation_codes FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: legal_entities bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.legal_entities FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: locations bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.locations FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: operating_units bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.operating_units FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: organization_hierarchies bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.organization_hierarchies FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: organization_parties bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.organization_parties FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: organizations bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: outbox_events bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.outbox_events FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: parties bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.parties FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: party_address_books bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.party_address_books FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: party_location_purposes bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.party_location_purposes FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: party_locations bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.party_locations FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: party_relationships bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.party_relationships FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: party_role_registrations bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.party_role_registrations FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: planning_years bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.planning_years FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: postal_addresses bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.postal_addresses FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: print_identities bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.print_identities FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: ref_buildings bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.ref_buildings FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: ref_districts bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.ref_districts FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: ref_group_of_houses bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.ref_group_of_houses FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: ref_land_plots bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.ref_land_plots FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: ref_postal_codes bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.ref_postal_codes FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: ref_provinces bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.ref_provinces FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: ref_regencies bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.ref_regencies FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: ref_streets bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.ref_streets FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: ref_villages bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.ref_villages FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: report_exports bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.report_exports FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: report_last_used_options bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.report_last_used_options FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: report_layout_defaults bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.report_layout_defaults FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: report_layouts bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.report_layouts FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: report_presets bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.report_presets FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: retention_policy_log_entries bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.retention_policy_log_entries FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: retention_policy_setups bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.retention_policy_setups FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: role_assignment_data_policy_scopes bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.role_assignment_data_policy_scopes FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: roles bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: security_duties bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.security_duties FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: security_privileges bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.security_privileges FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: security_role_children bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.security_role_children FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: sod_conflicts bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.sod_conflicts FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: sod_rules bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.sod_rules FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: tenant_app_entitlements bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.tenant_app_entitlements FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: tenant_deployments bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.tenant_deployments FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: tenant_memberships bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.tenant_memberships FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: tenant_number_sequences bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.tenant_number_sequences FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: units_of_measure bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.units_of_measure FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: uom_classes bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.uom_classes FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: uom_conversions bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.uom_conversions FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: uom_external_codes bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.uom_external_codes FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: uom_systems bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.uom_systems FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: uom_translations bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.uom_translations FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: vendors bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: workflow_configurations bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.workflow_configurations FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: workflow_history bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.workflow_history FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: workflow_instances bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.workflow_instances FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: workflow_parameters bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.workflow_parameters FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: workflow_work_items bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.workflow_work_items FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: working_time_calendar_days bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.working_time_calendar_days FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: working_time_calendar_lines bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.working_time_calendar_lines FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: working_time_calendars bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.working_time_calendars FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: working_time_lines bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.working_time_lines FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: working_time_templates bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.working_time_templates FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: change_log_entries forbid_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER forbid_update BEFORE UPDATE ON public.change_log_entries FOR EACH ROW EXECUTE FUNCTION public.coreerp_forbid_change_log_update();


--
-- Name: access_audit_events log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.access_audit_events FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: address_books log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.address_books FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: analytics_dashboards log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.analytics_dashboards FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: analytics_query_cache log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.analytics_query_cache FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: analytics_query_log log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.analytics_query_log FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: analytics_saved_queries log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.analytics_saved_queries FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: analytics_widgets log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.analytics_widgets FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: app_service_credentials log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.app_service_credentials FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: automatic_role_assignment_rules log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.automatic_role_assignment_rules FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: change_log_entries log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.change_log_entries FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: change_log_setup_fields log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.change_log_setup_fields FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: change_log_setup_tables log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.change_log_setup_tables FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: core_module_installations log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.core_module_installations FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change('module_id');


--
-- Name: currency_precisions log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.currency_precisions FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: document_attachments log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.document_attachments FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: document_notes log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.document_notes FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: electronic_addresses log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.electronic_addresses FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: finance_posting_deliveries log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.finance_posting_deliveries FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: finance_posting_events log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.finance_posting_events FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: finance_posting_lines log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.finance_posting_lines FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: finance_posting_settings log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.finance_posting_settings FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change('legal_entity_id');


--
-- Name: finance_postings log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.finance_postings FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: finance_reference_account_imports log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.finance_reference_account_imports FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: finance_reference_accounts log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.finance_reference_accounts FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: finance_settlement_modes log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.finance_settlement_modes FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: fiscal_calendars log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.fiscal_calendars FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: funding_sources log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.funding_sources FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: integration_clients log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.integration_clients FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: invitation_codes log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.invitation_codes FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: legal_entities log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.legal_entities FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: locations log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.locations FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: operating_units log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.operating_units FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: organization_hierarchies log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.organization_hierarchies FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: organization_parties log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.organization_parties FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: organizations log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: outbox_events log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.outbox_events FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: parties log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.parties FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: party_address_books log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.party_address_books FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: party_location_purposes log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.party_location_purposes FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: party_locations log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.party_locations FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: party_relationships log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.party_relationships FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: party_role_registrations log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.party_role_registrations FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: planning_years log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.planning_years FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: postal_addresses log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.postal_addresses FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: print_identities log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.print_identities FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: ref_buildings log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.ref_buildings FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: ref_districts log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.ref_districts FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: ref_group_of_houses log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.ref_group_of_houses FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: ref_land_plots log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.ref_land_plots FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: ref_postal_codes log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.ref_postal_codes FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: ref_provinces log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.ref_provinces FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: ref_regencies log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.ref_regencies FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: ref_streets log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.ref_streets FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: ref_villages log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.ref_villages FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: report_exports log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.report_exports FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: report_last_used_options log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.report_last_used_options FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: report_layout_defaults log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.report_layout_defaults FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: report_layouts log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.report_layouts FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: report_presets log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.report_presets FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: retention_policy_log_entries log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.retention_policy_log_entries FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: retention_policy_setups log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.retention_policy_setups FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: role_assignment_data_policy_scopes log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.role_assignment_data_policy_scopes FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: role_assignments log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.role_assignments FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: roles log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: security_duties log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.security_duties FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: security_duty_privileges log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.security_duty_privileges FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change('duty_code', 'privilege_code');


--
-- Name: security_privilege_permissions log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.security_privilege_permissions FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change('privilege_code', 'permission_code');


--
-- Name: security_privileges log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.security_privileges FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: security_role_children log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.security_role_children FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change('parent_role_id', 'child_role_id');


--
-- Name: security_role_duties log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.security_role_duties FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change('role_id', 'duty_code');


--
-- Name: sod_conflicts log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.sod_conflicts FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: sod_rules log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.sod_rules FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: tenant_app_entitlements log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.tenant_app_entitlements FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: tenant_deployments log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.tenant_deployments FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: tenant_number_sequences log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.tenant_number_sequences FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: units_of_measure log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.units_of_measure FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: uom_classes log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.uom_classes FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: uom_conversions log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.uom_conversions FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: uom_external_codes log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.uom_external_codes FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: uom_systems log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.uom_systems FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: uom_translations log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.uom_translations FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: vendors log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: workflow_configurations log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.workflow_configurations FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: workflow_history log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.workflow_history FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: workflow_instances log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.workflow_instances FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: workflow_parameters log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.workflow_parameters FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: workflow_work_items log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.workflow_work_items FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: working_time_calendar_days log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.working_time_calendar_days FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: working_time_calendar_lines log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.working_time_calendar_lines FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: working_time_calendars log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.working_time_calendars FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: working_time_lines log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.working_time_lines FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: working_time_templates log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.working_time_templates FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();


--
-- Name: operator_audit_events operator_audit_events_hanya_tambah; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER operator_audit_events_hanya_tambah BEFORE DELETE OR UPDATE ON public.operator_audit_events FOR EACH ROW EXECUTE FUNCTION public.operator_audit_events_tolak_ubah();


--
-- Name: access_audit_events stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.access_audit_events FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: address_books stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.address_books FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: analytics_dashboards stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.analytics_dashboards FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: analytics_query_cache stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.analytics_query_cache FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: analytics_query_log stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.analytics_query_log FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: analytics_saved_queries stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.analytics_saved_queries FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: analytics_widgets stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.analytics_widgets FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: app_service_credentials stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.app_service_credentials FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: automatic_role_assignment_rules stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.automatic_role_assignment_rules FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: change_log_entries stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.change_log_entries FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: change_log_setup_fields stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.change_log_setup_fields FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: change_log_setup_tables stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.change_log_setup_tables FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: core_module_installations stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.core_module_installations FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: currency_precisions stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.currency_precisions FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: document_attachments stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.document_attachments FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: document_notes stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.document_notes FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: electronic_addresses stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.electronic_addresses FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: finance_posting_deliveries stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.finance_posting_deliveries FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: finance_posting_events stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.finance_posting_events FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: finance_posting_lines stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.finance_posting_lines FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: finance_posting_settings stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.finance_posting_settings FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: finance_postings stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.finance_postings FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: finance_reference_account_imports stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.finance_reference_account_imports FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: finance_reference_accounts stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.finance_reference_accounts FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: finance_settlement_modes stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.finance_settlement_modes FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: fiscal_calendars stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.fiscal_calendars FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: funding_sources stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.funding_sources FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: integration_clients stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.integration_clients FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: invitation_codes stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.invitation_codes FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: legal_entities stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.legal_entities FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: locations stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.locations FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: operating_units stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.operating_units FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: organization_hierarchies stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.organization_hierarchies FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: organization_parties stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.organization_parties FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: organizations stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: outbox_events stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.outbox_events FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: parties stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.parties FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: party_address_books stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.party_address_books FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: party_location_purposes stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.party_location_purposes FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: party_locations stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.party_locations FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: party_relationships stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.party_relationships FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: party_role_registrations stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.party_role_registrations FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: planning_years stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.planning_years FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: postal_addresses stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.postal_addresses FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: print_identities stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.print_identities FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: ref_buildings stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.ref_buildings FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: ref_districts stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.ref_districts FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: ref_group_of_houses stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.ref_group_of_houses FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: ref_land_plots stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.ref_land_plots FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: ref_postal_codes stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.ref_postal_codes FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: ref_provinces stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.ref_provinces FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: ref_regencies stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.ref_regencies FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: ref_streets stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.ref_streets FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: ref_villages stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.ref_villages FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: report_exports stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.report_exports FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: report_last_used_options stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.report_last_used_options FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: report_layout_defaults stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.report_layout_defaults FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: report_layouts stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.report_layouts FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: report_presets stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.report_presets FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: retention_policy_log_entries stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.retention_policy_log_entries FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: retention_policy_setups stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.retention_policy_setups FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: role_assignment_data_policy_scopes stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.role_assignment_data_policy_scopes FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: roles stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: security_duties stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.security_duties FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: security_privileges stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.security_privileges FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: security_role_children stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.security_role_children FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: sod_conflicts stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.sod_conflicts FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: sod_rules stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.sod_rules FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: tenant_app_entitlements stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.tenant_app_entitlements FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: tenant_deployments stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.tenant_deployments FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: tenant_number_sequences stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.tenant_number_sequences FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: units_of_measure stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.units_of_measure FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: uom_classes stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.uom_classes FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: uom_conversions stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.uom_conversions FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: uom_external_codes stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.uom_external_codes FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: uom_systems stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.uom_systems FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: uom_translations stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.uom_translations FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: vendors stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: workflow_configurations stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.workflow_configurations FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: workflow_history stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.workflow_history FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: workflow_instances stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.workflow_instances FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: workflow_parameters stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.workflow_parameters FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: workflow_work_items stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.workflow_work_items FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: working_time_calendar_days stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.working_time_calendar_days FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: working_time_calendar_lines stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.working_time_calendar_lines FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: working_time_calendars stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.working_time_calendars FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: working_time_lines stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.working_time_lines FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: working_time_templates stamp_audit_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.working_time_templates FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();


--
-- Name: analytics_widgets analytics_widgets_dashboard_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_widgets
    ADD CONSTRAINT analytics_widgets_dashboard_id_foreign FOREIGN KEY (dashboard_id) REFERENCES public.analytics_dashboards(id);


--
-- Name: app_data_policies app_data_policies_app_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_data_policies
    ADD CONSTRAINT app_data_policies_app_id_foreign FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE CASCADE;


--
-- Name: app_dependencies app_dependencies_app_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_dependencies
    ADD CONSTRAINT app_dependencies_app_id_foreign FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE CASCADE;


--
-- Name: app_dependencies app_dependencies_depends_on_app_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_dependencies
    ADD CONSTRAINT app_dependencies_depends_on_app_id_foreign FOREIGN KEY (depends_on_app_id) REFERENCES public.apps(id) ON DELETE RESTRICT;


--
-- Name: app_entry_points app_entry_points_app_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_entry_points
    ADD CONSTRAINT app_entry_points_app_id_foreign FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE CASCADE;


--
-- Name: app_installations app_installations_app_placement_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_installations
    ADD CONSTRAINT app_installations_app_placement_id_foreign FOREIGN KEY (app_placement_id) REFERENCES public.app_placements(id) ON DELETE CASCADE;


--
-- Name: app_number_sequence_references app_number_sequence_references_app_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_number_sequence_references
    ADD CONSTRAINT app_number_sequence_references_app_id_foreign FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE CASCADE;


--
-- Name: app_placements app_placements_app_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_placements
    ADD CONSTRAINT app_placements_app_id_foreign FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE RESTRICT;


--
-- Name: app_releases app_releases_app_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_releases
    ADD CONSTRAINT app_releases_app_id_foreign FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE RESTRICT;


--
-- Name: app_reports app_reports_app_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_reports
    ADD CONSTRAINT app_reports_app_id_foreign FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE RESTRICT;


--
-- Name: app_service_credentials app_service_credentials_app_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_service_credentials
    ADD CONSTRAINT app_service_credentials_app_id_foreign FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE CASCADE;


--
-- Name: app_service_credentials app_service_credentials_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_service_credentials
    ADD CONSTRAINT app_service_credentials_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: console_settings console_settings_updated_by_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.console_settings
    ADD CONSTRAINT console_settings_updated_by_foreign FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: electronic_addresses electronic_addresses_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.electronic_addresses
    ADD CONSTRAINT electronic_addresses_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: electronic_addresses electronic_addresses_tenant_id_location_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.electronic_addresses
    ADD CONSTRAINT electronic_addresses_tenant_id_location_id_foreign FOREIGN KEY (tenant_id, location_id) REFERENCES public.locations(tenant_id, id) ON DELETE CASCADE;


--
-- Name: environment_members environment_members_environment_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_members
    ADD CONSTRAINT environment_members_environment_id_foreign FOREIGN KEY (environment_id) REFERENCES public.environments(id) ON DELETE CASCADE;


--
-- Name: environment_members environment_members_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_members
    ADD CONSTRAINT environment_members_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: environment_operations environment_operations_environment_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_operations
    ADD CONSTRAINT environment_operations_environment_id_foreign FOREIGN KEY (environment_id) REFERENCES public.environments(id) ON DELETE RESTRICT;


--
-- Name: environment_operations environment_operations_requested_by_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_operations
    ADD CONSTRAINT environment_operations_requested_by_foreign FOREIGN KEY (requested_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: environments environments_created_by_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environments
    ADD CONSTRAINT environments_created_by_foreign FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: environments environments_source_environment_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environments
    ADD CONSTRAINT environments_source_environment_id_foreign FOREIGN KEY (source_environment_id) REFERENCES public.environments(id) ON DELETE RESTRICT;


--
-- Name: environments environments_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environments
    ADD CONSTRAINT environments_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;


--
-- Name: external_identities external_identities_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_identities
    ADD CONSTRAINT external_identities_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: finance_posting_deliveries finance_posting_deliveries_finance_posting_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_posting_deliveries
    ADD CONSTRAINT finance_posting_deliveries_finance_posting_id_foreign FOREIGN KEY (finance_posting_id) REFERENCES public.finance_postings(id) ON DELETE CASCADE;


--
-- Name: finance_posting_deliveries finance_posting_deliveries_integration_client_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_posting_deliveries
    ADD CONSTRAINT finance_posting_deliveries_integration_client_id_foreign FOREIGN KEY (integration_client_id) REFERENCES public.integration_clients(id) ON DELETE CASCADE;


--
-- Name: finance_posting_events finance_posting_events_finance_posting_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_posting_events
    ADD CONSTRAINT finance_posting_events_finance_posting_id_foreign FOREIGN KEY (finance_posting_id) REFERENCES public.finance_postings(id) ON DELETE CASCADE;


--
-- Name: finance_posting_lines finance_posting_lines_finance_posting_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_posting_lines
    ADD CONSTRAINT finance_posting_lines_finance_posting_id_foreign FOREIGN KEY (finance_posting_id) REFERENCES public.finance_postings(id) ON DELETE CASCADE;


--
-- Name: finance_posting_settings finance_posting_settings_tenant_id_legal_entity_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_posting_settings
    ADD CONSTRAINT finance_posting_settings_tenant_id_legal_entity_id_foreign FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE CASCADE;


--
-- Name: finance_postings finance_postings_tenant_id_legal_entity_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_postings
    ADD CONSTRAINT finance_postings_tenant_id_legal_entity_id_foreign FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: finance_reference_accounts finance_reference_accounts_tenant_id_legal_entity_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_reference_accounts
    ADD CONSTRAINT finance_reference_accounts_tenant_id_legal_entity_id_foreign FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE CASCADE;


--
-- Name: finance_settlement_modes finance_settlement_modes_tenant_id_legal_entity_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_settlement_modes
    ADD CONSTRAINT finance_settlement_modes_tenant_id_legal_entity_id_foreign FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE CASCADE;


--
-- Name: fiscal_calendars fiscal_calendars_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_calendars
    ADD CONSTRAINT fiscal_calendars_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: fiscal_periods fiscal_periods_fiscal_year_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_periods
    ADD CONSTRAINT fiscal_periods_fiscal_year_id_foreign FOREIGN KEY (fiscal_year_id) REFERENCES public.fiscal_years(id) ON DELETE CASCADE;


--
-- Name: fiscal_years fiscal_years_fiscal_calendar_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_years
    ADD CONSTRAINT fiscal_years_fiscal_calendar_id_foreign FOREIGN KEY (fiscal_calendar_id) REFERENCES public.fiscal_calendars(id) ON DELETE CASCADE;


--
-- Name: hierarchy_purpose_organization_types hierarchy_purpose_organization_types_purpose_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hierarchy_purpose_organization_types
    ADD CONSTRAINT hierarchy_purpose_organization_types_purpose_id_foreign FOREIGN KEY (purpose_id) REFERENCES public.hierarchy_purposes(id) ON DELETE CASCADE;


--
-- Name: invitation_codes invitation_codes_created_by_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_codes
    ADD CONSTRAINT invitation_codes_created_by_foreign FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: invitation_codes invitation_codes_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_codes
    ADD CONSTRAINT invitation_codes_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: invitation_data_policy_scopes invitation_data_policy_scopes_hierarchy_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_data_policy_scopes
    ADD CONSTRAINT invitation_data_policy_scopes_hierarchy_id_foreign FOREIGN KEY (hierarchy_id) REFERENCES public.organization_hierarchies(id) ON DELETE RESTRICT;


--
-- Name: invitation_data_policy_scopes invitation_data_policy_scopes_hierarchy_version_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_data_policy_scopes
    ADD CONSTRAINT invitation_data_policy_scopes_hierarchy_version_id_foreign FOREIGN KEY (hierarchy_version_id) REFERENCES public.organization_hierarchy_versions(id) ON DELETE RESTRICT;


--
-- Name: invitation_data_policy_scopes invitation_data_policy_scopes_invitation_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_data_policy_scopes
    ADD CONSTRAINT invitation_data_policy_scopes_invitation_id_foreign FOREIGN KEY (invitation_id) REFERENCES public.invitation_codes(id) ON DELETE CASCADE;


--
-- Name: invitation_data_policy_scopes invitation_data_policy_scopes_legal_entity_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_data_policy_scopes
    ADD CONSTRAINT invitation_data_policy_scopes_legal_entity_id_foreign FOREIGN KEY (legal_entity_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: invitation_data_policy_scopes invitation_data_policy_scopes_organization_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_data_policy_scopes
    ADD CONSTRAINT invitation_data_policy_scopes_organization_id_foreign FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: invitation_data_policy_scopes invitation_data_policy_scopes_policy_code_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_data_policy_scopes
    ADD CONSTRAINT invitation_data_policy_scopes_policy_code_foreign FOREIGN KEY (policy_code) REFERENCES public.app_data_policies(code) ON DELETE RESTRICT;


--
-- Name: invitation_data_policy_scopes invitation_data_policy_scopes_role_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_data_policy_scopes
    ADD CONSTRAINT invitation_data_policy_scopes_role_id_foreign FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: invitation_role_assignments invitation_role_assignments_invitation_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_role_assignments
    ADD CONSTRAINT invitation_role_assignments_invitation_id_foreign FOREIGN KEY (invitation_id) REFERENCES public.invitation_codes(id) ON DELETE CASCADE;


--
-- Name: invitation_role_assignments invitation_role_assignments_role_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_role_assignments
    ADD CONSTRAINT invitation_role_assignments_role_id_foreign FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: legal_entities legal_entities_fiscal_calendar_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_entities
    ADD CONSTRAINT legal_entities_fiscal_calendar_id_foreign FOREIGN KEY (fiscal_calendar_id) REFERENCES public.fiscal_calendars(id) ON DELETE SET NULL;


--
-- Name: legal_entities legal_entities_organization_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_entities
    ADD CONSTRAINT legal_entities_organization_id_foreign FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: legal_entities legal_entities_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_entities
    ADD CONSTRAINT legal_entities_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: locations locations_tenant_id_owner_party_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_tenant_id_owner_party_id_foreign FOREIGN KEY (tenant_id, owner_party_id) REFERENCES public.parties(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: managed_product_tenants managed_product_tenants_owner_customer_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.managed_product_tenants
    ADD CONSTRAINT managed_product_tenants_owner_customer_id_foreign FOREIGN KEY (owner_customer_id) REFERENCES public.product_customers(id);


--
-- Name: managed_product_tenants managed_product_tenants_requested_by_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.managed_product_tenants
    ADD CONSTRAINT managed_product_tenants_requested_by_foreign FOREIGN KEY (requested_by) REFERENCES public.users(id);


--
-- Name: number_sequence_allocations number_sequence_allocations_sequence_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_sequence_allocations
    ADD CONSTRAINT number_sequence_allocations_sequence_id_foreign FOREIGN KEY (sequence_id) REFERENCES public.tenant_number_sequences(id) ON DELETE CASCADE;


--
-- Name: number_sequence_audit_events number_sequence_audit_events_app_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_sequence_audit_events
    ADD CONSTRAINT number_sequence_audit_events_app_id_foreign FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE SET NULL;


--
-- Name: number_sequence_audit_events number_sequence_audit_events_sequence_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_sequence_audit_events
    ADD CONSTRAINT number_sequence_audit_events_sequence_id_foreign FOREIGN KEY (sequence_id) REFERENCES public.tenant_number_sequences(id) ON DELETE RESTRICT;


--
-- Name: number_sequence_audit_events number_sequence_audit_events_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_sequence_audit_events
    ADD CONSTRAINT number_sequence_audit_events_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: number_sequence_continuous_pool number_sequence_continuous_pool_sequence_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_sequence_continuous_pool
    ADD CONSTRAINT number_sequence_continuous_pool_sequence_id_foreign FOREIGN KEY (sequence_id) REFERENCES public.tenant_number_sequences(id) ON DELETE CASCADE;


--
-- Name: number_sequence_counters number_sequence_counters_sequence_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_sequence_counters
    ADD CONSTRAINT number_sequence_counters_sequence_id_foreign FOREIGN KEY (sequence_id) REFERENCES public.tenant_number_sequences(id) ON DELETE CASCADE;


--
-- Name: number_sequence_issues number_sequence_issues_app_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_sequence_issues
    ADD CONSTRAINT number_sequence_issues_app_id_foreign FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE RESTRICT;


--
-- Name: number_sequence_issues number_sequence_issues_sequence_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_sequence_issues
    ADD CONSTRAINT number_sequence_issues_sequence_id_foreign FOREIGN KEY (sequence_id) REFERENCES public.tenant_number_sequences(id) ON DELETE RESTRICT;


--
-- Name: number_sequence_reservations number_sequence_reservations_app_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_sequence_reservations
    ADD CONSTRAINT number_sequence_reservations_app_id_foreign FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE RESTRICT;


--
-- Name: number_sequence_reservations number_sequence_reservations_sequence_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_sequence_reservations
    ADD CONSTRAINT number_sequence_reservations_sequence_id_foreign FOREIGN KEY (sequence_id) REFERENCES public.tenant_number_sequences(id) ON DELETE RESTRICT;


--
-- Name: number_sequence_reusable_numbers number_sequence_reusable_numbers_sequence_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.number_sequence_reusable_numbers
    ADD CONSTRAINT number_sequence_reusable_numbers_sequence_id_foreign FOREIGN KEY (sequence_id) REFERENCES public.tenant_number_sequences(id) ON DELETE CASCADE;


--
-- Name: operating_units operating_units_organization_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operating_units
    ADD CONSTRAINT operating_units_organization_id_foreign FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: operator_audit_events operator_audit_events_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_audit_events
    ADD CONSTRAINT operator_audit_events_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: organization_hierarchies organization_hierarchies_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_hierarchies
    ADD CONSTRAINT organization_hierarchies_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: organization_hierarchy_closures organization_hierarchy_closures_ancestor_organization_id_foreig; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_hierarchy_closures
    ADD CONSTRAINT organization_hierarchy_closures_ancestor_organization_id_foreig FOREIGN KEY (ancestor_organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_hierarchy_closures organization_hierarchy_closures_descendant_organization_id_fore; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_hierarchy_closures
    ADD CONSTRAINT organization_hierarchy_closures_descendant_organization_id_fore FOREIGN KEY (descendant_organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_hierarchy_closures organization_hierarchy_closures_version_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_hierarchy_closures
    ADD CONSTRAINT organization_hierarchy_closures_version_id_foreign FOREIGN KEY (version_id) REFERENCES public.organization_hierarchy_versions(id) ON DELETE CASCADE;


--
-- Name: organization_hierarchy_nodes organization_hierarchy_nodes_organization_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_hierarchy_nodes
    ADD CONSTRAINT organization_hierarchy_nodes_organization_id_foreign FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: organization_hierarchy_nodes organization_hierarchy_nodes_parent_node_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_hierarchy_nodes
    ADD CONSTRAINT organization_hierarchy_nodes_parent_node_id_foreign FOREIGN KEY (parent_node_id) REFERENCES public.organization_hierarchy_nodes(id) ON DELETE RESTRICT;


--
-- Name: organization_hierarchy_nodes organization_hierarchy_nodes_version_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_hierarchy_nodes
    ADD CONSTRAINT organization_hierarchy_nodes_version_id_foreign FOREIGN KEY (version_id) REFERENCES public.organization_hierarchy_versions(id) ON DELETE CASCADE;


--
-- Name: organization_hierarchy_purposes organization_hierarchy_purposes_hierarchy_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_hierarchy_purposes
    ADD CONSTRAINT organization_hierarchy_purposes_hierarchy_id_foreign FOREIGN KEY (hierarchy_id) REFERENCES public.organization_hierarchies(id) ON DELETE CASCADE;


--
-- Name: organization_hierarchy_purposes organization_hierarchy_purposes_purpose_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_hierarchy_purposes
    ADD CONSTRAINT organization_hierarchy_purposes_purpose_id_foreign FOREIGN KEY (purpose_id) REFERENCES public.hierarchy_purposes(id) ON DELETE RESTRICT;


--
-- Name: organization_hierarchy_versions organization_hierarchy_versions_hierarchy_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_hierarchy_versions
    ADD CONSTRAINT organization_hierarchy_versions_hierarchy_id_foreign FOREIGN KEY (hierarchy_id) REFERENCES public.organization_hierarchies(id) ON DELETE CASCADE;


--
-- Name: organization_parties organization_parties_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_parties
    ADD CONSTRAINT organization_parties_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: organization_parties organization_parties_tenant_id_organization_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_parties
    ADD CONSTRAINT organization_parties_tenant_id_organization_id_foreign FOREIGN KEY (tenant_id, organization_id) REFERENCES public.organizations(tenant_id, id) ON DELETE CASCADE;


--
-- Name: organization_parties organization_parties_tenant_id_party_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_parties
    ADD CONSTRAINT organization_parties_tenant_id_party_id_foreign FOREIGN KEY (tenant_id, party_id) REFERENCES public.parties(tenant_id, id) ON DELETE CASCADE;


--
-- Name: organizations organizations_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: parties parties_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parties
    ADD CONSTRAINT parties_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: parties parties_type_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parties
    ADD CONSTRAINT parties_type_foreign FOREIGN KEY (type) REFERENCES public.party_types(code) ON DELETE RESTRICT;


--
-- Name: party_address_books party_address_books_tenant_id_address_book_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.party_address_books
    ADD CONSTRAINT party_address_books_tenant_id_address_book_id_foreign FOREIGN KEY (tenant_id, address_book_id) REFERENCES public.address_books(tenant_id, id);


--
-- Name: party_address_books party_address_books_tenant_id_party_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.party_address_books
    ADD CONSTRAINT party_address_books_tenant_id_party_id_foreign FOREIGN KEY (tenant_id, party_id) REFERENCES public.parties(tenant_id, id);


--
-- Name: party_location_purposes party_location_purposes_purpose_code_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.party_location_purposes
    ADD CONSTRAINT party_location_purposes_purpose_code_foreign FOREIGN KEY (purpose_code) REFERENCES public.location_purposes(code) ON DELETE RESTRICT;


--
-- Name: party_location_purposes party_location_purposes_tenant_id_party_location_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.party_location_purposes
    ADD CONSTRAINT party_location_purposes_tenant_id_party_location_id_foreign FOREIGN KEY (tenant_id, party_location_id) REFERENCES public.party_locations(tenant_id, id) ON DELETE CASCADE;


--
-- Name: party_locations party_locations_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.party_locations
    ADD CONSTRAINT party_locations_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: party_locations party_locations_tenant_id_location_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.party_locations
    ADD CONSTRAINT party_locations_tenant_id_location_id_foreign FOREIGN KEY (tenant_id, location_id) REFERENCES public.locations(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: party_locations party_locations_tenant_id_party_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.party_locations
    ADD CONSTRAINT party_locations_tenant_id_party_id_foreign FOREIGN KEY (tenant_id, party_id) REFERENCES public.parties(tenant_id, id) ON DELETE CASCADE;


--
-- Name: party_relationships party_relationships_relationship_type_code_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.party_relationships
    ADD CONSTRAINT party_relationships_relationship_type_code_foreign FOREIGN KEY (relationship_type_code) REFERENCES public.party_relationship_types(code);


--
-- Name: party_relationships party_relationships_tenant_id_from_party_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.party_relationships
    ADD CONSTRAINT party_relationships_tenant_id_from_party_id_foreign FOREIGN KEY (tenant_id, from_party_id) REFERENCES public.parties(tenant_id, id);


--
-- Name: party_relationships party_relationships_tenant_id_to_party_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.party_relationships
    ADD CONSTRAINT party_relationships_tenant_id_to_party_id_foreign FOREIGN KEY (tenant_id, to_party_id) REFERENCES public.parties(tenant_id, id);


--
-- Name: party_role_registrations party_role_registrations_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.party_role_registrations
    ADD CONSTRAINT party_role_registrations_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: party_role_registrations party_role_registrations_tenant_id_legal_entity_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.party_role_registrations
    ADD CONSTRAINT party_role_registrations_tenant_id_legal_entity_id_foreign FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE CASCADE;


--
-- Name: party_role_registrations party_role_registrations_tenant_id_party_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.party_role_registrations
    ADD CONSTRAINT party_role_registrations_tenant_id_party_id_foreign FOREIGN KEY (tenant_id, party_id) REFERENCES public.parties(tenant_id, id) ON DELETE CASCADE;


--
-- Name: passkeys passkeys_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkeys
    ADD CONSTRAINT passkeys_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: permissions permissions_app_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_app_id_foreign FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE CASCADE;


--
-- Name: permissions permissions_entry_point_code_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_entry_point_code_foreign FOREIGN KEY (entry_point_code) REFERENCES public.app_entry_points(code) ON DELETE CASCADE;


--
-- Name: planning_years planning_years_tenant_id_legal_entity_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planning_years
    ADD CONSTRAINT planning_years_tenant_id_legal_entity_id_foreign FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: postal_addresses postal_addresses_country_region_code_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postal_addresses
    ADD CONSTRAINT postal_addresses_country_region_code_foreign FOREIGN KEY (country_region_code) REFERENCES public.country_regions(code) ON DELETE RESTRICT;


--
-- Name: postal_addresses postal_addresses_district_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postal_addresses
    ADD CONSTRAINT postal_addresses_district_id_foreign FOREIGN KEY (district_id) REFERENCES public.ref_districts(id) ON DELETE RESTRICT;


--
-- Name: postal_addresses postal_addresses_postal_code_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postal_addresses
    ADD CONSTRAINT postal_addresses_postal_code_id_foreign FOREIGN KEY (postal_code_id) REFERENCES public.ref_postal_codes(id) ON DELETE RESTRICT;


--
-- Name: postal_addresses postal_addresses_province_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postal_addresses
    ADD CONSTRAINT postal_addresses_province_id_foreign FOREIGN KEY (province_id) REFERENCES public.ref_provinces(id) ON DELETE RESTRICT;


--
-- Name: postal_addresses postal_addresses_regency_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postal_addresses
    ADD CONSTRAINT postal_addresses_regency_id_foreign FOREIGN KEY (regency_id) REFERENCES public.ref_regencies(id) ON DELETE RESTRICT;


--
-- Name: postal_addresses postal_addresses_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postal_addresses
    ADD CONSTRAINT postal_addresses_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: postal_addresses postal_addresses_tenant_id_location_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postal_addresses
    ADD CONSTRAINT postal_addresses_tenant_id_location_id_foreign FOREIGN KEY (tenant_id, location_id) REFERENCES public.locations(tenant_id, id) ON DELETE CASCADE;


--
-- Name: postal_addresses postal_addresses_village_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postal_addresses
    ADD CONSTRAINT postal_addresses_village_id_foreign FOREIGN KEY (village_id) REFERENCES public.ref_villages(id) ON DELETE RESTRICT;


--
-- Name: print_identities print_identities_organization_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_identities
    ADD CONSTRAINT print_identities_organization_id_foreign FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: print_identities print_identities_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_identities
    ADD CONSTRAINT print_identities_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: product_customer_sessions product_customer_sessions_customer_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_customer_sessions
    ADD CONSTRAINT product_customer_sessions_customer_id_foreign FOREIGN KEY (customer_id) REFERENCES public.product_customers(id);


--
-- Name: product_customers product_customers_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_customers
    ADD CONSTRAINT product_customers_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: product_email_challenges product_email_challenges_customer_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_email_challenges
    ADD CONSTRAINT product_email_challenges_customer_id_foreign FOREIGN KEY (customer_id) REFERENCES public.product_customers(id);


--
-- Name: provider_access provider_access_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_access
    ADD CONSTRAINT provider_access_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ref_address_parameters ref_address_parameters_country_code_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_address_parameters
    ADD CONSTRAINT ref_address_parameters_country_code_foreign FOREIGN KEY (country_code) REFERENCES public.country_regions(code) ON DELETE RESTRICT;


--
-- Name: ref_administrative_divisions ref_administrative_divisions_country_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_administrative_divisions
    ADD CONSTRAINT ref_administrative_divisions_country_id_foreign FOREIGN KEY (country_id) REFERENCES public.country_regions(code) ON DELETE RESTRICT;


--
-- Name: ref_administrative_divisions ref_administrative_divisions_parent_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_administrative_divisions
    ADD CONSTRAINT ref_administrative_divisions_parent_id_foreign FOREIGN KEY (parent_id) REFERENCES public.ref_administrative_divisions(id) ON DELETE CASCADE;


--
-- Name: ref_buildings ref_buildings_postal_code_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_buildings
    ADD CONSTRAINT ref_buildings_postal_code_id_foreign FOREIGN KEY (postal_code_id) REFERENCES public.ref_postal_codes(id) ON DELETE SET NULL;


--
-- Name: ref_buildings ref_buildings_street_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_buildings
    ADD CONSTRAINT ref_buildings_street_id_foreign FOREIGN KEY (street_id) REFERENCES public.ref_streets(id) ON DELETE SET NULL;


--
-- Name: ref_buildings ref_buildings_village_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_buildings
    ADD CONSTRAINT ref_buildings_village_id_foreign FOREIGN KEY (village_id) REFERENCES public.ref_villages(id) ON DELETE CASCADE;


--
-- Name: ref_country_hierarchy_levels ref_country_hierarchy_levels_country_code_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_country_hierarchy_levels
    ADD CONSTRAINT ref_country_hierarchy_levels_country_code_foreign FOREIGN KEY (country_code) REFERENCES public.country_regions(code) ON DELETE RESTRICT;


--
-- Name: ref_districts ref_districts_regency_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_districts
    ADD CONSTRAINT ref_districts_regency_id_foreign FOREIGN KEY (regency_id) REFERENCES public.ref_regencies(id) ON DELETE CASCADE;


--
-- Name: ref_group_of_houses ref_group_of_houses_postal_code_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_group_of_houses
    ADD CONSTRAINT ref_group_of_houses_postal_code_id_foreign FOREIGN KEY (postal_code_id) REFERENCES public.ref_postal_codes(id) ON DELETE SET NULL;


--
-- Name: ref_group_of_houses ref_group_of_houses_village_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_group_of_houses
    ADD CONSTRAINT ref_group_of_houses_village_id_foreign FOREIGN KEY (village_id) REFERENCES public.ref_villages(id) ON DELETE CASCADE;


--
-- Name: ref_land_plots ref_land_plots_group_of_houses_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_land_plots
    ADD CONSTRAINT ref_land_plots_group_of_houses_id_foreign FOREIGN KEY (group_of_houses_id) REFERENCES public.ref_group_of_houses(id) ON DELETE SET NULL;


--
-- Name: ref_land_plots ref_land_plots_postal_code_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_land_plots
    ADD CONSTRAINT ref_land_plots_postal_code_id_foreign FOREIGN KEY (postal_code_id) REFERENCES public.ref_postal_codes(id) ON DELETE SET NULL;


--
-- Name: ref_land_plots ref_land_plots_street_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_land_plots
    ADD CONSTRAINT ref_land_plots_street_id_foreign FOREIGN KEY (street_id) REFERENCES public.ref_streets(id) ON DELETE SET NULL;


--
-- Name: ref_land_plots ref_land_plots_village_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_land_plots
    ADD CONSTRAINT ref_land_plots_village_id_foreign FOREIGN KEY (village_id) REFERENCES public.ref_villages(id) ON DELETE CASCADE;


--
-- Name: ref_postal_codes ref_postal_codes_country_code_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_postal_codes
    ADD CONSTRAINT ref_postal_codes_country_code_foreign FOREIGN KEY (country_code) REFERENCES public.country_regions(code) ON DELETE RESTRICT;


--
-- Name: ref_postal_codes ref_postal_codes_district_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_postal_codes
    ADD CONSTRAINT ref_postal_codes_district_id_foreign FOREIGN KEY (district_id) REFERENCES public.ref_districts(id) ON DELETE SET NULL;


--
-- Name: ref_postal_codes ref_postal_codes_province_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_postal_codes
    ADD CONSTRAINT ref_postal_codes_province_id_foreign FOREIGN KEY (province_id) REFERENCES public.ref_provinces(id) ON DELETE SET NULL;


--
-- Name: ref_postal_codes ref_postal_codes_regency_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_postal_codes
    ADD CONSTRAINT ref_postal_codes_regency_id_foreign FOREIGN KEY (regency_id) REFERENCES public.ref_regencies(id) ON DELETE SET NULL;


--
-- Name: ref_postal_codes ref_postal_codes_village_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_postal_codes
    ADD CONSTRAINT ref_postal_codes_village_id_foreign FOREIGN KEY (village_id) REFERENCES public.ref_villages(id) ON DELETE SET NULL;


--
-- Name: ref_provinces ref_provinces_country_code_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_provinces
    ADD CONSTRAINT ref_provinces_country_code_foreign FOREIGN KEY (country_code) REFERENCES public.country_regions(code) ON DELETE RESTRICT;


--
-- Name: ref_regencies ref_regencies_province_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_regencies
    ADD CONSTRAINT ref_regencies_province_id_foreign FOREIGN KEY (province_id) REFERENCES public.ref_provinces(id) ON DELETE CASCADE;


--
-- Name: ref_streets ref_streets_postal_code_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_streets
    ADD CONSTRAINT ref_streets_postal_code_id_foreign FOREIGN KEY (postal_code_id) REFERENCES public.ref_postal_codes(id) ON DELETE SET NULL;


--
-- Name: ref_streets ref_streets_village_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_streets
    ADD CONSTRAINT ref_streets_village_id_foreign FOREIGN KEY (village_id) REFERENCES public.ref_villages(id) ON DELETE CASCADE;


--
-- Name: ref_villages ref_villages_district_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ref_villages
    ADD CONSTRAINT ref_villages_district_id_foreign FOREIGN KEY (district_id) REFERENCES public.ref_districts(id) ON DELETE CASCADE;


--
-- Name: role_assignment_data_policy_scopes role_assignment_data_policy_scopes_hierarchy_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_assignment_data_policy_scopes
    ADD CONSTRAINT role_assignment_data_policy_scopes_hierarchy_id_foreign FOREIGN KEY (hierarchy_id) REFERENCES public.organization_hierarchies(id) ON DELETE RESTRICT;


--
-- Name: role_assignment_data_policy_scopes role_assignment_data_policy_scopes_hierarchy_version_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_assignment_data_policy_scopes
    ADD CONSTRAINT role_assignment_data_policy_scopes_hierarchy_version_id_foreign FOREIGN KEY (hierarchy_version_id) REFERENCES public.organization_hierarchy_versions(id) ON DELETE RESTRICT;


--
-- Name: role_assignment_data_policy_scopes role_assignment_data_policy_scopes_legal_entity_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_assignment_data_policy_scopes
    ADD CONSTRAINT role_assignment_data_policy_scopes_legal_entity_id_foreign FOREIGN KEY (legal_entity_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: role_assignment_data_policy_scopes role_assignment_data_policy_scopes_organization_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_assignment_data_policy_scopes
    ADD CONSTRAINT role_assignment_data_policy_scopes_organization_id_foreign FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: role_assignment_data_policy_scopes role_assignment_data_policy_scopes_policy_code_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_assignment_data_policy_scopes
    ADD CONSTRAINT role_assignment_data_policy_scopes_policy_code_foreign FOREIGN KEY (policy_code) REFERENCES public.app_data_policies(code) ON DELETE RESTRICT;


--
-- Name: role_assignment_data_policy_scopes role_assignment_data_policy_scopes_role_assignment_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_assignment_data_policy_scopes
    ADD CONSTRAINT role_assignment_data_policy_scopes_role_assignment_id_foreign FOREIGN KEY (role_assignment_id) REFERENCES public.role_assignments(id) ON DELETE CASCADE;


--
-- Name: role_assignments role_assignments_membership_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_assignments
    ADD CONSTRAINT role_assignments_membership_id_foreign FOREIGN KEY (membership_id) REFERENCES public.tenant_memberships(id) ON DELETE CASCADE;


--
-- Name: role_assignments role_assignments_role_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_assignments
    ADD CONSTRAINT role_assignments_role_id_foreign FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: roles roles_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: security_duties security_duties_app_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_duties
    ADD CONSTRAINT security_duties_app_id_foreign FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE CASCADE;


--
-- Name: security_duties security_duties_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_duties
    ADD CONSTRAINT security_duties_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: security_duty_privileges security_duty_privileges_duty_code_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_duty_privileges
    ADD CONSTRAINT security_duty_privileges_duty_code_foreign FOREIGN KEY (duty_code) REFERENCES public.security_duties(code) ON DELETE CASCADE;


--
-- Name: security_duty_privileges security_duty_privileges_privilege_code_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_duty_privileges
    ADD CONSTRAINT security_duty_privileges_privilege_code_foreign FOREIGN KEY (privilege_code) REFERENCES public.security_privileges(code) ON DELETE CASCADE;


--
-- Name: security_privilege_permissions security_privilege_permissions_permission_code_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_privilege_permissions
    ADD CONSTRAINT security_privilege_permissions_permission_code_foreign FOREIGN KEY (permission_code) REFERENCES public.permissions(code) ON DELETE CASCADE;


--
-- Name: security_privilege_permissions security_privilege_permissions_privilege_code_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_privilege_permissions
    ADD CONSTRAINT security_privilege_permissions_privilege_code_foreign FOREIGN KEY (privilege_code) REFERENCES public.security_privileges(code) ON DELETE CASCADE;


--
-- Name: security_privileges security_privileges_app_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_privileges
    ADD CONSTRAINT security_privileges_app_id_foreign FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE CASCADE;


--
-- Name: security_privileges security_privileges_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_privileges
    ADD CONSTRAINT security_privileges_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: security_role_children security_role_children_tenant_id_child_role_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_role_children
    ADD CONSTRAINT security_role_children_tenant_id_child_role_id_foreign FOREIGN KEY (tenant_id, child_role_id) REFERENCES public.roles(tenant_id, id) ON DELETE CASCADE;


--
-- Name: security_role_children security_role_children_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_role_children
    ADD CONSTRAINT security_role_children_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: security_role_children security_role_children_tenant_id_parent_role_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_role_children
    ADD CONSTRAINT security_role_children_tenant_id_parent_role_id_foreign FOREIGN KEY (tenant_id, parent_role_id) REFERENCES public.roles(tenant_id, id) ON DELETE CASCADE;


--
-- Name: security_role_duties security_role_duties_duty_code_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_role_duties
    ADD CONSTRAINT security_role_duties_duty_code_foreign FOREIGN KEY (duty_code) REFERENCES public.security_duties(code) ON DELETE RESTRICT;


--
-- Name: security_role_duties security_role_duties_role_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_role_duties
    ADD CONSTRAINT security_role_duties_role_id_foreign FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: site_enrollment_tokens site_enrollment_tokens_created_by_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_enrollment_tokens
    ADD CONSTRAINT site_enrollment_tokens_created_by_foreign FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: site_enrollment_tokens site_enrollment_tokens_site_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_enrollment_tokens
    ADD CONSTRAINT site_enrollment_tokens_site_id_foreign FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;


--
-- Name: site_operations site_operations_requested_by_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_operations
    ADD CONSTRAINT site_operations_requested_by_foreign FOREIGN KEY (requested_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: site_operations site_operations_site_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_operations
    ADD CONSTRAINT site_operations_site_id_foreign FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;


--
-- Name: site_reports site_reports_site_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_reports
    ADD CONSTRAINT site_reports_site_id_foreign FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;


--
-- Name: sites sites_created_by_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_created_by_foreign FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: sites sites_lingkungan_milik_tenant_yang_sama; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_lingkungan_milik_tenant_yang_sama FOREIGN KEY (environment_id, tenant_id) REFERENCES public.environments(id, tenant_id) ON DELETE RESTRICT;


--
-- Name: sites sites_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;


--
-- Name: sod_conflicts sod_conflicts_approved_by_membership_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sod_conflicts
    ADD CONSTRAINT sod_conflicts_approved_by_membership_id_foreign FOREIGN KEY (approved_by_membership_id) REFERENCES public.tenant_memberships(id) ON DELETE SET NULL;


--
-- Name: sod_conflicts sod_conflicts_membership_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sod_conflicts
    ADD CONSTRAINT sod_conflicts_membership_id_foreign FOREIGN KEY (membership_id) REFERENCES public.tenant_memberships(id) ON DELETE CASCADE;


--
-- Name: sod_conflicts sod_conflicts_sod_rule_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sod_conflicts
    ADD CONSTRAINT sod_conflicts_sod_rule_id_foreign FOREIGN KEY (sod_rule_id) REFERENCES public.sod_rules(id) ON DELETE CASCADE;


--
-- Name: sod_conflicts sod_conflicts_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sod_conflicts
    ADD CONSTRAINT sod_conflicts_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: sod_rules sod_rules_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sod_rules
    ADD CONSTRAINT sod_rules_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: sso_login_attempts sso_login_attempts_environment_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sso_login_attempts
    ADD CONSTRAINT sso_login_attempts_environment_id_foreign FOREIGN KEY (environment_id) REFERENCES public.environments(id) ON DELETE CASCADE;


--
-- Name: sso_login_attempts sso_login_attempts_link_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sso_login_attempts
    ADD CONSTRAINT sso_login_attempts_link_user_id_foreign FOREIGN KEY (link_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: sso_login_attempts sso_login_attempts_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sso_login_attempts
    ADD CONSTRAINT sso_login_attempts_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: sso_login_attempts sso_login_attempts_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sso_login_attempts
    ADD CONSTRAINT sso_login_attempts_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tenant_app_entitlements tenant_app_entitlements_app_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_app_entitlements
    ADD CONSTRAINT tenant_app_entitlements_app_id_foreign FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE RESTRICT;


--
-- Name: tenant_app_entitlements tenant_app_entitlements_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_app_entitlements
    ADD CONSTRAINT tenant_app_entitlements_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_creation_requests tenant_creation_requests_actor_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_creation_requests
    ADD CONSTRAINT tenant_creation_requests_actor_user_id_foreign FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: tenant_creation_requests tenant_creation_requests_membership_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_creation_requests
    ADD CONSTRAINT tenant_creation_requests_membership_id_foreign FOREIGN KEY (membership_id) REFERENCES public.tenant_memberships(id);


--
-- Name: tenant_creation_requests tenant_creation_requests_principal_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_creation_requests
    ADD CONSTRAINT tenant_creation_requests_principal_id_foreign FOREIGN KEY (principal_id) REFERENCES public.users(id);


--
-- Name: tenant_creation_requests tenant_creation_requests_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_creation_requests
    ADD CONSTRAINT tenant_creation_requests_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: tenant_deployments tenant_deployments_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_deployments
    ADD CONSTRAINT tenant_deployments_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_identity_providers tenant_identity_providers_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_identity_providers
    ADD CONSTRAINT tenant_identity_providers_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_memberships tenant_memberships_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_memberships
    ADD CONSTRAINT tenant_memberships_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_memberships tenant_memberships_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_memberships
    ADD CONSTRAINT tenant_memberships_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tenant_number_sequences tenant_number_sequences_profile_code_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_number_sequences
    ADD CONSTRAINT tenant_number_sequences_profile_code_foreign FOREIGN KEY (profile_code) REFERENCES public.number_sequence_profiles(code) ON DELETE RESTRICT;


--
-- Name: tenant_number_sequences tenant_number_sequences_reference_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_number_sequences
    ADD CONSTRAINT tenant_number_sequences_reference_id_foreign FOREIGN KEY (reference_id) REFERENCES public.app_number_sequence_references(id) ON DELETE CASCADE;


--
-- Name: tenant_number_sequences tenant_number_sequences_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_number_sequences
    ADD CONSTRAINT tenant_number_sequences_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenants tenants_client_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_client_id_foreign FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: time_zones time_zones_country_code_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_zones
    ADD CONSTRAINT time_zones_country_code_foreign FOREIGN KEY (country_code) REFERENCES public.country_regions(code) ON DELETE RESTRICT;


--
-- Name: units_of_measure units_of_measure_tenant_id_uom_class_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.units_of_measure
    ADD CONSTRAINT units_of_measure_tenant_id_uom_class_id_foreign FOREIGN KEY (tenant_id, uom_class_id) REFERENCES public.uom_classes(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: units_of_measure units_of_measure_tenant_id_uom_system_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.units_of_measure
    ADD CONSTRAINT units_of_measure_tenant_id_uom_system_id_foreign FOREIGN KEY (tenant_id, uom_system_id) REFERENCES public.uom_systems(tenant_id, id) ON DELETE SET NULL;


--
-- Name: uom_conversions uom_conversions_tenant_id_from_unit_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uom_conversions
    ADD CONSTRAINT uom_conversions_tenant_id_from_unit_id_foreign FOREIGN KEY (tenant_id, from_unit_id) REFERENCES public.units_of_measure(tenant_id, id) ON DELETE CASCADE;


--
-- Name: uom_conversions uom_conversions_tenant_id_to_unit_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uom_conversions
    ADD CONSTRAINT uom_conversions_tenant_id_to_unit_id_foreign FOREIGN KEY (tenant_id, to_unit_id) REFERENCES public.units_of_measure(tenant_id, id) ON DELETE CASCADE;


--
-- Name: uom_external_codes uom_external_codes_tenant_id_unit_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uom_external_codes
    ADD CONSTRAINT uom_external_codes_tenant_id_unit_id_foreign FOREIGN KEY (tenant_id, unit_id) REFERENCES public.units_of_measure(tenant_id, id) ON DELETE CASCADE;


--
-- Name: uom_translations uom_translations_tenant_id_unit_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uom_translations
    ADD CONSTRAINT uom_translations_tenant_id_unit_id_foreign FOREIGN KEY (tenant_id, unit_id) REFERENCES public.units_of_measure(tenant_id, id) ON DELETE CASCADE;


--
-- Name: vendors vendors_tenant_id_legal_entity_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_tenant_id_legal_entity_id_foreign FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE CASCADE;


--
-- Name: vendors vendors_tenant_id_party_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_tenant_id_party_id_foreign FOREIGN KEY (tenant_id, party_id) REFERENCES public.parties(tenant_id, id) ON DELETE CASCADE;


--
-- Name: workflow_configuration_versions workflow_configuration_versions_configuration_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_configuration_versions
    ADD CONSTRAINT workflow_configuration_versions_configuration_id_foreign FOREIGN KEY (configuration_id) REFERENCES public.workflow_configurations(id) ON DELETE CASCADE;


--
-- Name: workflow_configurations workflow_configurations_workflow_type_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_configurations
    ADD CONSTRAINT workflow_configurations_workflow_type_id_foreign FOREIGN KEY (workflow_type_id) REFERENCES public.workflow_types(id) ON DELETE RESTRICT;


--
-- Name: workflow_elements workflow_elements_version_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_elements
    ADD CONSTRAINT workflow_elements_version_id_foreign FOREIGN KEY (version_id) REFERENCES public.workflow_configuration_versions(id) ON DELETE CASCADE;


--
-- Name: workflow_history workflow_history_instance_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_history
    ADD CONSTRAINT workflow_history_instance_id_foreign FOREIGN KEY (instance_id) REFERENCES public.workflow_instances(id) ON DELETE CASCADE;


--
-- Name: workflow_instances workflow_instances_configuration_version_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_instances
    ADD CONSTRAINT workflow_instances_configuration_version_id_foreign FOREIGN KEY (configuration_version_id) REFERENCES public.workflow_configuration_versions(id) ON DELETE RESTRICT;


--
-- Name: workflow_instances workflow_instances_workflow_type_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_instances
    ADD CONSTRAINT workflow_instances_workflow_type_id_foreign FOREIGN KEY (workflow_type_id) REFERENCES public.workflow_types(id) ON DELETE RESTRICT;


--
-- Name: workflow_parameters workflow_parameters_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_parameters
    ADD CONSTRAINT workflow_parameters_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: workflow_transitions workflow_transitions_version_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_transitions
    ADD CONSTRAINT workflow_transitions_version_id_foreign FOREIGN KEY (version_id) REFERENCES public.workflow_configuration_versions(id) ON DELETE CASCADE;


--
-- Name: workflow_types workflow_types_app_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_types
    ADD CONSTRAINT workflow_types_app_id_foreign FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE RESTRICT;


--
-- Name: workflow_work_items workflow_work_items_instance_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_work_items
    ADD CONSTRAINT workflow_work_items_instance_id_foreign FOREIGN KEY (instance_id) REFERENCES public.workflow_instances(id) ON DELETE CASCADE;


--
-- Name: working_time_calendar_days working_time_calendar_days_working_time_calendar_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.working_time_calendar_days
    ADD CONSTRAINT working_time_calendar_days_working_time_calendar_id_foreign FOREIGN KEY (working_time_calendar_id) REFERENCES public.working_time_calendars(id) ON DELETE CASCADE;


--
-- Name: working_time_calendar_lines working_time_calendar_lines_working_time_calendar_day_id_foreig; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.working_time_calendar_lines
    ADD CONSTRAINT working_time_calendar_lines_working_time_calendar_day_id_foreig FOREIGN KEY (working_time_calendar_day_id) REFERENCES public.working_time_calendar_days(id) ON DELETE CASCADE;


--
-- Name: working_time_calendars working_time_calendars_base_calendar_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.working_time_calendars
    ADD CONSTRAINT working_time_calendars_base_calendar_id_foreign FOREIGN KEY (base_calendar_id) REFERENCES public.working_time_calendars(id) ON DELETE SET NULL;


--
-- Name: working_time_calendars working_time_calendars_legal_entity_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.working_time_calendars
    ADD CONSTRAINT working_time_calendars_legal_entity_id_foreign FOREIGN KEY (legal_entity_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: working_time_lines working_time_lines_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.working_time_lines
    ADD CONSTRAINT working_time_lines_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: working_time_lines working_time_lines_working_time_template_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.working_time_lines
    ADD CONSTRAINT working_time_lines_working_time_template_id_foreign FOREIGN KEY (working_time_template_id) REFERENCES public.working_time_templates(id) ON DELETE CASCADE;


--
-- Name: working_time_templates working_time_templates_legal_entity_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.working_time_templates
    ADD CONSTRAINT working_time_templates_legal_entity_id_foreign FOREIGN KEY (legal_entity_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: working_time_templates working_time_templates_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.working_time_templates
    ADD CONSTRAINT working_time_templates_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


