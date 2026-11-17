-- Penanda tangan dokumen cetak per legal entity atau unit kerja (Sys Admin › Kop surat), padanan Officials di
-- Dynamics 365 Finance (Organization administration › Setup › Contacts › Officials, lokalisasi Eropa Timur dan Rusia)
-- dan Company Officials lokalisasi Ceko Business Central. Business Central W1 tidak punya padanannya: dokumen BC hanya
-- menyebut pengguna yang memposting dan Person Responsible pada perhitungan fisik.
--
-- Dokumen persediaan lama menulis mati pejabatnya di template ("Mengetahui, Kepala UPT ...", nama dan NIP). Di sini
-- jabatan, nama, dan nomor induk adalah data per organisasi, dan layout membacanya lewat tag {#signers}. Petugas yang
-- mengerjakan dokumen (pengirim, penerima, penghitung) tidak dicatat di sini; mereka dibaca dari pengguna yang
-- memposting dokumen itu.
--
-- kode_laporan kosong berarti penanda tangan dicetak di semua dokumen yang layout-nya memakai tag itu; terisi berarti
-- hanya di laporan itu, seperti tab per jenis dokumen pada Officials F&O.

CREATE TABLE public.penanda_tangan_cetak (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    kode_laporan character varying(160),
    jabatan character varying(150) NOT NULL,
    nama character varying(200) NOT NULL,
    nomor_induk character varying(60),
    urutan smallint NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT penanda_tangan_cetak_pkey PRIMARY KEY (id),
    CONSTRAINT penanda_tangan_cetak_organization_foreign
        FOREIGN KEY (tenant_id, organization_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX penanda_tangan_cetak_organization_index
    ON public.penanda_tangan_cetak USING btree (tenant_id, organization_id) WHERE (deleted_at IS NULL);

DO $$
BEGIN
    CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.penanda_tangan_cetak
        FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
    CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.penanda_tangan_cetak
        FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
    CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.penanda_tangan_cetak
        FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();
END;
$$;

-- Siapa mengganti pejabat yang tercetak di dokumen perlu bisa ditelusuri, jadi dicatat bawaan seperti pilihan layout.
INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'penanda_tangan_cetak', 'Penanda tangan dokumen cetak', 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = 'penanda_tangan_cetak');
