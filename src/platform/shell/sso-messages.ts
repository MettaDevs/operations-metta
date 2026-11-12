// Kalimat untuk kode kegagalan SSO di alamat (`?sso_error=`). Hanya kode yang dikenal yang diterjemahkan; teks dari
// alamat tidak pernah dicetak ke layar.
const messages: Record<string, string> = {
    unlinked:
        'Akun SSO ini belum tertaut ke akun mana pun di ruang kerja ini. Masuk dengan email dan kata sandi, lalu tautkan akun SSO dari halaman Profil.',
    'no-access':
        'Akun SSO ini sudah tertaut, tetapi belum diberi akses ke ruang kerja ini. Hubungi pengelola ruang kerja Anda.',
    expired:
        'Proses masuk dengan SSO sudah kedaluwarsa atau dibuka di peramban lain. Silakan ulangi.',
    unavailable:
        'Layanan SSO sedang tidak bisa dihubungi. Coba lagi nanti, atau masuk dengan kata sandi.',
    cancelled: 'Masuk dengan SSO dibatalkan.',
    'already-linked':
        'Akun SSO ini sudah tertaut ke akun lain, atau akun Anda sudah tertaut ke akun SSO lain.',
};

export function ssoErrorMessage(
    code: string | undefined,
    fallback: string,
): string | null {
    if (!code) return null;
    return Object.hasOwn(messages, code)
        ? (messages[code] ?? fallback)
        : fallback;
}
