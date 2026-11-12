import { z } from 'zod';
import type { Database } from '@core/platform/database/index.ts';

// Katalog panel tab Rekam Medis, dalam urutan sistem lama (rekammedis/index.php). Katalog ini kode, karena setiap panel
// adalah layar dan kode simpan sendiri; panel yang dipakai sebuah section adalah data, diatur di kartu section
// (sim_m_section_panel_pemeriksaan). `inputs` adalah kunci isi rekam medis milik panel itu, dan `byDefault` menentukan
// panel tampil bila section belum mengaturnya: semua kecuali Pemeriksaan dasar gigi, perilaku sistem lama untuk
// section bukan gigi.
export const examinationPanels = [
    { code: 'anamnesis', label: 'Anamnesa', inputs: ['anamnesis'] },
    {
        code: 'history',
        label: 'Riwayat penyakit dan alergi',
        inputs: ['history', 'allergy'],
    },
    {
        code: 'status',
        label: 'Status fisik / neurologis / mental, biologis, psikososiospiritual dan ekonomi',
        inputs: ['status'],
    },
    { code: 'physical', label: 'Periksa fisik', inputs: ['physical'] },
    { code: 'pain', label: 'Asesmen nyeri', inputs: ['pain'] },
    {
        code: 'fall_risk',
        label: 'Asesmen resiko jatuh (Get Up and Go)',
        inputs: ['fall_risk'],
    },
    {
        code: 'dental',
        label: 'Pemeriksaan dasar gigi',
        inputs: ['dental'],
        byDefault: false,
    },
    { code: 'findings', label: 'Keadaan fisik', inputs: ['findings'] },
    { code: 'anatomy', label: 'Anatomi tubuh', inputs: ['anatomy'] },
    { code: 'other', label: 'Lainnya', inputs: ['other'] },
    { code: 'diagnoses', label: 'Diagnosa', inputs: ['diagnoses'] },
    {
        code: 'prognosis',
        label: 'Prognosa',
        inputs: ['prognosis_id', 'chronic_disease_ids'],
    },
] as const satisfies readonly {
    code: string;
    label: string;
    inputs: readonly string[];
    byDefault?: boolean;
}[];

export type ExaminationPanel = (typeof examinationPanels)[number]['code'];

export function isExaminationPanel(value: string): value is ExaminationPanel {
    return examinationPanels.some((panel) => panel.code === value);
}

const byDefault = (panel: (typeof examinationPanels)[number]) =>
    !('byDefault' in panel) || panel.byDefault;

// Panel yang tampil, dalam urutan katalog, dari baris yang diatur section. Panel tanpa baris memakai bawaannya.
export function activePanels(
    settings: readonly { code: string; active: boolean }[],
): ExaminationPanel[] {
    return examinationPanels
        .filter((panel) => {
            const setting = settings.find((row) => row.code === panel.code);
            return setting ? setting.active : byDefault(panel);
        })
        .map((panel) => panel.code);
}

export const panelSettingSchema = z.object({
    code: z.string(),
    active: z.boolean(),
});

// Panel yang dipakai satu section.
export async function sectionPanels(
    db: Database,
    tenantId: string,
    sectionId: string,
): Promise<ExaminationPanel[]> {
    return activePanels(
        await db.rows(
            panelSettingSchema,
            `select panel_kode as code, aktif as active from sim_m_section_panel_pemeriksaan
             where tenant_id = $1 and section_id = $2 and deleted_at is null`,
            [tenantId, sectionId],
        ),
    );
}
