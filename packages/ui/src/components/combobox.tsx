import { Combobox as ComboboxPrimitive } from '@base-ui/react';
import { CheckIcon, ChevronDownIcon, SearchIcon, XIcon } from 'lucide-react';
import * as React from 'react';
import {
    DocumentLineCellContext,
    documentLineLabel,
    useDocumentLineCell,
} from '../document-line-context';

import { cn } from '../utils';
import { Button } from './button';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput,
} from './input-group';
import { filterRecordSearchItem } from './record-search';

function Combobox<Value, Multiple extends boolean | undefined = false>({
    filter = filterRecordSearchItem,
    ...props
}: ComboboxPrimitive.Root.Props<Value, Multiple>) {
    return <ComboboxPrimitive.Root {...props} filter={filter} />;
}

function ComboboxValue({ ...props }: ComboboxPrimitive.Value.Props) {
    return <ComboboxPrimitive.Value data-slot="combobox-value" {...props} />;
}

function ComboboxTrigger({
    className,
    children,
    ...props
}: ComboboxPrimitive.Trigger.Props) {
    return (
        <ComboboxPrimitive.Trigger
            data-slot="combobox-trigger"
            className={cn("[&_svg:not([class*='size-'])]:size-4", className)}
            {...props}
        >
            {children}
            <ChevronDownIcon
                data-slot="combobox-trigger-icon"
                className="text-muted-foreground pointer-events-none size-4"
            />
        </ComboboxPrimitive.Trigger>
    );
}

function ComboboxClear({ className, ...props }: ComboboxPrimitive.Clear.Props) {
    return (
        <ComboboxPrimitive.Clear
            data-slot="combobox-clear"
            render={<InputGroupButton variant="ghost" size="icon-xs" />}
            className={cn(className)}
            {...props}
        >
            <XIcon className="pointer-events-none" />
        </ComboboxPrimitive.Clear>
    );
}

function ComboboxInput({
    className,
    children,
    disabled = false,
    showTrigger = true,
    showClear = false,
    showSearchIcon = false,
    label: providedLabel,
    id,
    ...props
}: ComboboxPrimitive.Input.Props & {
    label?: string;
    showTrigger?: boolean;
    showClear?: boolean;
    showSearchIcon?: boolean;
}) {
    const cell = useDocumentLineCell();
    const label = cell && cell.compact !== false ? undefined : providedLabel;
    const generatedId = React.useId();
    const inputId = id ?? (label ? generatedId : undefined);

    return (
        <InputGroup
            className={cn(label || cell ? 'w-full' : 'w-auto', className)}
        >
            {showSearchIcon && (
                <InputGroupAddon>
                    <SearchIcon />
                </InputGroupAddon>
            )}
            <ComboboxPrimitive.Input
                render={
                    <InputGroupInput
                        disabled={disabled}
                        className={label ? 'peer' : undefined}
                    />
                }
                {...props}
                aria-invalid={
                    props['aria-invalid'] ?? (cell?.errorId ? true : undefined)
                }
                aria-describedby={props['aria-describedby'] ?? cell?.errorId}
                aria-label={
                    props['aria-label'] ??
                    documentLineLabel(cell, providedLabel)
                }
                id={inputId}
                placeholder={label ? ' ' : props.placeholder}
            />
            {label && (
                <label
                    htmlFor={inputId}
                    className={cn(
                        'text-foreground dark:bg-input/30 pointer-events-none absolute start-3 top-0 z-10 -translate-y-1/2 bg-white px-1 text-xs leading-none transition-all duration-150 ease-out',
                        'peer-placeholder-shown:top-1/2 peer-placeholder-shown:text-sm',
                        'peer-focus:text-foreground peer-focus:top-0 peer-focus:text-xs',
                        'peer-aria-invalid:text-destructive peer-disabled:opacity-50',
                    )}
                >
                    {label}
                    {props.required && (
                        <span className="text-destructive"> *</span>
                    )}
                </label>
            )}
            <InputGroupAddon align="inline-end">
                {showTrigger && (
                    <InputGroupButton
                        size="icon-xs"
                        variant="ghost"
                        asChild
                        data-slot="input-group-button"
                        className="group-has-data-[slot=combobox-clear]/input-group:hidden data-pressed:bg-transparent"
                        disabled={disabled}
                    >
                        <ComboboxTrigger />
                    </InputGroupButton>
                )}
                {showClear && <ComboboxClear disabled={disabled} />}
            </InputGroupAddon>
            {children}
        </InputGroup>
    );
}

function ComboboxContent({
    className,
    side = 'bottom',
    sideOffset = 6,
    align = 'start',
    alignOffset = 0,
    anchor,
    container,
    children,
    ...props
}: ComboboxPrimitive.Popup.Props &
    Pick<
        ComboboxPrimitive.Positioner.Props,
        'side' | 'align' | 'sideOffset' | 'alignOffset' | 'anchor'
    > & {
        container?: React.ComponentProps<
            typeof ComboboxPrimitive.Portal
        >['container'];
    }) {
    const cell = useDocumentLineCell();

    return (
        <ComboboxPrimitive.Portal
            container={cell?.portalContainer ?? container}
        >
            <ComboboxPrimitive.Positioner
                side={side}
                sideOffset={sideOffset}
                align={align}
                alignOffset={alignOffset}
                anchor={anchor}
                className="isolate z-50"
            >
                <ComboboxPrimitive.Popup
                    data-slot="combobox-content"
                    data-chips={!!anchor}
                    className={cn(
                        'group/combobox-content w-(--anchor-width) max-w-(--available-width) min-w-(--anchor-width) origin-(--transform-origin) data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 relative max-h-96 overflow-hidden rounded-[4px] border border-[#d9dfe7] bg-white text-[#1f2937] shadow-lg duration-100 *:data-[slot=input-group]:m-2 *:data-[slot=input-group]:mb-0 *:data-[slot=input-group]:border-[#d9dfe7] *:data-[slot=input-group]:bg-white *:data-[slot=input-group]:shadow-none',
                        className,
                    )}
                    {...props}
                >
                    <DocumentLineCellContext.Provider value={null}>
                        {children}
                    </DocumentLineCellContext.Provider>
                </ComboboxPrimitive.Popup>
            </ComboboxPrimitive.Positioner>
        </ComboboxPrimitive.Portal>
    );
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
    return (
        <ComboboxPrimitive.List
            data-slot="combobox-list"
            className={cn(
                'data-empty:p-0 max-h-[min(calc(--spacing(96)---spacing(9)),calc(var(--available-height)---spacing(9)))] scroll-py-1 overflow-y-auto p-1',
                className,
            )}
            {...props}
        />
    );
}

function ComboboxItem({
    className,
    children,
    ...props
}: ComboboxPrimitive.Item.Props) {
    return (
        <ComboboxPrimitive.Item
            data-slot="combobox-item"
            className={cn(
                "outline-hidden data-highlighted:bg-accent data-highlighted:text-accent-foreground relative flex w-full cursor-default select-none items-center gap-2 rounded-sm py-1.5 pl-2 pr-8 text-sm data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
                className,
            )}
            {...props}
        >
            {children}
            <ComboboxPrimitive.ItemIndicator
                data-slot="combobox-item-indicator"
                render={
                    <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
                }
            >
                <CheckIcon className="pointer-coarse:size-5 pointer-events-none size-4" />
            </ComboboxPrimitive.ItemIndicator>
        </ComboboxPrimitive.Item>
    );
}

function ComboboxGroup({ className, ...props }: ComboboxPrimitive.Group.Props) {
    return (
        <ComboboxPrimitive.Group
            data-slot="combobox-group"
            className={cn(className)}
            {...props}
        />
    );
}

function ComboboxLabel({
    className,
    ...props
}: ComboboxPrimitive.GroupLabel.Props) {
    return (
        <ComboboxPrimitive.GroupLabel
            data-slot="combobox-label"
            className={cn(
                'text-muted-foreground pointer-coarse:px-3 pointer-coarse:py-2 pointer-coarse:text-sm px-2 py-1.5 text-xs',
                className,
            )}
            {...props}
        />
    );
}

function ComboboxCollection({ ...props }: ComboboxPrimitive.Collection.Props) {
    return (
        <ComboboxPrimitive.Collection
            data-slot="combobox-collection"
            {...props}
        />
    );
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
    return (
        <ComboboxPrimitive.Empty
            data-slot="combobox-empty"
            className={cn(
                'text-muted-foreground group-data-empty/combobox-content:flex hidden w-full justify-center py-2 text-center text-sm',
                className,
            )}
            {...props}
        />
    );
}

function ComboboxSeparator({
    className,
    ...props
}: ComboboxPrimitive.Separator.Props) {
    return (
        <ComboboxPrimitive.Separator
            data-slot="combobox-separator"
            className={cn('bg-border -mx-1 my-1 h-px', className)}
            {...props}
        />
    );
}

function ComboboxChips({
    className,
    ...props
}: React.ComponentPropsWithRef<typeof ComboboxPrimitive.Chips> &
    ComboboxPrimitive.Chips.Props) {
    return (
        <ComboboxPrimitive.Chips
            data-slot="combobox-chips"
            className={cn(
                'border-input shadow-xs focus-within:border-ring focus-within:ring-ring/50 has-aria-invalid:border-destructive has-aria-invalid:ring-[3px] has-aria-invalid:ring-destructive/20 has-data-[slot=combobox-chip]:px-1.5 dark:bg-input/30 dark:has-aria-invalid:border-destructive/50 dark:has-aria-invalid:ring-destructive/40 flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border bg-transparent bg-clip-padding px-2.5 py-1.5 text-sm transition-[color,box-shadow] focus-within:ring-[3px]',
                className,
            )}
            {...props}
        />
    );
}

function ComboboxChip({
    className,
    children,
    showRemove = true,
    ...props
}: ComboboxPrimitive.Chip.Props & {
    showRemove?: boolean;
}) {
    return (
        <ComboboxPrimitive.Chip
            data-slot="combobox-chip"
            className={cn(
                'bg-muted text-foreground has-disabled:pointer-events-none has-disabled:cursor-not-allowed has-disabled:opacity-50 has-data-[slot=combobox-chip-remove]:pr-0 flex h-[calc(--spacing(5.5))] w-fit items-center justify-center gap-1 whitespace-nowrap rounded-sm px-1.5 text-xs font-medium',
                className,
            )}
            {...props}
        >
            {children}
            {showRemove && (
                <ComboboxPrimitive.ChipRemove
                    render={<Button variant="ghost" size="icon-xs" />}
                    className="-ml-1 opacity-50 hover:opacity-100"
                    data-slot="combobox-chip-remove"
                >
                    <XIcon className="pointer-events-none" />
                </ComboboxPrimitive.ChipRemove>
            )}
        </ComboboxPrimitive.Chip>
    );
}

// `children` sengaja tidak diterima: yang dirender adalah sebuah `input`, dan elemen itu
// tidak punya isi. Menyingkirkannya lewat tipe membuat pemanggil yang mengirim isi ditolak
// TypeScript, bukan kehilangan isinya diam-diam.
function ComboboxChipsInput({
    className,
    ...props
}: Omit<ComboboxPrimitive.Input.Props, 'children'>) {
    return (
        <ComboboxPrimitive.Input
            data-slot="combobox-chip-input"
            className={cn('min-w-16 flex-1 outline-none', className)}
            {...props}
        />
    );
}

function useComboboxAnchor() {
    return React.useRef<HTMLDivElement | null>(null);
}

export {
    Combobox,
    ComboboxInput,
    ComboboxContent,
    ComboboxList,
    ComboboxItem,
    ComboboxGroup,
    ComboboxLabel,
    ComboboxCollection,
    ComboboxEmpty,
    ComboboxSeparator,
    ComboboxChips,
    ComboboxChip,
    ComboboxChipsInput,
    ComboboxTrigger,
    ComboboxValue,
    useComboboxAnchor,
};
