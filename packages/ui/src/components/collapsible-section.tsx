import { ChevronDownIcon } from 'lucide-react';
import { Accordion as AccordionPrimitive } from 'radix-ui';
import * as React from 'react';

import { cn } from '../utils';
import { Accordion, AccordionContent, AccordionItem } from './accordion';

/**
 * A titled section that collapses (a FastTab in Business Central), and keeps a summary of its
 * contents readable while collapsed. `Accordion` gives the animation and multiple-open
 * behaviour; this component owns the header row.
 *
 * Sections are independent — opening one never closes another.
 */
const SectionsContext = React.createContext<{
    open: readonly string[];
    toggle: (value: string) => void;
} | null>(null);

function CollapsibleSectionGroup({
    value,
    defaultValue,
    onValueChange,
    className,
    children,
}: {
    /** Open section values. Pass this to control the group; omit it to let it manage itself. */
    value?: string[];
    defaultValue?: string[];
    onValueChange?: (value: string[]) => void;
    className?: string;
    children: React.ReactNode;
}) {
    const [uncontrolled, setUncontrolled] = React.useState<string[]>(
        defaultValue ?? [],
    );
    const open = value ?? uncontrolled;
    const change = (next: string[]) => {
        if (value === undefined) {
            setUncontrolled(next);
        }

        onValueChange?.(next);
    };
    const toggle = (section: string) =>
        change(
            open.includes(section)
                ? open.filter((item) => item !== section)
                : [...open, section],
        );

    return (
        <SectionsContext.Provider value={{ open, toggle }}>
            <Accordion
                type="multiple"
                value={open}
                onValueChange={change}
                data-slot="collapsible-section-group"
                className={cn('flex w-full min-w-0 flex-col gap-2', className)}
            >
                {children}
            </Accordion>
        </SectionsContext.Provider>
    );
}

function CollapsibleSection({
    value,
    title,
    summary,
    keepMounted = false,
    className,
    children,
}: {
    /** Identifier of this section, unique within its group. */
    value: string;
    title: string;
    /**
     * Key values shown beside the title while the section is collapsed. It is removed from
     * the tree once the section opens rather than hidden with CSS, so a screen reader never
     * reads the same value twice.
     */
    summary?: React.ReactNode;
    /** Preserve form drafts after the section has first been opened. */
    keepMounted?: boolean;
    className?: string;
    children: React.ReactNode;
}) {
    const sections = React.useContext(SectionsContext);
    if (!sections) {
        throw new Error(
            'CollapsibleSection must be inside CollapsibleSectionGroup.',
        );
    }
    const { open, toggle } = sections;
    const isOpen = open.includes(value);
    const [hasOpened, setHasOpened] = React.useState(isOpen);

    if (isOpen && !hasOpened) {
        setHasOpened(true);
    }

    const preserveContent = keepMounted && hasOpened;

    return (
        <AccordionItem
            value={value}
            data-slot="collapsible-section"
            className={cn('w-full min-w-0 border-b-0', className)}
        >
            {/*
        As in Business Central, only the title and the chevron at the far right open or close the
        section, and the line under the header marks where it ends. A whole-row trigger closed
        sections when users clicked beside the title by mistake. The chevron is a mouse target
        only: keyboard users reach the same toggle through the title.
      */}
            <div
                data-slot="collapsible-section-header"
                className="flex min-h-9 w-full min-w-0 items-center gap-3 border-b-2 border-foreground/60 px-3 py-1"
            >
                <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
                    <AccordionPrimitive.Header className="max-w-full min-w-0">
                        <AccordionPrimitive.Trigger
                            data-slot="collapsible-section-trigger"
                            className="cursor-pointer rounded-sm text-left text-lg leading-6 font-semibold [overflow-wrap:anywhere] outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                            {title}
                        </AccordionPrimitive.Trigger>
                    </AccordionPrimitive.Header>
                    {!isOpen && summary != null && (
                        <span className="min-w-0 flex-1 basis-40 truncate text-sm font-normal text-muted-foreground">
                            {summary}
                        </span>
                    )}
                </div>
                <button
                    type="button"
                    tabIndex={-1}
                    aria-label={`${isOpen ? 'Tutup' : 'Buka'} ${title}`}
                    className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => toggle(value)}
                >
                    <ChevronDownIcon
                        className={cn(
                            'size-4 transition-transform duration-200',
                            isOpen && 'rotate-180',
                        )}
                    />
                </button>
            </div>
            {/*
        `pt-3` (not `pt-0`) exists because `Input`'s floating label straddles the top edge
        of the control (`top-0 -translate-y-1/2`, so roughly half its own height sits above
        that edge by design). `AccordionContent`'s wrapper is `overflow-hidden` — required
        for the open/close height animation — so with no top clearance the label's overshoot
        was clipped for any field placed first inside a section. This padding is what gives
        it room; it is not decorative spacing.
      */}
            <AccordionContent
                className="min-w-0 px-3 pt-3 pb-3"
                forceMount={preserveContent ? true : undefined}
                hidden={preserveContent && !isOpen ? true : undefined}
            >
                {children}
            </AccordionContent>
        </AccordionItem>
    );
}

export { CollapsibleSectionGroup, CollapsibleSection };
