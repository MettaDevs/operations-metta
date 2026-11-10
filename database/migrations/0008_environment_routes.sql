-- Peta alamat ke lingkungan untuk runtime. Alamat `<tenant>.<base>` (produksi) dan `<tenant>.<kind>.<base>` (demo,
-- sandbox) menunjuk tepat satu baris di sini, dan baris itu menyebut database lingkungannya. database_name kosong
-- berarti database bersama runtime, tempat tabel ini sendiri berada.
--
-- Tabel ini dibaca dari database runtime saja. Ditulis penyiapan lingkungan, yang menerima isinya dari control plane;
-- runtime tidak pernah membaca registri lingkungan milik control plane.

CREATE TABLE public.environment_routes (
    tenant_slug character varying(63) NOT NULL,
    kind character varying(20) NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    database_name character varying(63),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT environment_routes_pkey PRIMARY KEY (tenant_slug, kind),
    CONSTRAINT environment_routes_kind_dikenal CHECK (kind IN ('production', 'sandbox', 'demo'))
);
