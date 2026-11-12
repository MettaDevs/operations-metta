// Aturan alamat CoreERP (EnvironmentAddress): produksi di `<tenant>.<base>`, demo dan sandbox di
// `<tenant>.<kind>.<base>`. Nama lingkungan tidak pernah menjadi bagian alamat, jadi satu tenant punya paling banyak
// satu lingkungan per jenis.
export const environmentKinds = ['production', 'sandbox', 'demo'] as const;
export type EnvironmentKind = (typeof environmentKinds)[number];

// Label yang dipakai layanan lain di domain yang sama, tidak pernah menjadi tenant.
export const reservedLabels = new Set(['admin', 'www', 'api', 'registry']);

export type Address =
    | { kind: 'unrouted' }
    // Domain dasar itu sendiri, tanpa nama tenant: hanya alamat balik dan back-channel logout SSO yang ada di sana.
    | { kind: 'base' }
    | { kind: 'unknown' }
    | { kind: 'environment'; tenantSlug: string; environment: EnvironmentKind };

// Host di luar domain dasar, atau domain dasar kosong, tidak dirutekan. Host di bawah domain dasar yang tidak cocok
// dengan aturan di atas tidak dikenal.
export function parseAddress(host: string, baseDomain: string): Address {
    if (!baseDomain) return { kind: 'unrouted' };
    const name = host.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
    if (name === baseDomain) return { kind: 'base' };
    const suffix = `.${baseDomain}`;
    if (!name.endsWith(suffix)) return { kind: 'unrouted' };
    const labels = name.slice(0, -suffix.length).split('.');
    const [tenantSlug, environment] = labels;
    if (!tenantSlug || reservedLabels.has(tenantSlug))
        return { kind: 'unknown' };
    if (labels.length === 1)
        return { kind: 'environment', tenantSlug, environment: 'production' };
    if (
        labels.length === 2 &&
        (environment === 'demo' || environment === 'sandbox')
    )
        return { kind: 'environment', tenantSlug, environment };
    return { kind: 'unknown' };
}

// Jawaban untuk alamat yang tidak menunjuk lingkungan tercatat. Penyebab paling sering di laptop adalah membuka
// `localhost:<port>` tanpa nama tenant di depannya.
export const UNKNOWN_ADDRESS_MESSAGE =
    'Alamat ini tidak terhubung ke ruang kerja mana pun. Buka alamat ruang kerja Anda, yang diawali nama klinik atau perusahaan Anda.';

export function environmentHost(
    tenantSlug: string,
    environment: EnvironmentKind,
    baseDomain: string,
): string {
    return environment === 'production'
        ? `${tenantSlug}.${baseDomain}`
        : `${tenantSlug}.${environment}.${baseDomain}`;
}
