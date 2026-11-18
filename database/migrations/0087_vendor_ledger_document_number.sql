-- Entri utang vendor menyimpan nomor dokumen dari vendor untuk faktur maupun nota kredit, seperti External Document
-- No. di Vendor Ledger Entry BC. Nama lamanya menyebut faktur saja.

ALTER TABLE public.ap_tr_entri_utang RENAME COLUMN no_faktur_vendor TO no_dokumen_vendor;
