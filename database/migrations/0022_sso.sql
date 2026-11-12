-- Masuk lewat SSO (penyedia OIDC perusahaan), mengikuti alur tiga kaki CoreERP (docs/dev/32-sso.md di repo CoreERP).
--
-- external_identities sudah ada sejak baseline, dan sesudah 0002 dan 0003 bentuknya sudah cukup: id dan user_id uuid,
-- issuer + subject, deleted_at, serta dua indeks unik parsial (satu tautan hidup per issuer + subject, dan satu tautan
-- hidup per pengguna per issuer). Berkas ini tidak mengubahnya.

-- Pengguna yang lahir dari identitas SSO (operasi sync_identities) tidak punya kata sandi. Login kata sandi menolaknya
-- dengan pesan yang sama dengan kata sandi salah.
ALTER TABLE public.users ALTER COLUMN password DROP NOT NULL;

-- Back-channel logout dari penyedia mengakhiri semua sesi pengguna yang tertaut. Sesi di Valkey tidak bisa dicari per
-- pengguna, jadi waktu ini yang dibandingkan dengan waktu login yang tersimpan di sesi: sesi yang login sebelum waktu
-- ini dibaca sebagai belum login, di penyimpan sesi mana pun.
ALTER TABLE public.users ADD COLUMN sessions_revoked_at timestamp with time zone;

-- Upacara SSO yang sedang berjalan. Tabel ini dibaca dan ditulis di database runtime saja, karena alamat balik
-- penyedia hanya satu per penempatan (di domain dasar) dan dipakai bersama setiap lingkungan di host ini. Lingkungan
-- dikenali dari alamatnya (tenant_slug + environment_kind di environment_routes).
--
-- sso_login_attempts dari baseline CoreERP tidak dipakai: foreign key-nya menunjuk tenants, environments, dan users di
-- database yang sama, padahal di sini pengguna dan tenant tinggal di database lingkungan masing-masing.
--
-- Yang disimpan hanya hash: state, rahasia peramban, nonce, dan token serah. code_verifier disimpan terenkripsi dengan
-- APP_KEY. Baris yang sudah kedaluwarsa lebih dari sehari dibuang saat upacara baru dimulai, seperti baris sessions;
-- isinya bukan data bisnis.
CREATE TABLE public.sso_attempts (
    id uuid NOT NULL,
    mode character varying(10) NOT NULL,
    tenant_slug character varying(63) NOT NULL,
    environment_kind character varying(20) NOT NULL,
    tenant_id uuid NOT NULL,
    state_hash character(64) NOT NULL,
    browser_secret_hash character(64) NOT NULL,
    nonce_hash character(64) NOT NULL,
    code_verifier text NOT NULL,
    redirect_uri character varying(255) NOT NULL,
    return_path character varying(500),
    -- Pengguna yang menautkan akunnya (mode link), ditulis saat upacara dimulai.
    link_user_id uuid,
    -- Hasil kaki kedua: pengguna yang masuk (mode login) dan identitas dari ID token.
    user_id uuid,
    issuer character varying(255),
    subject character varying(255),
    subject_email character varying(255),
    handoff_token_hash character(64),
    expires_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sso_attempts_pkey PRIMARY KEY (id),
    CONSTRAINT sso_attempts_mode_dikenal CHECK (mode IN ('login', 'link')),
    CONSTRAINT sso_attempts_link_user_wajib CHECK (mode <> 'link' OR link_user_id IS NOT NULL)
);
CREATE UNIQUE INDEX sso_attempts_state_hash_unique ON public.sso_attempts USING btree (state_hash);
CREATE UNIQUE INDEX sso_attempts_handoff_token_hash_unique ON public.sso_attempts USING btree (handoff_token_hash)
    WHERE handoff_token_hash IS NOT NULL;
CREATE INDEX sso_attempts_expires_at_index ON public.sso_attempts USING btree (expires_at);

-- jti logout token yang sudah dipakai, supaya token yang sama tidak diterima dua kali. Disimpan sampai melewati batas
-- umur token, lalu dibuang saat logout token berikutnya datang.
CREATE TABLE public.sso_logout_tokens (
    issuer character varying(255) NOT NULL,
    jti character varying(255) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sso_logout_tokens_pkey PRIMARY KEY (issuer, jti)
);
