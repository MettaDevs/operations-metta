import { expect, test } from 'bun:test';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');

// Pencarian daftar halaman ada di toolbar, lewat `search` pada `RecordActionBar`, yang merender kotak pencariannya
// sendiri. Layar yang memakai `ListPageLayout` adalah daftar halaman, jadi kotak pencarian buatan sendiri di berkas itu
// berarti pencarian keluar dari toolbar. Pencarian di dialog dan pemilih (`InlineLookup`) tidak memakai
// `type="search"`, jadi tidak ikut tertolak.
test('list screens search through the toolbar, not their own search box', async () => {
    const files = ['src/**/*.tsx', 'modules/*/src/**/*.tsx'].flatMap(
        (pattern) => [...new Bun.Glob(pattern).scanSync({ cwd: root })],
    );
    const offenders: string[] = [];
    let lists = 0;
    for (const file of files) {
        const source = await Bun.file(join(root, file)).text();
        if (!source.includes('<ListPageLayout')) continue;
        lists++;
        if (/type=["']search["']|type:\s*["']search["']/.test(source))
            offenders.push(file.replaceAll('\\', '/'));
    }
    expect(lists).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
});
