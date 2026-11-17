import type { Database } from '../database/index.ts';
import { readPermission, type RecordPageKey } from '../error-action/index.ts';
import { validation } from '../http/index.ts';
import type { Workspace } from './workspace.ts';

// Yang dibutuhkan penolakan dari pengguna yang ditolak: tenant-nya dan izin yang ia pegang.
export type Viewer = Pick<Workspace, 'tenantId' | 'holds'>;

// Penolakan yang jalan keluarnya ada di record lain. Pengguna yang boleh membuka record itu mendapat tombol `open.label`
// yang membukanya di atas layar sekarang. Yang tidak boleh mendapat `otherwise` di belakang pesannya, yang wajib
// menyebut nomor dokumennya, supaya ia tahu apa yang diminta ke siapa. Izin diperiksa lintas app lewat `holds`, karena
// pemanggilnya sering module lain: apoteker yang meretur obat membuka pembayaran kasir milik Core. Penolakan selalu
// pesan form (`_form`), tidak pernah menempel ke field: tidak ada isian yang salah, jadi ringkasan tidak boleh
// memintanya diperbaiki.
export async function refuse(
    db: Database,
    viewer: Viewer,
    refusal: {
        message: string;
        open: { page: RecordPageKey; recordId: string; label: string };
        otherwise: string;
    },
): Promise<never> {
    const { page, recordId, label } = refusal.open;
    const allowed = (await viewer.holds(db, [readPermission(page)])).has(
        readPermission(page),
    );
    validation(
        {
            _form: allowed
                ? refusal.message
                : `${refusal.message} ${refusal.otherwise}`,
        },
        allowed ? [{ kind: 'open', label, page, recordId }] : [],
    );
}
