-- Tanggal permintaan di permintaan pembelian (Order Date baris Requisition Worksheet BC): hari permintaan diajukan,
-- terpisah dari tanggal dibutuhkan (Due Date). LPLPO menghitung kolom permintaan sebulan dari tanggal ini.
-- Baris lama mendapat tanggal created_at di zona waktu legal entity-nya, sama dengan yang dihitung LPLPO sebelumnya.

ALTER TABLE public.bl_tr_permintaan ADD COLUMN tanggal_permintaan date;

UPDATE public.bl_tr_permintaan r
SET tanggal_permintaan = (coalesce(r.created_at, now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AT TIME ZONE coalesce(
    (SELECT e.timezone FROM public.legal_entities e
     WHERE e.tenant_id = r.tenant_id AND e.organization_id = r.legal_entity_id), 'UTC'))::date;

ALTER TABLE public.bl_tr_permintaan ALTER COLUMN tanggal_permintaan SET NOT NULL;
