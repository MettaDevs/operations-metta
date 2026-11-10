export {};

declare module 'react' {
    // Variabel CSS (`--nama`) di prop `style` hanya bisa ditambahkan ke tipe milik React lewat `interface` berisi index signature; `type` akan menimpanya, dan `extends Record` menyisakan interface kosong.
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions, @typescript-eslint/consistent-indexed-object-style
    interface CSSProperties {
        [key: `--${string}`]: string | number | undefined;
    }
}
