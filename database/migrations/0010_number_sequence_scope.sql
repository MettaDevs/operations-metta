-- Setiap number sequence diikat ke satu nilai scope, mengikuti Dynamics 365 F&O (keputusan pemilik produk,
-- 10 November 2026). Satu reference boleh punya banyak sequence dalam satu tenant: satu untuk seluruh tenant
-- (Shared), satu per legal entity, satu per operating unit, atau satu per legal entity dan periode fiskal. Format,
-- awalan, rentang, dan nomor berikutnya milik masing-masing sequence, jadi NRM puskesmas A dan B boleh berformat
-- A-000001 dan B-000001.
--
-- 1. Unique (tenant_id, reference_id) dicabut. Gantinya: satu sequence aktif per reference per nilai scope.
-- 2. Nilai scope disimpan di kolom bertipe sesuai jenisnya, dengan foreign key ke legal_entities, operating_units,
--    dan fiscal_periods, dan CHECK memastikan kolom yang terisi cocok dengan scope_type. Scope dan nilainya tetap
--    sejak sequence dibuat; trigger menolak perubahannya. Mengubah kebijakan berarti membuat sequence baru.
-- 3. Sequence lama berscope legal entity atau operating unit dulu melayani semua organisasi lewat workspace pemakai.
--    Ia dipecah: satu sequence per organisasi aktif berklasifikasi sama di tenant itu, ditambah organisasi yang
--    sudah memakainya walau kini tidak aktif. Baris aslinya menjadi sequence organisasi yang sudah memakainya lebih
--    dulu. Penghitung, terbitan, pesanan, alokasi, nomor kembali, dan pool milik organisasi lain pindah ke salinannya
--    berdasarkan organisasi di scope_key. String scope_key sendiri tidak diubah, jadi tidak ada penghitung yang
--    terlepas dari nomor yang sudah terbit. Riwayat audit tetap di sequence asal.
--    Sequence non-tenant di tenant yang belum punya organisasi berklasifikasi itu tidak punya nilai yang bisa
--    dipilih. Ia menjadi scope tenant berstatus stopped, sehingga tidak menerbitkan apa pun sampai admin membuat
--    sequence yang benar.
-- 4. Allow user changes F&O ("To a lower number" dan "To a higher number") menjadi allow_lower_number dan
--    allow_higher_number.
-- 5. Pesanan nomor berstatus reserved wajib punya tenggat (expires_at), sama dengan pola lease_until di repo ini:
--    kunci tanpa tenggat membuat macet. Pesanan lama tanpa tenggat diberi 15 menit sejak dibuat.
-- 6. profile_code boleh kosong. Profil adalah preset CoreERP yang tidak dipindah; F&O tidak memilikinya.

ALTER TABLE public.tenant_number_sequences
    DROP CONSTRAINT tenant_number_sequences_tenant_id_reference_id_unique,
    ALTER COLUMN profile_code DROP NOT NULL,
    ADD COLUMN legal_entity_id uuid,
    ADD COLUMN operating_unit_id uuid,
    ADD COLUMN fiscal_period_id uuid,
    ADD COLUMN allow_lower_number boolean DEFAULT false NOT NULL,
    ADD COLUMN allow_higher_number boolean DEFAULT false NOT NULL,
    ADD CONSTRAINT tenant_number_sequences_legal_entity_id_foreign
        FOREIGN KEY (legal_entity_id) REFERENCES public.legal_entities(organization_id) ON DELETE RESTRICT,
    ADD CONSTRAINT tenant_number_sequences_operating_unit_id_foreign
        FOREIGN KEY (operating_unit_id) REFERENCES public.operating_units(organization_id) ON DELETE RESTRICT,
    ADD CONSTRAINT tenant_number_sequences_fiscal_period_id_foreign
        FOREIGN KEY (fiscal_period_id) REFERENCES public.fiscal_periods(id) ON DELETE RESTRICT;

CREATE TEMPORARY TABLE number_sequence_used_organizations ON COMMIT DROP AS
SELECT DISTINCT s.id AS sequence_id, k.organization_id
FROM (
    SELECT sequence_id, scope_key FROM public.number_sequence_counters
    UNION ALL SELECT sequence_id, scope_key FROM public.number_sequence_issues
    UNION ALL SELECT sequence_id, scope_key FROM public.number_sequence_reservations
    UNION ALL SELECT sequence_id, scope_key FROM public.number_sequence_allocations
    UNION ALL SELECT sequence_id, scope_key FROM public.number_sequence_reusable_numbers
    UNION ALL SELECT sequence_id, scope_key FROM public.number_sequence_continuous_pool
) used
CROSS JOIN LATERAL (
    SELECT split_part(split_part(used.scope_key, '|', 1), ':', 1) AS scope_type,
           split_part(split_part(used.scope_key, '|', 1), ':', 2) AS organization_id
) k
JOIN public.tenant_number_sequences s ON s.id = used.sequence_id AND s.scope_type = k.scope_type
WHERE s.scope_type IN ('legal_entity', 'operating_unit');

CREATE TEMPORARY TABLE number_sequence_targets ON COMMIT DROP AS
SELECT ranked.*,
       CASE WHEN ranked.position = 1 THEN ranked.sequence_id ELSE gen_random_uuid() END AS target_id
FROM (
    SELECT s.id AS sequence_id, s.scope_type, o.id AS organization_id,
           row_number() OVER (
               PARTITION BY s.id
               ORDER BY (u.organization_id IS NULL), o.created_at NULLS LAST, o.id
           ) AS position
    FROM public.tenant_number_sequences s
    JOIN public.organizations o ON o.tenant_id = s.tenant_id AND o.classification = s.scope_type
    LEFT JOIN number_sequence_used_organizations u
        ON u.sequence_id = s.id AND u.organization_id = o.id::text
    WHERE s.scope_type IN ('legal_entity', 'operating_unit')
      AND (o.status = 'active' OR u.organization_id IS NOT NULL)
      AND CASE s.scope_type
              WHEN 'legal_entity'
                  THEN EXISTS (SELECT 1 FROM public.legal_entities l WHERE l.organization_id = o.id)
              ELSE EXISTS (SELECT 1 FROM public.operating_units ou WHERE ou.organization_id = o.id)
          END
) ranked;

INSERT INTO public.tenant_number_sequences (
    id, tenant_id, reference_id, profile_code, scope_type, status, is_continuous, allow_manual,
    preallocation_enabled, preallocation_quantity, minimum_number, maximum_number, segments, created_at, updated_at,
    reset_period, created_by_user_id, updated_by_user_id, version, allow_automatic, legal_entity_id, operating_unit_id
)
SELECT t.target_id, s.tenant_id, s.reference_id, s.profile_code, s.scope_type, s.status, s.is_continuous,
       s.allow_manual, s.preallocation_enabled, s.preallocation_quantity, s.minimum_number, s.maximum_number,
       s.segments, s.created_at, now() AT TIME ZONE 'utc', s.reset_period, s.created_by_user_id,
       s.updated_by_user_id, 1, s.allow_automatic,
       CASE WHEN s.scope_type = 'legal_entity' THEN t.organization_id END,
       CASE WHEN s.scope_type = 'operating_unit' THEN t.organization_id END
FROM number_sequence_targets t
JOIN public.tenant_number_sequences s ON s.id = t.sequence_id
WHERE t.position > 1;

UPDATE public.tenant_number_sequences s
SET legal_entity_id = CASE WHEN t.scope_type = 'legal_entity' THEN t.organization_id END,
    operating_unit_id = CASE WHEN t.scope_type = 'operating_unit' THEN t.organization_id END
FROM number_sequence_targets t
WHERE t.sequence_id = s.id AND t.position = 1;

UPDATE public.tenant_number_sequences
SET scope_type = 'tenant', status = 'stopped'
WHERE scope_type IN ('legal_entity', 'operating_unit') AND legal_entity_id IS NULL AND operating_unit_id IS NULL;

UPDATE public.number_sequence_counters x SET sequence_id = t.target_id
FROM number_sequence_targets t
WHERE x.sequence_id = t.sequence_id AND t.position > 1
  AND split_part(split_part(x.scope_key, '|', 1), ':', 2) = t.organization_id::text;
UPDATE public.number_sequence_issues x SET sequence_id = t.target_id
FROM number_sequence_targets t
WHERE x.sequence_id = t.sequence_id AND t.position > 1
  AND split_part(split_part(x.scope_key, '|', 1), ':', 2) = t.organization_id::text;
UPDATE public.number_sequence_reservations x SET sequence_id = t.target_id
FROM number_sequence_targets t
WHERE x.sequence_id = t.sequence_id AND t.position > 1
  AND split_part(split_part(x.scope_key, '|', 1), ':', 2) = t.organization_id::text;
UPDATE public.number_sequence_allocations x SET sequence_id = t.target_id
FROM number_sequence_targets t
WHERE x.sequence_id = t.sequence_id AND t.position > 1
  AND split_part(split_part(x.scope_key, '|', 1), ':', 2) = t.organization_id::text;
UPDATE public.number_sequence_reusable_numbers x SET sequence_id = t.target_id
FROM number_sequence_targets t
WHERE x.sequence_id = t.sequence_id AND t.position > 1
  AND split_part(split_part(x.scope_key, '|', 1), ':', 2) = t.organization_id::text;
UPDATE public.number_sequence_continuous_pool x SET sequence_id = t.target_id
FROM number_sequence_targets t
WHERE x.sequence_id = t.sequence_id AND t.position > 1
  AND split_part(split_part(x.scope_key, '|', 1), ':', 2) = t.organization_id::text;

ALTER TABLE public.tenant_number_sequences
    ADD CONSTRAINT tenant_number_sequences_nilai_scope CHECK (
        (scope_type = 'tenant'
            AND legal_entity_id IS NULL AND operating_unit_id IS NULL AND fiscal_period_id IS NULL)
        OR (scope_type = 'legal_entity'
            AND legal_entity_id IS NOT NULL AND operating_unit_id IS NULL AND fiscal_period_id IS NULL)
        OR (scope_type = 'operating_unit'
            AND operating_unit_id IS NOT NULL AND legal_entity_id IS NULL AND fiscal_period_id IS NULL)
        OR (scope_type = 'legal_entity_fiscal_period'
            AND legal_entity_id IS NOT NULL AND fiscal_period_id IS NOT NULL AND operating_unit_id IS NULL)
    ),
    ADD CONSTRAINT tenant_number_sequences_izin_ubah_nomor CHECK (
        NOT (is_continuous AND (allow_lower_number OR allow_higher_number))
    );

CREATE UNIQUE INDEX tenant_number_sequences_aktif_per_scope
    ON public.tenant_number_sequences USING btree
        (tenant_id, reference_id, scope_type, legal_entity_id, operating_unit_id, fiscal_period_id)
    NULLS NOT DISTINCT
    WHERE ((status)::text = 'active'::text);

CREATE INDEX tenant_number_sequences_tenant_id_reference_id_index
    ON public.tenant_number_sequences USING btree (tenant_id, reference_id);

CREATE FUNCTION public.number_sequence_scope_is_fixed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.reference_id IS DISTINCT FROM OLD.reference_id
        OR NEW.scope_type IS DISTINCT FROM OLD.scope_type
        OR NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id
        OR NEW.operating_unit_id IS DISTINCT FROM OLD.operating_unit_id
        OR NEW.fiscal_period_id IS DISTINCT FROM OLD.fiscal_period_id THEN
        RAISE EXCEPTION 'Reference dan scope number sequence % tidak dapat diubah setelah dibuat.', OLD.id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER scope_is_fixed BEFORE UPDATE ON public.tenant_number_sequences
    FOR EACH ROW EXECUTE FUNCTION public.number_sequence_scope_is_fixed();

UPDATE public.number_sequence_reservations
SET expires_at = coalesce(created_at, now() AT TIME ZONE 'utc') + interval '15 minutes'
WHERE status = 'reserved' AND expires_at IS NULL;

ALTER TABLE public.number_sequence_reservations
    ADD CONSTRAINT number_sequence_reservations_dipesan_bertenggat CHECK (
        ((status)::text <> 'reserved'::text) OR (expires_at IS NOT NULL)
    );
