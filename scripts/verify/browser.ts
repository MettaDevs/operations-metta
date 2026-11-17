import { existsSync } from 'node:fs';
import { z } from 'zod';

// Peramban untuk verifikasi: Chrome atau Edge yang sudah terpasang, dikendalikan lewat Chrome DevTools Protocol (CDP)
// dengan WebSocket bawaan Bun. Tanpa dependency baru dan tanpa unduhan peramban.

const browserCandidates = [
    process.env.CHROME_PATH ?? '',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
];

export function findBrowser(): string {
    const found = browserCandidates.find(
        (path) => path !== '' && existsSync(path),
    );
    if (!found)
        throw new Error(
            'Chrome atau Edge tidak ditemukan. Isi CHROME_PATH dengan path berkas peramban.',
        );
    return found;
}

export function browserArguments(cdpPort: number, profile: string): string[] {
    return [
        '--headless=new',
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${profile}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--window-size=1440,900',
        'about:blank',
    ];
}

const targetsSchema = z.array(
    z.object({
        type: z.string(),
        webSocketDebuggerUrl: z.string().optional(),
    }),
);

const messageSchema = z.object({
    id: z.number().optional(),
    result: z.unknown().optional(),
    error: z.object({ message: z.string() }).optional(),
});

export type Page = {
    send(method: string, params?: Record<string, unknown>): Promise<unknown>;
    close(): void;
};

export async function connectPage(cdpPort: number): Promise<Page> {
    const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
    const target = targetsSchema
        .parse(await response.json())
        .find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
    if (!target?.webSocketDebuggerUrl)
        throw new Error(`Tidak ada tab peramban di port CDP ${cdpPort}.`);
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => {
            resolve();
        });
        socket.addEventListener('error', () => {
            reject(new Error('Koneksi CDP gagal.'));
        });
    });
    let nextId = 0;
    const pending = new Map<
        number,
        { resolve: (value: unknown) => void; reject: (error: Error) => void }
    >();
    socket.addEventListener('message', (event) => {
        const message = messageSchema.parse(JSON.parse(String(event.data)));
        if (message.id === undefined) return;
        const waiter = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) waiter?.reject(new Error(message.error.message));
        else waiter?.resolve(message.result);
    });
    return {
        send(method, params = {}) {
            nextId += 1;
            const id = nextId;
            return new Promise((resolve, reject) => {
                pending.set(id, { resolve, reject });
                socket.send(JSON.stringify({ id, method, params }));
            });
        },
        close() {
            socket.close();
        },
    };
}

const evaluationSchema = z.object({
    result: z.object({ value: z.unknown().optional() }),
    exceptionDetails: z
        .object({
            text: z.string(),
            exception: z.object({ description: z.string() }).optional(),
        })
        .optional(),
});

export async function evaluate(
    page: Page,
    expression: string,
): Promise<unknown> {
    const evaluation = evaluationSchema.parse(
        await page.send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
        }),
    );
    if (evaluation.exceptionDetails)
        throw new Error(
            evaluation.exceptionDetails.exception?.description ??
                evaluation.exceptionDetails.text,
        );
    return evaluation.result.value;
}

// Pencari elemen yang dijalankan di halaman. Elemen dicari dari role dan nama aksesnya, seperti yang dilihat pengguna
// pembaca layar: aria-label, aria-labelledby, <label for>, label pembungkus, placeholder, lalu teksnya sendiri.
// `within` membatasi pencarian ke dialog, region, atau baris tabel yang teksnya memuat nilai itu.
const locatorSource = String.raw`(() => {
  const roles = {
    button: 'button, [role=button], input[type=submit], input[type=button]',
    link: 'a[href], [role=link]',
    textbox: 'input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=submit]):not([type=button]), textarea, [role=textbox], [contenteditable=true]',
    combobox: '[role=combobox], select',
    option: '[role=option]',
    tab: '[role=tab]',
    menuitem: '[role=menuitem], [role=menuitemradio], [role=menuitemcheckbox]',
    checkbox: 'input[type=checkbox], [role=checkbox], [role=switch]',
    radio: 'input[type=radio], [role=radio]',
    row: 'tr, [role=row]',
    heading: 'h1, h2, h3, h4, [role=heading]',
    text: '*',
  };
  const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
  const visible = (element) => {
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return false;
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const nameOf = (element) => {
    const label = element.getAttribute('aria-label');
    if (label) return clean(label);
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) return clean(labelledBy.split(' ').map((id) => document.getElementById(id)?.textContent).join(' '));
    if (element.id) {
      const forLabel = document.querySelector('label[for="' + CSS.escape(element.id) + '"]');
      if (forLabel) return clean(forLabel.textContent);
    }
    const wrapping = element.closest('label');
    if (wrapping) return clean(wrapping.textContent);
    if (element.getAttribute('placeholder')) return clean(element.getAttribute('placeholder'));
    if (element.matches('input, textarea, select')) return '';
    return clean(element.innerText || element.textContent);
  };
  const scopeOf = (within) => {
    if (!within) return [document];
    const label = (element) => clean(element.getAttribute('aria-label') || (element.getAttribute('aria-labelledby') || '').split(' ').map((id) => document.getElementById(id)?.textContent || '').join(' '));
    const containers = [...document.querySelectorAll('[role=dialog], [role=alertdialog], [role=group], [role=radiogroup], fieldset, section, form, tr, [role=row], [role=region], [role=tabpanel], li, article')]
      .filter((element) => visible(element) && (label(element).includes(within) || clean(element.innerText).includes(within)));
    containers.sort((a, b) => a.innerText.length - b.innerText.length);
    return containers.slice(0, 1);
  };
  const ownText = (element) => clean([...element.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join(' '));
  window.__verifyFind = (spec) => {
    const selector = roles[spec.role];
    if (!selector) throw new Error('role tidak dikenal: ' + spec.role);
    const matches = (value) => spec.exact ? value === spec.name : spec.prefix ? value.startsWith(spec.name) : value.toLowerCase().includes(spec.name.toLowerCase());
    const found = [];
    for (const scope of scopeOf(spec.within)) {
      for (const element of scope.querySelectorAll(selector)) {
        if (!visible(element)) continue;
        const name = spec.role === 'text' ? ownText(element) : nameOf(element);
        if (name && matches(name)) found.push({ element, name });
      }
    }
    const hit = found[spec.nth || 0];
    if (!hit) return null;
    hit.element.scrollIntoView({ block: 'center', inline: 'center' });
    const box = hit.element.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2, name: hit.name, count: found.length, disabled: Boolean(hit.element.disabled || hit.element.getAttribute('aria-disabled') === 'true'), value: 'value' in hit.element ? String(hit.element.value) : null };
  };
})()`;

export const roles = [
    'button',
    'link',
    'textbox',
    'combobox',
    'option',
    'tab',
    'menuitem',
    'checkbox',
    'radio',
    'row',
    'heading',
    'text',
] as const;

export type Locator = {
    role: (typeof roles)[number];
    name: string;
    exact?: boolean;
    prefix?: boolean;
    within?: string;
    nth?: number;
};

const hitSchema = z
    .object({
        x: z.number(),
        y: z.number(),
        name: z.string(),
        count: z.number(),
        disabled: z.boolean(),
        value: z.string().nullable(),
    })
    .nullable();

export type Hit = NonNullable<z.infer<typeof hitSchema>>;

export function describe(locator: Locator): string {
    const where = locator.within ? ` di dalam "${locator.within}"` : '';
    return `${locator.role} "${locator.name}"${where}`;
}

export async function find(page: Page, locator: Locator): Promise<Hit | null> {
    await evaluate(page, locatorSource);
    return hitSchema.parse(
        await evaluate(page, `window.__verifyFind(${JSON.stringify(locator)})`),
    );
}

export async function waitFor(
    page: Page,
    locator: Locator,
    timeoutMs = 15_000,
): Promise<Hit> {
    const deadline = Date.now() + timeoutMs;
    let previous: Hit | null = null;
    for (;;) {
        const hit = await find(page, locator);
        // Dialog dan popover beranimasi saat terbuka. Klik hanya setelah posisinya sama di dua bacaan berturut-turut,
        // supaya klik tidak jatuh di luar dialog lalu menutupnya.
        const settled =
            hit !== null &&
            previous !== null &&
            Math.abs(hit.x - previous.x) < 1 &&
            Math.abs(hit.y - previous.y) < 1;
        if (hit && !hit.disabled && settled) return hit;
        previous = hit;
        if (Date.now() > deadline)
            throw new Error(
                hit
                    ? `${describe(locator)} ada tetapi nonaktif setelah ${timeoutMs} ms.`
                    : `${describe(locator)} tidak muncul dalam ${timeoutMs} ms.`,
            );
        await Bun.sleep(100);
    }
}

export async function waitGone(
    page: Page,
    locator: Locator,
    timeoutMs = 15_000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (await find(page, locator)) {
        if (Date.now() > deadline)
            throw new Error(
                `${describe(locator)} masih ada setelah ${timeoutMs} ms.`,
            );
        await Bun.sleep(200);
    }
}

export async function clickAt(page: Page, x: number, y: number): Promise<void> {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    for (const type of ['mousePressed', 'mouseReleased'])
        await page.send('Input.dispatchMouseEvent', {
            type,
            x,
            y,
            button: 'left',
            clickCount: 1,
        });
}

export async function click(page: Page, locator: Locator): Promise<Hit> {
    const hit = await waitFor(page, locator);
    await clickAt(page, hit.x, hit.y);
    return hit;
}

const keys = {
    Enter: {
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        text: '\r',
    },
    Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
    Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
    ArrowDown: {
        key: 'ArrowDown',
        code: 'ArrowDown',
        windowsVirtualKeyCode: 40,
    },
    ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
    Backspace: {
        key: 'Backspace',
        code: 'Backspace',
        windowsVirtualKeyCode: 8,
    },
} as const;

export const keyNames = Object.keys(keys);

export function isKeyName(value: string): value is keyof typeof keys {
    return value in keys;
}

export async function press(
    page: Page,
    name: keyof typeof keys,
): Promise<void> {
    const key = keys[name];
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
}

// Mengisi seperti pengguna: klik field, pilih seluruh isinya, lalu ketik nilai baru. React menerima event input asli.
export async function fill(
    page: Page,
    locator: Locator,
    value: string,
): Promise<Hit> {
    const hit = await click(page, locator);
    await page.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'a',
        code: 'KeyA',
        windowsVirtualKeyCode: 65,
        modifiers: process.platform === 'darwin' ? 4 : 2,
        commands: ['selectAll'],
    });
    await page.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'a',
        code: 'KeyA',
        windowsVirtualKeyCode: 65,
    });
    if (value === '') await press(page, 'Backspace');
    else await page.send('Input.insertText', { text: value });
    return hit;
}

export async function navigate(page: Page, url: string): Promise<void> {
    await page.send('Page.enable');
    await page.send('Page.navigate', { url });
    const deadline = Date.now() + 30_000;
    while (
        (await evaluate(page, 'document.readyState')) !== 'complete' ||
        (await evaluate(page, 'location.href')) === 'about:blank'
    ) {
        if (Date.now() > deadline)
            throw new Error(`${url} tidak selesai dimuat dalam 30 detik.`);
        await Bun.sleep(200);
    }
}

export async function pageText(page: Page): Promise<string> {
    return z.string().parse(await evaluate(page, 'document.body.innerText'));
}

// Menunggu teks halaman cocok dengan pola, lalu mengembalikan hasil cocoknya. Pola `failOn` yang muncul lebih dulu
// menggagalkan penantian dengan teks yang cocok itu, misalnya ringkasan isian yang perlu diperbaiki.
export async function waitForText(
    page: Page,
    pattern: RegExp,
    options: { timeoutMs?: number; failOn?: RegExp } = {},
): Promise<RegExpMatchArray> {
    const deadline = Date.now() + (options.timeoutMs ?? 15_000);
    for (;;) {
        const text = await pageText(page);
        const failure = options.failOn ? text.match(options.failOn) : null;
        if (failure)
            throw new Error(
                `Layar menampilkan "${failure[0]}" saat menunggu ${String(pattern)}.`,
            );
        const match = text.match(pattern);
        if (match) return match;
        if (Date.now() > deadline)
            throw new Error(
                `Teks ${String(pattern)} tidak muncul dalam ${options.timeoutMs ?? 15_000} ms.`,
            );
        await Bun.sleep(250);
    }
}

export async function currentUrl(page: Page): Promise<string> {
    return z.string().parse(await evaluate(page, 'location.href'));
}

export type Clip = { x: number; y: number; width: number; height: number };

const clipSchema = z
    .object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
    })
    .nullable();

// Kotak ringkasan error (role=alert) yang pertama tampil, diberi tepi 8 px, untuk screenshot close-up.
export async function alertClip(page: Page): Promise<Clip | null> {
    return clipSchema.parse(
        await evaluate(
            page,
            `(() => { const el = [...document.querySelectorAll('[role=alert]')].find((e) => e.getBoundingClientRect().height > 0); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.max(0, b.x - 8), y: Math.max(0, b.y - 8), width: b.width + 16, height: b.height + 16 }; })()`,
        ),
    );
}

export async function screenshot(page: Page, clip?: Clip): Promise<Uint8Array> {
    const shot = z.object({ data: z.string() }).parse(
        await page.send('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: true,
            ...(clip ? { clip: { ...clip, scale: 2 } } : {}),
        }),
    );
    return Buffer.from(shot.data, 'base64');
}

const axText = z.union([z.string(), z.number(), z.boolean()]).catch('');
const axValue = z.object({ value: axText.optional() }).optional();

const axTreeSchema = z.object({
    nodes: z.array(
        z.object({
            nodeId: z.string(),
            ignored: z.boolean().optional(),
            role: axValue,
            name: axValue,
            value: axValue,
            childIds: z.array(z.string()).optional(),
        }),
    ),
});

const quietRoles = new Set([
    'generic',
    'none',
    'InlineTextBox',
    'LineBreak',
    'RootWebArea',
]);

// Snapshot pohon aksesibilitas: satu baris per elemen, `role "nama" = nilai`, diindentasi menurut kedalaman.
export async function ariaSnapshot(page: Page): Promise<string> {
    await page.send('Accessibility.enable');
    const tree = axTreeSchema.parse(
        await page.send('Accessibility.getFullAXTree'),
    );
    const byId = new Map(tree.nodes.map((node) => [node.nodeId, node]));
    const lines: string[] = [];
    // StaticText yang hanya mengulang nama induknya dibuang, supaya snapshot tetap terbaca.
    const visit = (id: string, depth: number, parentName: string): void => {
        const node = byId.get(id);
        if (!node) return;
        const role = String(node.role?.value ?? '');
        const name = String(node.name?.value ?? '').trim();
        const shown =
            !node.ignored &&
            !quietRoles.has(role) &&
            name !== '' &&
            !(role === 'StaticText' && parentName.includes(name));
        if (shown) {
            const value =
                node.value?.value === undefined || node.value.value === ''
                    ? ''
                    : ` = ${String(node.value.value)}`;
            lines.push(`${'  '.repeat(depth)}${role} "${name}"${value}`);
        }
        for (const child of node.childIds ?? [])
            visit(child, shown ? depth + 1 : depth, shown ? name : parentName);
    };
    const root = tree.nodes[0];
    if (root) visit(root.nodeId, 0, '');
    return lines.join('\n');
}

const nodeSchema = z.object({ root: z.object({ nodeId: z.number() }) });
const querySchema = z.object({ nodeId: z.number() });

// Mengisi input berkas pertama yang cocok dengan selector, seperti pengguna memilih berkas di dialog Open.
export async function chooseFile(
    page: Page,
    selector: string,
    path: string,
): Promise<void> {
    const document = nodeSchema.parse(await page.send('DOM.getDocument'));
    const { nodeId } = querySchema.parse(
        await page.send('DOM.querySelector', {
            nodeId: document.root.nodeId,
            selector,
        }),
    );
    if (!nodeId) throw new Error(`Input berkas ${selector} tidak ditemukan.`);
    await page.send('DOM.setFileInputFiles', { nodeId, files: [path] });
}
