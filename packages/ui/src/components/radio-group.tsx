import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import * as React from 'react';

import { cn } from '../utils';

function RadioGroup({
    className,
    ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
    return (
        <RadioGroupPrimitive.Root
            data-slot="radio-group"
            className={cn('grid gap-3', className)}
            {...props}
        />
    );
}

function RadioGroupItem({
    className,
    ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
    return (
        <RadioGroupPrimitive.Item
            data-slot="radio-group-item"
            className={cn(
                'relative aspect-square size-4 shrink-0 rounded-full border border-input shadow-xs transition-[color,background-color,border-color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[state=checked]:border-primary data-[state=checked]:bg-primary dark:bg-input/30 dark:aria-invalid:ring-destructive/40 dark:data-[state=checked]:bg-primary',
                className,
            )}
            {...props}
        >
            <RadioGroupPrimitive.Indicator
                data-slot="radio-group-indicator"
                className="absolute inset-0 flex items-center justify-center"
            >
                <span className="size-1.5 rounded-full bg-primary-foreground" />
            </RadioGroupPrimitive.Indicator>
        </RadioGroupPrimitive.Item>
    );
}

type RadioCardOption = {
    value: string;
    label: string;
    description?: string;
};

// Pilihan sebagai kartu: seluruh kartu bisa diklik, judul dan keterangan di kiri, radio di kanan.
function RadioCardGroup({
    options,
    className,
    ...props
}: Omit<React.ComponentProps<typeof RadioGroupPrimitive.Root>, 'children'> & {
    options: readonly RadioCardOption[];
}) {
    const id = React.useId();
    return (
        <RadioGroup className={cn('max-w-md gap-2', className)} {...props}>
            {options.map((option) => (
                <label
                    key={option.value}
                    htmlFor={`${id}-${option.value}`}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border p-4 shadow-xs transition-colors hover:bg-accent has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent"
                >
                    <span className="grid flex-1 gap-1.5">
                        <span className="text-sm leading-none font-medium">
                            {option.label}
                        </span>
                        {option.description && (
                            <span className="text-xs text-muted-foreground">
                                {option.description}
                            </span>
                        )}
                    </span>
                    <RadioGroupItem
                        id={`${id}-${option.value}`}
                        value={option.value}
                    />
                </label>
            ))}
        </RadioGroup>
    );
}

export { RadioCardGroup, RadioGroup, RadioGroupItem };
