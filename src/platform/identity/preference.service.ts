import { z } from 'zod';
import type { Database } from '../database/index.ts';
import { abort, validation } from '../http/index.ts';
import {
    preferenceKeySchema,
    preferencesSchema,
    preferenceValueSchema,
    type Preferences,
} from './preference.schema.ts';
import type { Session } from './session.ts';

export async function updatePreference(
    db: Database,
    session: Session,
    key: string,
    input: unknown,
): Promise<Preferences> {
    session.csrf(input);
    const user = session.requireUser();
    const preference = preferenceKeySchema.safeParse(key);
    if (!preference.success) abort(404, 'Setelan ini tidak dikenal.');
    const body = z
        .object({ value: preferenceValueSchema(preference.data) })
        .safeParse(input);
    if (!body.success)
        validation({ value: 'Pilih salah satu pilihan yang tersedia.' });
    const row = await db.one(
        z.object({ preferences: preferencesSchema }),
        `update users set preferences = preferences || jsonb_build_object($2::text, $3::text)
         where id = $1 returning preferences`,
        [user.id, preference.data, body.data.value],
    );
    if (!row) abort(404, 'Akun ini tidak ditemukan.');
    return row.preferences;
}
