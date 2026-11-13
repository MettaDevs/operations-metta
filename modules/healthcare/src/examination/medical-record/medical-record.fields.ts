import type {
    dentalSchema,
    fallRiskSchema,
    historySchema,
    otherSchema,
    painSchema,
    physicalSchema,
    statusSchema,
} from './medical-record.schema.ts';
import type { z } from 'zod';

// Satu isian panel: kolom tabelnya dan cara nilainya diperiksa.
// - text: teks, kosong menjadi null.
// - check: kotak centang; tidak dicentang dihitung kosong.
// - flag: pilihan Ya/Tidak; Tidak tetap nilai.
// - whole: bilangan bulat dalam batas kolom.
// - decimal: angka dengan satu desimal, muat di kolomnya.
// - option: kode dari sim_m_pemeriksaan_pilihan kelompok `group`.
export type FieldSpec =
    | { kind: 'text'; column: string; max: number }
    | { kind: 'check'; column: string }
    | { kind: 'flag'; column: string }
    | { kind: 'whole'; column: string; min: number; max: number }
    | { kind: 'decimal'; column: string; max: number }
    | { kind: 'option'; column: string; group: OptionGroup };

// Kelompok pilihan di sim_m_pemeriksaan_pilihan yang dibaca isian.
export const optionGroups = [
    'ekspresi_emosi',
    'bahasa',
    'tinggal_dengan',
    'ekonomi',
    'gangguan_jiwa',
    'hubungan_keluarga',
    'kesadaran',
    'cara_ukur_tinggi',
    'gcs_mata',
    'gcs_verbal',
    'gcs_motorik',
    'aktivitas',
    'detak_jantung',
    'triage',
    'kualitas_nyeri',
    'waktu_nyeri',
    'tipe_askep',
    'gigi_bengkak',
    'gigi_konsistensi',
    'gigi_warna_kulit',
    'gigi_suhu_kulit',
    'gigi_goyang',
    'gigi_warna_gusi',
    'gigi_karies',
    'gigi_pembengkakan',
    'gigi_perkusi',
    'gigi_druk',
    'gigi_palpasi',
    'gigi_status_karies',
    'waktu_meninggal',
] as const;
export type OptionGroup = (typeof optionGroups)[number];

const text = (column: string, max = 10000): FieldSpec => ({
    kind: 'text',
    column,
    max,
});
const note = (column: string): FieldSpec => text(column, 500);
const flag = (column: string): FieldSpec => ({ kind: 'flag', column });
const option = (column: string, group: OptionGroup): FieldSpec => ({
    kind: 'option',
    column,
    group,
});
const whole = (column: string, min = 0, max = 32767): FieldSpec => ({
    kind: 'whole',
    column,
    min,
    max,
});
const decimal = (column: string, max: number): FieldSpec => ({
    kind: 'decimal',
    column,
    max,
});

type Fields<S extends z.ZodObject> = Record<keyof z.infer<S>, FieldSpec>;

// Panel yang disimpan satu baris per pemeriksaan. Baris hanya ditulis bila panel berisi.
export const panels = {
    history: {
        table: 'sim_tr_pemeriksaan_riwayat_penyakit',
        fields: {
            none: { kind: 'check', column: 'tidak_ada' },
            present: text('riwayat_sekarang'),
            past: text('riwayat_dahulu'),
            family: text('riwayat_keluarga'),
        } satisfies Fields<typeof historySchema>,
    },
    status: {
        table: 'sim_tr_pemeriksaan_status_fisik',
        fields: {
            uses_mobility_aid: flag('alat_bantu'),
            mobility_aid_note: note('alat_bantu_keterangan'),
            communication_barrier: flag('kendala_komunikasi'),
            communication_barrier_note: note('kendala_komunikasi_keterangan'),
            caregiver_at_home: flag('merawat_di_rumah'),
            caregiver_at_home_note: note('merawat_di_rumah_keterangan'),
            needs_assistance: flag('butuh_bantuan'),
            needs_assistance_note: note('butuh_bantuan_keterangan'),
            emotional_expression: option('ekspresi_emosi', 'ekspresi_emosi'),
            language: option('bahasa', 'bahasa'),
            language_note: note('bahasa_keterangan'),
            lives_with: option('tinggal_dengan', 'tinggal_dengan'),
            lives_with_note: note('tinggal_dengan_keterangan'),
            social_economy: option('sosial_ekonomi', 'ekonomi'),
            past_mental_disorder: option('gangguan_jiwa', 'gangguan_jiwa'),
            economic_status: option('status_ekonomi', 'ekonomi'),
            family_relationship: option(
                'hubungan_keluarga',
                'hubungan_keluarga',
            ),
        } satisfies Fields<typeof statusSchema>,
    },
    physical: {
        table: 'sim_tr_pemeriksaan_fisik',
        fields: {
            consciousness: option('kesadaran', 'kesadaran'),
            systolic: whole('sistole'),
            diastolic: whole('diastole'),
            height: decimal('tinggi_badan', 10000),
            height_method: option('cara_ukur_tinggi', 'cara_ukur_tinggi'),
            weight: decimal('berat_badan', 10000),
            waist_circumference: decimal('lingkar_perut', 10000),
            pulse_rate: whole('detak_nadi'),
            respiratory_rate: whole('nafas'),
            oxygen_saturation: whole('saturasi'),
            temperature: decimal('suhu', 1000),
            eye_opening: option('gcs_mata', 'gcs_mata'),
            verbal_response: option('gcs_verbal', 'gcs_verbal'),
            motor_response: option('gcs_motorik', 'gcs_motorik'),
            mobility: option('adl_mobilisasi', 'aktivitas'),
            toileting: option('adl_toileting', 'aktivitas'),
            eating: option('adl_makan_minum', 'aktivitas'),
            bathing: option('adl_mandi', 'aktivitas'),
            dressing: option('adl_berpakaian', 'aktivitas'),
            heart_rhythm: option('detak_jantung', 'detak_jantung'),
            triage: option('triage', 'triage'),
        } satisfies Fields<typeof physicalSchema>,
    },
    pain: {
        table: 'sim_tr_pemeriksaan_nyeri',
        fields: {
            has_pain: flag('merasakan_nyeri'),
            trigger: note('pencetus'),
            quality: option('kualitas', 'kualitas_nyeri'),
            location: note('lokasi'),
            scale: whole('skala', 0, 10),
            timing: option('waktu', 'waktu_nyeri'),
        } satisfies Fields<typeof painSchema>,
    },
    fall_risk: {
        table: 'sim_tr_pemeriksaan_risiko_jatuh',
        fields: {
            unsteady_gait: flag('cara_berjalan'),
            uses_support: flag('penopang'),
        } satisfies Fields<typeof fallRiskSchema>,
    },
    dental: {
        table: 'sim_tr_pemeriksaan_gigi_dasar',
        fields: {
            swelling: option('bengkak', 'gigi_bengkak'),
            consistency: option('konsistensi', 'gigi_konsistensi'),
            skin_color: option('warna_kulit', 'gigi_warna_kulit'),
            skin_temperature: option('suhu_kulit', 'gigi_suhu_kulit'),
            mobility: option('goyang', 'gigi_goyang'),
            gum_color: option('warna_gusi', 'gigi_warna_gusi'),
            caries: option('karies_gigi', 'gigi_karies'),
            intraoral_swelling: option('pembengkakan', 'gigi_pembengkakan'),
            percussion: option('perkusi', 'gigi_perkusi'),
            pressure: option('druk', 'gigi_druk'),
            palpation: option('palpasi', 'gigi_palpasi'),
            caries_status: option('status_karies', 'gigi_status_karies'),
        } satisfies Fields<typeof dentalSchema>,
    },
    other: {
        table: 'sim_tr_pemeriksaan_lainnya',
        fields: {
            drug_therapy: text('terapi_obat'),
            non_drug_therapy: text('terapi_non_obat'),
            consumables: text('bmhp'),
            plan: text('rencana'),
            smoking: flag('merokok'),
            alcohol: flag('konsumsi_alkohol'),
            low_vegetable_fruit: flag('kurang_sayur_buah'),
            nursing_care_type: option('tipe_askep', 'tipe_askep'),
            education: text('edukasi'),
            nursing_care_description: text('deskripsi_askep'),
            observation: text('observasi'),
            notes: text('keterangan'),
            biopsychosocial: text('biopsikososial'),
            nursing_actions: text('tindakan_keperawatan'),
        } satisfies Fields<typeof otherSchema>,
    },
} as const;
export type PanelName = keyof typeof panels;
export const panelNames = Object.keys(panels).filter(
    (name): name is PanelName => name in panels,
);

// Isian periksa fisik yang boleh diwajibkan lewat sim_m_pemeriksaan_wajib, dengan label pesan sistem lama
// ("Field {label} pada periksa fisik harus di isi").
export const requirableFields = {
    pulse_rate: 'Detak Nadi',
    respiratory_rate: 'Nafas',
    consciousness: 'Kesadaran',
    systolic: 'Sistole',
    diastolic: 'Diastole',
    height: 'Tinggi Badan',
    weight: 'Berat Badan',
    waist_circumference: 'Lingkar Perut',
    oxygen_saturation: 'Saturasi',
    temperature: 'Suhu',
} as const;
export type RequirableField = keyof typeof requirableFields;

export function isRequirableField(value: string): value is RequirableField {
    return value in requirableFields;
}

export const requiredMessage = (label: string) =>
    `Field ${label} pada periksa fisik harus di isi`;

export const examinerRequiredMessage =
    'Pilih dokter / tenaga medis yang memeriksa sebelum menyelesaikan pemeriksaan.';
export const examinerPanelMissingMessage =
    'Dokter / tenaga medis yang memeriksa belum tercatat, karena poli ini tidak memakai bagian Anamnesa. Aktifkan Anamnesa di kartu section.';

export const notStartedMessage =
    'Silahkan Klik Tombol Mulai Untuk Memulai Pemeriksaan !';
export const finishedMessage =
    'Pemeriksaan ini sudah selesai, jadi isinya tidak dapat diubah lagi.';
