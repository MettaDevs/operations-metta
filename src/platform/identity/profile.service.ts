import { z } from 'zod';
import { isoSql, type Database } from '../database/index.ts';
import { abort, lookupId, validation } from '../http/index.ts';
import { SsoFailure } from './oidc.ts';
import type { Session } from './session.ts';
import type { Sso } from './sso.service.ts';

export const passwordConfirmationSchema = z.object({
    password: z.string({ error: 'Isi kata sandi.' }).min(1, 'Isi kata sandi.'),
});

const identitySchema = z.object({
    id: z.string(),
    issuer: z.string(),
    email_at_link: z.string().nullable(),
    created_at: z.string().nullable(),
});

// Profil pengguna yang sedang masuk: data akun dan tautan SSO-nya. SSO hanya ditawarkan di alamat lingkungan, karena
// alamat balik penyedia membawa peramban kembali ke sana.
export class Profile {
    constructor(
        private readonly db: Database,
        private readonly session: Session,
        private readonly sso: Sso | null,
    ) {}

    private get ssoAvailable(): Sso | null {
        return this.session.environment ? this.sso : null;
    }

    async show() {
        const user = this.session.requireUser();
        const identities = await this.db.rows(
            identitySchema,
            `select id,issuer,email_at_link,${isoSql('created_at')} as created_at from external_identities
             where user_id=$1 and deleted_at is null order by created_at`,
            [user.id],
        );
        return {
            name: user.name,
            email: user.email,
            has_password: user.password !== null,
            sso_enabled: this.ssoAvailable !== null,
            identities,
        };
    }

    // Menautkan akun SSO dimulai dengan kata sandi yang diketik ulang. Tanpa itu, peramban yang ditinggalkan terbuka
    // cukup untuk memasang identitas orang lain pada akun ini.
    async beginLink(request: Request, input: unknown) {
        this.session.csrf(input);
        const user = this.session.requireUser();
        const sso = this.ssoAvailable;
        const route = this.session.environment;
        if (!sso || !route) abort(404, 'Not Found');
        const parsed = passwordConfirmationSchema.safeParse(input);
        if (!parsed.success)
            validation({
                password: parsed.error.issues[0]?.message ?? 'Isi kata sandi.',
            });
        if (!(await this.session.confirmPassword(parsed.data.password)))
            validation({ password: 'Kata sandi salah.' });
        const existing = await this.db.one(
            z.object({ id: z.string() }),
            'select id from external_identities where user_id=$1 and issuer=$2 and deleted_at is null limit 1',
            [user.id, sso.provider.settings.issuer],
        );
        if (existing)
            abort(
                409,
                'Akun ini sudah tertaut ke akun SSO. Lepas tautannya dulu bila ingin menggantinya.',
            );
        try {
            const { location, cookie } = await sso.begin({
                mode: 'link',
                route,
                request,
                linkUserId: user.id,
                returnPath: '/profile',
            });
            return {
                status: 200 as const,
                headers: { 'set-cookie': cookie },
                body: { authorization_url: location },
            };
        } catch (error) {
            if (error instanceof SsoFailure)
                abort(
                    503,
                    'Layanan SSO sedang tidak bisa dihubungi. Coba lagi nanti.',
                );
            throw error;
        }
    }

    // Tautan dilepas hanya bila akun masih punya kata sandi, supaya pemiliknya tetap bisa masuk.
    async unlink(id: string, input: unknown): Promise<void> {
        this.session.csrf(input);
        const user = this.session.requireUser();
        if (user.password === null)
            abort(
                409,
                'Akun ini belum punya kata sandi, jadi tautan SSO-nya tidak bisa dilepas.',
            );
        const removed = await this.db.execute(
            'update external_identities set deleted_at=now(),updated_at=now() where id=$1 and user_id=$2 and deleted_at is null',
            [lookupId(id), user.id],
        );
        if (!removed) abort(404, 'Tautan SSO ini tidak ditemukan.');
    }
}
