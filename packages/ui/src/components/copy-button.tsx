import { CheckIcon, CopyIcon } from 'lucide-react';
import * as React from 'react';

import { cn } from '../utils';
import { Button } from './button';

const copiedDuration = 1500;

// Tombol salin dengan umpan balik di tombol itu sendiri: ikon bergoyang saat disorot, lalu berganti centang dan label
// "Disalin" selama 1,5 detik. Gagal menyalin diserahkan ke pemanggil lewat onError.
function CopyButton({
    text,
    children = 'Salin',
    copiedLabel = 'Disalin',
    onError,
    className,
    ...props
}: Omit<React.ComponentProps<typeof Button>, 'onClick' | 'children'> & {
    text: string | (() => string);
    children?: React.ReactNode;
    copiedLabel?: React.ReactNode;
    onError?: () => void;
}) {
    const [copied, setCopied] = React.useState(false);
    const [used, setUsed] = React.useState(false);

    React.useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(false), copiedDuration);
        return () => clearTimeout(timer);
    }, [copied]);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(
                typeof text === 'function' ? text() : text,
            );
            setCopied(true);
            setUsed(true);
        } catch {
            onError?.();
        }
    };

    return (
        <Button
            type="button"
            variant="outline"
            size="sm"
            data-slot="copy-button"
            data-copied={copied ? 'true' : undefined}
            data-used={used ? 'true' : undefined}
            className={cn('overflow-hidden', className)}
            onClick={() => {
                if (!copied) void copy();
            }}
            {...props}
        >
            <span
                key={copied ? 'copied' : 'copy'}
                aria-live="polite"
                data-slot="copy-button-label"
                className="inline-flex items-center gap-1.5"
            >
                {copied ? (
                    <>
                        <CheckIcon
                            aria-hidden="true"
                            data-slot="copy-button-check"
                            className="size-3.5"
                        />
                        {copiedLabel}
                    </>
                ) : (
                    <>
                        <CopyIcon
                            aria-hidden="true"
                            data-slot="copy-button-icon"
                            className="size-3.5"
                        />
                        {children}
                    </>
                )}
            </span>
        </Button>
    );
}

export { CopyButton };
