// Prototype sekali pakai untuk memilih bentuk layar registrasi kunjungan. Semua data di sini sintetis.

export type VisitStatus = 'waiting' | 'in_exam' | 'done' | 'cancelled';
export type Installation = 'outpatient' | 'emergency' | 'inpatient' | 'support';
export type VisitKind = 'sick' | 'healthy';

export type MockPatient = {
    id: string;
    nrm: string;
    old_nrm: string | null;
    document_number: string | null;
    blood_type: string | null;
    name: string;
    email: string | null;
    nik: string;
    family_card: string | null;
    birth_place: string;
    birth_date: string;
    marital_status: string;
    religion: string;
    education: string;
    occupation: string;
    phone: string;
    gender: 'Laki-laki' | 'Perempuan';
    family_role: string;
    citizenship: string;
    street: string;
    province: string;
    regency: string;
    district: string;
    village: string;
    insurance_number: string | null;
    cluster: string;
    history: {
        date: string;
        installation: string;
        section: string;
        triage: 'Merah' | 'Oranye' | 'Kuning' | 'Hijau';
    }[];
    diseases: { color: string; icd: string; name: string }[];
    pregnancy_risks: string[];
};

export type MockSection = {
    id: string;
    name: string;
    installation: Installation;
};
export type MockSchedule = {
    id: string;
    section_id: string;
    practitioner: string;
    hours: string;
    quota: number;
    used: number;
};

export type MockRegistration = {
    id: string;
    queue: string;
    registered_at: string;
    number: string;
    patient: MockPatient;
    section: string;
    practitioner: string;
    visit_kind: VisitKind;
    patient_type: string;
    status: VisitStatus;
};

export const statusLabels: Record<VisitStatus, string> = {
    waiting: 'Belum periksa',
    in_exam: 'Sedang periksa',
    done: 'Sudah periksa',
    cancelled: 'Batal',
};

export const installations: { id: Installation; name: string }[] = [
    { id: 'outpatient', name: 'Rawat jalan' },
    { id: 'emergency', name: 'Gawat darurat' },
    { id: 'inpatient', name: 'Rawat inap' },
    { id: 'support', name: 'Penunjang' },
];

export const sections: MockSection[] = [
    { id: 'umum', name: 'Poli Umum', installation: 'outpatient' },
    { id: 'gigi', name: 'Poli Gigi', installation: 'outpatient' },
    { id: 'kia', name: 'Poli KIA', installation: 'outpatient' },
    { id: 'lansia', name: 'Poli Lansia', installation: 'outpatient' },
    { id: 'anak', name: 'Poli Anak', installation: 'outpatient' },
    { id: 'tb', name: 'Poli TB', installation: 'outpatient' },
    { id: 'gizi', name: 'Konsultasi Gizi', installation: 'outpatient' },
    { id: 'imunisasi', name: 'Imunisasi', installation: 'outpatient' },
    { id: 'igd', name: 'IGD', installation: 'emergency' },
    { id: 'ponek', name: 'PONEK', installation: 'emergency' },
    { id: 'melati', name: 'Ruang Melati', installation: 'inpatient' },
    { id: 'mawar', name: 'Ruang Mawar', installation: 'inpatient' },
    { id: 'lab', name: 'Laboratorium', installation: 'support' },
    { id: 'radiologi', name: 'Radiologi', installation: 'support' },
];

export const schedules: MockSchedule[] = [
    {
        id: 's1',
        section_id: 'umum',
        practitioner: 'dr. Contoh Satu',
        hours: '08.00–12.00',
        quota: 30,
        used: 12,
    },
    {
        id: 's2',
        section_id: 'umum',
        practitioner: 'dr. Contoh Dua',
        hours: '13.00–16.00',
        quota: 25,
        used: 25,
    },
    {
        id: 's3',
        section_id: 'gigi',
        practitioner: 'drg. Contoh Tiga',
        hours: '08.00–11.00',
        quota: 15,
        used: 4,
    },
    {
        id: 's4',
        section_id: 'lansia',
        practitioner: 'dr. Contoh Empat',
        hours: '08.00–12.00',
        quota: 20,
        used: 17,
    },
    {
        id: 's5',
        section_id: 'anak',
        practitioner: 'dr. Contoh Lima, Sp.A',
        hours: '09.00–12.00',
        quota: 20,
        used: 6,
    },
    {
        id: 's6',
        section_id: 'igd',
        practitioner: 'dr. Jaga Contoh',
        hours: '24 jam',
        quota: 99,
        used: 8,
    },
    {
        id: 's7',
        section_id: 'tb',
        practitioner: 'dr. Contoh Enam',
        hours: '10.00–12.00',
        quota: 10,
        used: 2,
    },
];

export const triageBands = [
    {
        id: 'red',
        name: 'Merah',
        items: [
            'Tidak sadarkan diri / pingsan',
            'Nadi tidak teraba / henti jantung',
            'Tidak bernapas / kesulitan bernapas',
            'Kejang berulang / kejang lama',
        ],
    },
    {
        id: 'orange',
        name: 'Oranye',
        items: ['Nyeri hebat', 'Nyeri dada'],
    },
    {
        id: 'yellow',
        name: 'Kuning',
        items: ['Tampak pucat', 'Sempoyongan', 'Lemas'],
    },
    {
        id: 'green',
        name: 'Hijau',
        items: ['Kondisi stabil'],
    },
] as const;

export const patientTypes = [
    { id: 'UMUM', name: 'Umum', needsGuarantor: false },
    { id: 'ASR', name: 'Asuransi', needsGuarantor: true },
    { id: 'BPJS', name: 'BPJS Kesehatan', needsGuarantor: true },
];

export const guarantors = [
    'Asuransi Contoh',
    'Asuransi Contoh Dua',
    'BPJS Kesehatan',
];
export const conditions = ['Handaya', 'Difabel', 'Lansia', 'Lain-lain'];

const firstNames = [
    'Satu',
    'Dua',
    'Tiga',
    'Empat',
    'Lima',
    'Enam',
    'Tujuh',
    'Delapan',
    'Sembilan',
    'Sepuluh',
];
const villages = [
    'Sukamaju',
    'Mekarsari',
    'Sindangsari',
    'Cibening',
    'Karanganyar',
];

function patient(index: number): MockPatient {
    const female = index % 2 === 0;
    const year = 1950 + ((index * 7) % 70);
    const month = String((index % 12) + 1).padStart(2, '0');
    const day = String((index % 27) + 1).padStart(2, '0');
    const village = villages[index % villages.length] ?? 'Sukamaju';
    return {
        id: `p${index}`,
        nrm: String(100200 + index * 37).padStart(8, '0'),
        old_nrm: index % 3 === 0 ? `L-${String(4400 + index)}` : null,
        document_number: index % 4 === 0 ? `DRM-${String(900 + index)}` : null,
        blood_type: ['A', 'B', 'AB', 'O', null][index % 5] ?? null,
        name: `PASIEN CONTOH ${firstNames[index % firstNames.length] ?? 'Satu'}${index >= 10 ? ` ${String(Math.floor(index / 10) + 1)}` : ''}`,
        email: index % 3 === 1 ? `pasien${String(index)}@contoh.test` : null,
        nik: `3201${String(10000000000 + index * 7919).slice(-12)}`,
        family_card: `3201${String(20000000000 + index * 3571).slice(-12)}`,
        birth_place:
            ['Bogor', 'Bandung', 'Bekasi', 'Depok'][index % 4] ?? 'Bogor',
        birth_date: `${String(year)}-${month}-${day}`,
        marital_status: index % 3 === 0 ? 'Belum kawin' : 'Kawin',
        religion: 'Islam',
        education: ['SD', 'SMP', 'SMA', 'D3', 'S1'][index % 5] ?? 'SMA',
        occupation:
            [
                'Ibu rumah tangga',
                'Wiraswasta',
                'Pegawai swasta',
                'Petani',
                'Pelajar',
            ][index % 5] ?? 'Wiraswasta',
        phone: `0812-0000-${String(1000 + index)}`,
        gender: female ? 'Perempuan' : 'Laki-laki',
        family_role:
            index % 4 === 0 ? 'Kepala keluarga' : female ? 'Istri' : 'Anak',
        citizenship: 'WNI',
        street: `Jl. Contoh No. ${String(index + 1)}, RT 00${String((index % 9) + 1)}/RW 00${String((index % 5) + 1)}`,
        province: 'Jawa Barat',
        regency: 'Kabupaten Contoh',
        district: 'Kecamatan Contoh',
        village,
        insurance_number:
            index % 3 === 2 ? `000${String(1234500000 + index)}` : null,
        cluster:
            [
                'Klaster 2 (Ibu dan anak)',
                'Klaster 3 (Dewasa dan lansia)',
                'Klaster 4 (Penyakit menular)',
            ][index % 3] ?? '',
        history:
            index % 5 === 4
                ? []
                : [
                      {
                          date: '2026-10-28',
                          installation: 'Rawat jalan',
                          section: 'Poli Umum',
                          triage: 'Hijau' as const,
                      },
                      {
                          date: '2026-09-14',
                          installation: 'Gawat darurat',
                          section: 'IGD',
                          triage: 'Kuning' as const,
                      },
                      {
                          date: '2026-07-02',
                          installation: 'Rawat jalan',
                          section: 'Poli Lansia',
                          triage: 'Hijau' as const,
                      },
                  ].slice(0, (index % 3) + 1),
        diseases:
            index % 2 === 1
                ? [
                      {
                          color: 'Merah',
                          icd: 'I10',
                          name: 'Hipertensi esensial',
                      },
                      {
                          color: 'Kuning',
                          icd: 'E11.9',
                          name: 'Diabetes melitus tipe 2',
                      },
                  ].slice(0, index % 4 === 1 ? 2 : 1)
                : [],
        pregnancy_risks:
            female && year > 1990 && index % 4 === 0
                ? ['Riwayat keguguran', 'Anemia']
                : [],
    };
}

export const patients: MockPatient[] = Array.from({ length: 24 }, (_, index) =>
    patient(index),
);

const statusCycle: VisitStatus[] = [
    'done',
    'done',
    'done',
    'waiting',
    'in_exam',
    'done',
    'cancelled',
    'waiting',
];

export const registrations: MockRegistration[] = Array.from(
    { length: 42 },
    (_, index) => {
        const schedule = schedules[index % schedules.length] ?? schedules[0];
        const section = sections.find(
            (item) => item.id === schedule?.section_id,
        );
        const minute = String((index * 13) % 60).padStart(2, '0');
        const hour = String(7 + Math.floor(index / 5)).padStart(2, '0');
        const owner = patients[index % patients.length] ?? patient(0);
        return {
            id: `r${String(index)}`,
            queue: `${(section?.name ?? 'U').replace('Poli ', '').slice(0, 1)}-${String((index % 30) + 1).padStart(3, '0')}`,
            registered_at: `2026-11-11 ${hour}:${minute}:14`,
            number: `261111REG-${String(61800 + index).padStart(6, '0')}`,
            patient: owner,
            section: section?.name ?? 'Poli Umum',
            practitioner: schedule?.practitioner ?? '',
            visit_kind: index % 6 === 5 ? 'healthy' : 'sick',
            patient_type: owner.insurance_number ? 'BPJS Kesehatan' : 'Umum',
            status: statusCycle[index % statusCycle.length] ?? 'done',
        };
    },
);

export const counters: Record<VisitStatus | 'total', number> = {
    waiting: 30,
    in_exam: 5,
    done: 6652,
    cancelled: 323,
    total: 6687,
};

export function age(birthDate: string, today = new Date('2026-11-11')): string {
    const birth = new Date(birthDate);
    let years = today.getFullYear() - birth.getFullYear();
    let months = today.getMonth() - birth.getMonth();
    let days = today.getDate() - birth.getDate();
    if (days < 0) {
        months -= 1;
        days += new Date(today.getFullYear(), today.getMonth(), 0).getDate();
    }
    if (months < 0) {
        years -= 1;
        months += 12;
    }
    return `${String(years)} thn ${String(months)} bln ${String(days)} hr`;
}

export function findPatients(query: string): MockPatient[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return patients
        .filter(
            (item) =>
                item.nrm.includes(needle) ||
                item.nik.includes(needle) ||
                item.name.toLowerCase().includes(needle),
        )
        .slice(0, 8);
}
