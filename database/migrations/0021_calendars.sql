-- Kalender kerja milik Core, dipakai semua module, pola kalender F&O
-- (https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/supply-chain-calendars-master-planning,
-- https://learn.microsoft.com/en-us/dynamics365/human-resources/hr-personnel-create-working-time-calendar).
-- Keputusan pemilik produk, 11 November 2026: "sebagai kalender di core, dipakai di semuanya". Untuk sekarang kalender
-- hanya dipasang pada jadwal praktik dokter, oleh module pemiliknya; Core tidak menambah kolom kalender ke legal entity,
-- gudang, vendor, atau customer.
--
-- Tabelnya sudah ada di baseline CoreERP (Foundation\WorkingCalendar): template jam kerja (`working_time_templates`
-- dengan `working_time_lines` per hari, 0 = Senin ... 6 = Minggu), kalender (`working_time_calendars`), hari bertanggal
-- (`working_time_calendar_days`) dan jam kerjanya (`working_time_calendar_lines`). Migration ini memakainya dan mengubah
-- yang perlu:
--
-- 1. Kalender dan template milik tenant, bukan legal entity, jadi kodenya unik per tenant. `legal_entity_id` dibiarkan
--    kosong. Kode disimpan huruf besar seperti di CoreERP.
-- 2. Penghapusan lunak untuk baris jam kerja dan hari bertanggal, yang di CoreERP dihapus fisik saat disusun ulang.
--    Kunci unik hari menjadi parsial.
-- 3. Hari bertanggal boleh `base`: mengikuti kalender dasar pada tanggal itu, sehingga libur yang dipelihara sekali di
--    kalender dasar ikut menutup kalender lain. `note` memberi nama hari itu, misalnya "Idul Fitri". `composed`
--    menandai hari yang ditulis "Susun jam kerja"; hari yang diubah orang tidak ditimpa penyusunan berikutnya.
-- 4. `ends_next_day` untuk rentang jam yang selesai lewat tengah malam, misalnya 22:00 sampai 06:00.
-- 5. Perubahan tercatat di change log, dan hak layar Kalender memakai rantai keamanan Core: permission, privilege, duty.
--    Role pemilik tenant yang sudah ada mendapat duty kelola, sama dengan role pemilik yang lahir sesudah migration ini.
--
-- Tabel-tabel ini belum pernah ditulis kode di repo ini, jadi indeks yang diperketat tidak menolak baris lama.

-- 1. Kode unik per tenant --------------------------------------------------------------------------------------------

DROP INDEX public.working_time_calendars_code_unique;
CREATE UNIQUE INDEX working_time_calendars_code_unique
    ON public.working_time_calendars USING btree (tenant_id, code) WHERE (deleted_at IS NULL);
CREATE UNIQUE INDEX working_time_templates_code_unique
    ON public.working_time_templates USING btree (tenant_id, code) WHERE (deleted_at IS NULL);

-- 2. Penghapusan lunak ------------------------------------------------------------------------------------------------

ALTER TABLE public.working_time_lines ADD COLUMN deleted_at timestamp(0) without time zone;
ALTER TABLE public.working_time_calendar_days ADD COLUMN deleted_at timestamp(0) without time zone;
ALTER TABLE public.working_time_calendar_lines ADD COLUMN deleted_at timestamp(0) without time zone;

ALTER TABLE public.working_time_calendar_days
    DROP CONSTRAINT working_time_calendar_days_working_time_calendar_id_date_unique;
DROP INDEX public.working_time_calendar_days_tenant_id_working_time_calendar_id_d;
CREATE UNIQUE INDEX working_time_calendar_days_unique
    ON public.working_time_calendar_days USING btree (tenant_id, working_time_calendar_id, date)
    WHERE (deleted_at IS NULL);

-- 3. Hari yang mengikuti kalender dasar ------------------------------------------------------------------------------

ALTER TABLE public.working_time_calendar_days
    ADD COLUMN note character varying(255),
    ADD COLUMN composed boolean DEFAULT false NOT NULL,
    ADD CONSTRAINT working_time_calendar_days_control_check CHECK (control IN ('open', 'closed', 'base'));
ALTER TABLE public.working_time_calendars
    ADD CONSTRAINT working_time_calendars_base_not_self CHECK (base_calendar_id <> id);

-- 4. Rentang lewat tengah malam --------------------------------------------------------------------------------------

ALTER TABLE public.working_time_lines ADD COLUMN ends_next_day boolean DEFAULT false NOT NULL;
ALTER TABLE public.working_time_calendar_lines ADD COLUMN ends_next_day boolean DEFAULT false NOT NULL;

-- 5. Change log dan hak layar ----------------------------------------------------------------------------------------

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, t.table_name, t.caption, 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('working_time_templates', 'Template jam kerja'),
             ('working_time_lines', 'Jam kerja template'),
             ('working_time_calendars', 'Kalender'),
             ('working_time_calendar_days', 'Hari kalender'),
             ('working_time_calendar_lines', 'Jam kerja hari kalender')) AS t(table_name, caption)
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = t.table_name);

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('core.calendar.form', 'core', 'Layar kalender dan template jam kerja', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
VALUES ('core.calendar.read', 'core', 'core.calendar.form', 'read', 'Lihat kalender dan template jam kerja',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.calendar.update', 'core', 'core.calendar.form', 'update', 'Ubah kalender dan template jam kerja',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
VALUES ('core.calendar.view', 'core', 'Melihat kalender dan template jam kerja',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.calendar.maintain', 'core', 'Memelihara kalender dan template jam kerja',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('core.calendar.view', 'core.calendar.read'),
       ('core.calendar.maintain', 'core.calendar.read'),
       ('core.calendar.maintain', 'core.calendar.update')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
VALUES ('core.calendar.inquire', 'core', 'Lihat kalender dan template jam kerja',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.calendar.manage', 'core', 'Kelola kalender dan template jam kerja',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('core.calendar.inquire', 'core.calendar.view'),
       ('core.calendar.manage', 'core.calendar.maintain')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT id, 'core.calendar.manage' FROM public.roles WHERE is_owner AND deleted_at IS NULL
ON CONFLICT DO NOTHING;
