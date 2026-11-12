-- E-Resep menampilkan obat yang sudah diserahkan farmasi. Module farmasi menerbitkan pharmacy.prescription.dispensed.v1
-- saat obat diserahkan; module ini mencatat waktu, nomor penyerahan, dan jumlah yang diserahkan per baris resep di
-- tabelnya sendiri, karena ia tidak membaca tabel module farmasi.
--
-- 1. Event yang sudah diproses, supaya event yang diantar dua kali dicatat sekali.
-- 2. Kolom penyerahan pada resep dan barisnya. Kosong berarti belum diserahkan, atau farmasi tidak terpasang.

CREATE TABLE public.sim_processed_events (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    event_id uuid NOT NULL,
    processed_at timestamp(0) without time zone NOT NULL,
    CONSTRAINT sim_processed_events_pkey PRIMARY KEY (id),
    CONSTRAINT sim_processed_events_tenant_id_event_id_unique UNIQUE (tenant_id, event_id)
);

ALTER TABLE public.sim_tr_resep ADD COLUMN diserahkan_pada timestamp(0) without time zone;
ALTER TABLE public.sim_tr_resep ADD COLUMN nomor_penyerahan character varying(50);
ALTER TABLE public.sim_tr_resep_detail ADD COLUMN jumlah_diserahkan numeric(18,4);
