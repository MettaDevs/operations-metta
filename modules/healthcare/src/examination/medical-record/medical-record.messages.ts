// Pesan sistem lama persis (lookup/services.php dan Eresep/FormEresep.php), dan pesan alergen ganda di daftar alergi
// pasien. Dipakai server saat Simpan dan layar saat memilih baris, jadi berkas ini tidak meng-import apa pun.

export const procedureDuplicateMessage = (name: string) =>
    `Biaya Tindakan ${name} sudah ada pada daftar Jasa`;
export const drugDuplicateMessage = (name: string) =>
    `Tidak dapat menambahkan obat "${name}", karena obat ini sudah ada dalam resep!`;
export const drugAllergyMessage = (name: string) =>
    `Tidak dapat menambahkan obat "${name}", karena pasien alergi terhadap obat ini!`;
export const invalidCompoundMessage = 'Racikan tidak valid!';
export const missingDrugMessage =
    'Pilih Obat Sebelum ditambahkan kedalam resep';
export const duplicateAllergyMessage = (name: string) =>
    `${name} sudah ada di daftar alergi.`;
