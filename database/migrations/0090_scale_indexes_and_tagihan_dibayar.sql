-- Scale indexes and tagihan_kasir.dibayar summary flag (kept in sync by trigger on kasir)

CREATE INDEX IF NOT EXISTS kasir_sumber_diposting_cover_idx
    ON public.kasir (tenant_id, sumber_dokumen_id, sumber_module)
    WHERE status = 'diposting';

ALTER TABLE public.tagihan_kasir
    ADD COLUMN IF NOT EXISTS dibayar boolean NOT NULL DEFAULT false;

UPDATE public.tagihan_kasir tk
SET dibayar = EXISTS (
    SELECT 1
    FROM public.kasir k
    WHERE k.tenant_id = tk.tenant_id
      AND k.sumber_dokumen_id = tk.sumber_dokumen_id
      AND k.sumber_module = tk.sumber_module
      AND k.status = 'diposting'
)
WHERE tk.dibayar IS DISTINCT FROM EXISTS (
    SELECT 1
    FROM public.kasir k
    WHERE k.tenant_id = tk.tenant_id
      AND k.sumber_dokumen_id = tk.sumber_dokumen_id
      AND k.sumber_module = tk.sumber_module
      AND k.status = 'diposting'
);

CREATE INDEX IF NOT EXISTS tagihan_kasir_counts_cover_idx
    ON public.tagihan_kasir (tenant_id, legal_entity_id, tanggal)
    INCLUDE (dibayar)
    WHERE status <> 'batal';

CREATE INDEX IF NOT EXISTS tagihan_kasir_paid_tanggal_id_idx
    ON public.tagihan_kasir (tenant_id, legal_entity_id, tanggal, id)
    WHERE status <> 'batal';

CREATE OR REPLACE FUNCTION public.sync_tagihan_kasir_dibayar()
RETURNS trigger AS $$
DECLARE
    v_tenant uuid := COALESCE(NEW.tenant_id, OLD.tenant_id);
    v_module varchar := COALESCE(NEW.sumber_module, OLD.sumber_module);
    v_doc uuid := COALESCE(NEW.sumber_dokumen_id, OLD.sumber_dokumen_id);
    v_paid boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM public.kasir k
        WHERE k.tenant_id = v_tenant
          AND k.sumber_dokumen_id = v_doc
          AND k.sumber_module = v_module
          AND k.status = 'diposting'
    ) INTO v_paid;

    UPDATE public.tagihan_kasir tk
    SET dibayar = v_paid
    WHERE tk.tenant_id = v_tenant
      AND tk.sumber_dokumen_id = v_doc
      AND tk.sumber_module = v_module
      AND tk.dibayar IS DISTINCT FROM v_paid;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS kasir_sync_tagihan_dibayar ON public.kasir;
CREATE TRIGGER kasir_sync_tagihan_dibayar
    AFTER INSERT OR UPDATE OF status, sumber_dokumen_id, sumber_module OR DELETE
    ON public.kasir
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_tagihan_kasir_dibayar();

CREATE INDEX IF NOT EXISTS gd_tr_kartu_gudang_terbuka_le_idx
    ON public.gd_tr_kartu_gudang (tenant_id, legal_entity_id, lokasi_id, barang_id)
    WHERE sisa <> 0;
