import type { z } from 'zod';
import {
    base,
    mutationInput,
    ok,
    typedBody,
    type Context,
} from '../http/index.ts';
import { Profile, type passwordConfirmationSchema } from './profile.service.ts';

const profile = (context: Context) =>
    new Profile(context.db, context.session, context.sso);

// Profil pengguna yang sedang masuk, dan tautan akun SSO-nya. GET /api/v1/sso dibaca halaman masuk sebelum login untuk
// memutuskan tombol "Masuk dengan SSO" tampil atau tidak.
export function profileRoutes() {
    const route = (
        method: 'GET' | 'POST' | 'DELETE',
        path: `/api/v1/${string}`,
    ) =>
        base.route({
            method,
            path,
            inputStructure: 'detailed',
            outputStructure: 'detailed',
        });
    return {
        ssoOptions: route('GET', '/api/v1/sso').handler(({ context }) =>
            ok({
                enabled: context.sso !== null && !!context.session.environment,
            }),
        ),
        profile: route('GET', '/api/v1/profile').handler(async ({ context }) =>
            ok(await profile(context).show()),
        ),
        profileSsoLink: route('POST', '/api/v1/profile/sso-link')
            .input(typedBody<z.input<typeof passwordConfirmationSchema>>())
            .handler(({ context, input }) =>
                profile(context).beginLink(context.request, input.body),
            ),
        profileSsoUnlink: route('DELETE', '/api/v1/profile/sso-identities/{id}')
            .input(mutationInput)
            .handler(async ({ context, input }) => {
                await profile(context).unlink(input.params.id, input.body);
                return { status: 204, headers: {}, body: undefined };
            }),
    };
}
