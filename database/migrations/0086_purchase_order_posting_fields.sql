-- Isian posting di purchase order disimpan seperti Purchase Line dan Purchase Header BC: Qty. to Receive,
-- Qty. to Invoice, satu lot per baris, Posting Date, dan Vendor Invoice No. Kosong berarti bawaan (InitQtyToReceive,
-- InitQtyToInvoice, hari ini); posting dan setiap perubahan jumlah diterima mengosongkannya lagi.

ALTER TABLE public.bl_tr_order_detail
    ADD COLUMN jumlah_terima_sekarang numeric(18,4),
    ADD COLUMN jumlah_faktur_sekarang numeric(18,4),
    ADD COLUMN no_batch character varying(50),
    ADD COLUMN tanggal_kedaluwarsa date,
    ADD CONSTRAINT bl_tr_order_detail_jumlah_terima_sekarang_check CHECK (jumlah_terima_sekarang >= 0),
    ADD CONSTRAINT bl_tr_order_detail_jumlah_faktur_sekarang_check CHECK (jumlah_faktur_sekarang >= 0);

ALTER TABLE public.bl_tr_order
    ADD COLUMN tanggal_posting date,
    ADD COLUMN no_faktur_vendor character varying(35);
