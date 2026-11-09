import { CircleAlert } from 'lucide-react';
import * as React from 'react';

import { cn } from '../utils';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

function Card({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="card"
            className={cn(
                'bg-card text-card-foreground flex flex-col gap-3 rounded-md border pb-4 shadow-sm',
                className,
            )}
            {...props}
        />
    );
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="card-header"
            data-command-bar=""
            className={cn(
                '@container/card-header flex min-w-0 flex-wrap items-center gap-2 px-4 py-1.5',
                className,
            )}
            {...props}
        />
    );
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="card-title"
            className={cn('text-sm font-semibold leading-5', className)}
            {...props}
        />
    );
}

function CardDescription({
    className,
    children,
    ...props
}: React.ComponentProps<'button'>) {
    return (
        <Tooltip clickToPin>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    data-slot="card-description"
                    aria-label="Lihat deskripsi"
                    className={cn(
                        'text-muted-foreground hover:text-foreground shrink-0',
                        className,
                    )}
                    {...props}
                >
                    <CircleAlert className="size-4" />
                </button>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-72">
                {children}
            </TooltipContent>
        </Tooltip>
    );
}

function CardAction({
    align = 'start',
    className,
    ...props
}: React.ComponentProps<'div'> & { align?: 'start' | 'end' }) {
    return (
        <div
            data-slot="card-action"
            className={cn(
                'flex min-w-0 flex-wrap items-center gap-1',
                align === 'end' && 'ms-auto',
                className,
            )}
            {...props}
        />
    );
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="card-content"
            className={cn('px-4', className)}
            {...props}
        />
    );
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="card-footer"
            className={cn('[.border-t]:pt-3 flex items-center px-4', className)}
            {...props}
        />
    );
}

export {
    Card,
    CardHeader,
    CardFooter,
    CardTitle,
    CardAction,
    CardDescription,
    CardContent,
};
