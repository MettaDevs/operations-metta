-- Kode section, supaya alamat halaman pemeriksaan dapat dibaca dan dikirim orang:
-- /healthcare/examination/queue/<NoReg>/<kode section>, urutan yang sama dengan poly/outpatient/form/{NoReg}/{SectionID}
-- sistem lama. Sistem lama memakai SectionID (misalnya SEC002) sebagai kunci section. Di sini kodenya pendek dan diketik
-- pengguna, seperti field Code di Business Central, karena orang memang membaca dan mengirimkannya ("Kode dan nomor
-- dokumen" di AGENTS.md).
--
-- Kode unik per tenant tanpa membedakan huruf besar-kecil selama section belum dihapus, karena alamatnya tidak membawa
-- unit. Section yang sudah ada mendapat kode nomor buktinya bila kode itu tidak dipakai section hidup lain di tenant
-- yang sama. Sisanya mendapat SEC001, SEC002, ... per tenant menurut urutan dibuat, dengan nomor yang sudah dipakai
-- dilewati. Section hidup diberi nomor lebih dulu daripada section yang sudah dihapus.

ALTER TABLE public.sim_m_section ADD COLUMN kode character varying(20);

UPDATE public.sim_m_section s
SET kode = btrim(s.kode_no_bukti)
WHERE s.deleted_at IS NULL
  AND nullif(btrim(s.kode_no_bukti), '') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.sim_m_section o
                  WHERE o.tenant_id = s.tenant_id AND o.id <> s.id AND o.deleted_at IS NULL
                    AND lower(btrim(o.kode_no_bukti)) = lower(btrim(s.kode_no_bukti)));

DO $$
DECLARE
    section record;
    tenant uuid := NULL;
    number integer := 0;
    candidate text;
BEGIN
    FOR section IN
        SELECT id, tenant_id FROM public.sim_m_section
        WHERE kode IS NULL
        ORDER BY tenant_id, deleted_at IS NOT NULL, created_at NULLS FIRST, id
    LOOP
        IF tenant IS DISTINCT FROM section.tenant_id THEN
            tenant := section.tenant_id;
            number := 0;
        END IF;
        LOOP
            number := number + 1;
            candidate := 'SEC' || lpad(number::text, greatest(3, length(number::text)), '0');
            EXIT WHEN NOT EXISTS (SELECT 1 FROM public.sim_m_section
                                  WHERE tenant_id = section.tenant_id AND deleted_at IS NULL
                                    AND lower(kode) = lower(candidate));
        END LOOP;
        UPDATE public.sim_m_section SET kode = candidate WHERE id = section.id;
    END LOOP;
END $$;

ALTER TABLE public.sim_m_section ALTER COLUMN kode SET NOT NULL;

CREATE UNIQUE INDEX sim_m_section_kode_unique
    ON public.sim_m_section USING btree (tenant_id, lower((kode)::text)) WHERE (deleted_at IS NULL);
