import {
    Alert,
    AlertDescription,
    AlertTitle,
} from '@operations-metta/ui/alert';
import { Button } from '@operations-metta/ui/button';
import {
    displayNumber,
    parseDisplayNumber,
} from '@operations-metta/ui/display-number';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { useSuspenseQuery } from '@tanstack/react-query';
import { CircleCheck, CircleDot, Info } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    definePage,
    errorText,
    FormErrorHeader,
    orpc,
    PasswordInput,
} from '../../../platform/shell/index.ts';
import { ClerkResult, dateTime, type Clerk } from './clerk-result.tsx';

// Clerk kasir yang sedang masuk: Clerk Start bila belum ada clerk berjalan, Clerk End bila ada (layar Buat Clerk Baru dan
// Lihat Clerk sistem lama). Clerk End diisi buta seperti sistem lama: jumlah sistem baru tampil sesudah Clerk End.

const startText =
    'Anda harus memulai Clerk sebelum melakukan transaksi. Setelah proses Clerk Start dimulai, maka Anda dapat melakukan transaksi.';
const endText =
    'Clerk juga merupakan proses penyetoran hasil transaksi akhir. Disini Anda dapat melakukan pencocokan jumlah total transaksi fisik dengan jumlah total transaksi sistem. Setelah Anda melakukan proses Clerk End, maka Anda tidak dapat melakukan transaksi lainnya.';

type Errors = Record<string, string[]>;

function PasswordField({
    value,
    error,
    onChange,
}: {
    value: string;
    error: string | undefined;
    onChange: (value: string) => void;
}): ReactNode {
    return (
        <FormControl error={error}>
            <PasswordInput
                label="Password"
                required
                autoComplete="current-password"
                placeholder="Masukan Password Anda disini..."
                data-error-field="password"
                value={value}
                onChange={(event) => onChange(event.target.value)}
            />
        </FormControl>
    );
}

function ClerkStart({
    passwordRequired,
    canOperate,
    onStarted,
}: {
    passwordRequired: boolean;
    canOperate: boolean;
    onStarted: () => Promise<unknown>;
}): ReactNode {
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const start = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body } = await api.billingClerkStart({
                body: passwordRequired ? { password } : {},
            });
            toast.success(body.message);
            await onStarted();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Clerk belum dimulai.'));
        } finally {
            setBusy(false);
        }
    };
    return (
        <form
            noValidate
            className="max-w-xl space-y-4"
            onSubmit={(event) => {
                event.preventDefault();
                void start();
            }}
        >
            <FormErrorHeader
                errors={errors}
                message={message}
                operation="Clerk belum dimulai"
            />
            <Alert>
                <Info aria-hidden="true" />
                <AlertTitle>Info</AlertTitle>
                <AlertDescription>{startText}</AlertDescription>
            </Alert>
            {canOperate && (
                <>
                    {passwordRequired && (
                        <PasswordField
                            value={password}
                            error={errors.password?.[0]}
                            onChange={setPassword}
                        />
                    )}
                    <Button
                        type="submit"
                        data-action="save"
                        disabled={busy}
                        className="w-full"
                    >
                        <CircleDot aria-hidden="true" />
                        Clerk Start
                    </Button>
                </>
            )}
        </form>
    );
}

function ClerkEnd({
    clerk,
    passwordRequired,
    canOperate,
    onEnded,
}: {
    clerk: Clerk;
    passwordRequired: boolean;
    canOperate: boolean;
    onEnded: (clerk: Clerk) => void;
}): ReactNode {
    const [counts, setCounts] = useState<Record<string, string>>({});
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const amounts = Object.fromEntries(
        clerk.lines.map((line) => {
            const typed = counts[line.payment_method_id]?.trim() ?? '';
            return [
                line.payment_method_id,
                typed ? (parseDisplayNumber(typed) ?? typed) : '0',
            ];
        }),
    );
    // Total tampilan dalam sen, supaya penjumlahan desimal tidak bergeser; angka yang tidak terbaca membuatnya kosong.
    const cents = Object.values(amounts).reduce<number | null>(
        (sum, value) =>
            sum === null || !Number.isFinite(Number(value))
                ? null
                : sum + Math.round(Number(value) * 100),
        0,
    );
    const end = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body } = await api.billingClerkEnd({
                params: { id: clerk.id },
                body: {
                    counts: amounts,
                    version: clerk.version,
                    ...(passwordRequired ? { password } : {}),
                },
            });
            toast.success(body.message);
            onEnded(body.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Clerk belum diakhiri.'));
        } finally {
            setBusy(false);
        }
    };
    return (
        <form
            noValidate
            className="max-w-3xl space-y-4"
            onSubmit={(event) => {
                event.preventDefault();
                void end();
            }}
        >
            <FormErrorHeader
                errors={errors}
                message={message}
                operation="Clerk belum diakhiri"
            />
            <Alert>
                <CircleCheck aria-hidden="true" />
                <AlertTitle>Proses Clerk Start sudah dilakukan</AlertTitle>
                <AlertDescription>
                    Anda bisa melakukan transaksi.
                </AlertDescription>
            </Alert>
            <Alert>
                <Info aria-hidden="true" />
                <AlertTitle>Info</AlertTitle>
                <AlertDescription>{endText}</AlertDescription>
            </Alert>
            <FormGrid>
                <FormControl>
                    <Input label="Kode" value={clerk.code} readOnly />
                </FormControl>
                <FormControl>
                    <Input
                        label="Mulai"
                        value={dateTime(clerk.started_at)}
                        readOnly
                    />
                </FormControl>
            </FormGrid>
            {canOperate && clerk.mine && (
                <>
                    <h2 className="text-sm font-semibold">Jumlah Clerk</h2>
                    <FormGrid>
                        {clerk.lines.map((line) => {
                            const field = `counts.${line.payment_method_id}`;
                            return (
                                <FormControl
                                    key={line.payment_method_id}
                                    error={errors[field]?.[0]}
                                    hint="Jumlah fisik yang ada di laci atau di slip, bukan jumlah sistem."
                                >
                                    <Input
                                        label={line.name}
                                        inputMode="decimal"
                                        placeholder="0"
                                        data-error-field={field}
                                        value={
                                            counts[line.payment_method_id] ?? ''
                                        }
                                        onChange={(event) =>
                                            setCounts({
                                                ...counts,
                                                [line.payment_method_id]:
                                                    event.target.value,
                                            })
                                        }
                                    />
                                </FormControl>
                            );
                        })}
                        <FormControl
                            hint={
                                clerk.lines.length
                                    ? undefined
                                    : 'Belum ada jenis bayar yang ditandai Dihitung saat Clerk End.'
                            }
                        >
                            <Input
                                label="Total"
                                value={
                                    cents === null
                                        ? ''
                                        : displayNumber(
                                              (cents / 100)
                                                  .toFixed(2)
                                                  .replace(/\.?0+$/, ''),
                                          )
                                }
                                readOnly
                            />
                        </FormControl>
                    </FormGrid>
                    {passwordRequired && (
                        <PasswordField
                            value={password}
                            error={errors.password?.[0]}
                            onChange={setPassword}
                        />
                    )}
                    <Button
                        type="submit"
                        data-action="save"
                        variant="destructive"
                        disabled={busy}
                        className="w-full"
                    >
                        <CircleDot aria-hidden="true" />
                        Clerk End
                    </Button>
                </>
            )}
        </form>
    );
}

function ClerkPage(): ReactNode {
    const current = useSuspenseQuery(
        orpc.billingClerkCurrent.queryOptions({
            select: (response) => response.body,
            refetchOnWindowFocus: false,
        }),
    );
    const [ended, setEnded] = useState<Clerk | null>(null);
    const { data, password_required, can_operate } = current.data;
    return (
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
            <RecordActionBar
                title={
                    ended ? 'Lihat Clerk' : data ? 'Clerk End' : 'Clerk Start'
                }
            />
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
                {ended ? (
                    <div className="max-w-4xl space-y-4">
                        <Alert>
                            <CircleCheck aria-hidden="true" />
                            <AlertTitle>
                                Proses Clerk End sudah dilakukan
                            </AlertTitle>
                        </Alert>
                        <ClerkResult clerk={ended} />
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setEnded(null)}
                        >
                            Selesai
                        </Button>
                    </div>
                ) : data ? (
                    <ClerkEnd
                        key={`${data.id}:${data.version}`}
                        clerk={data}
                        passwordRequired={password_required}
                        canOperate={can_operate}
                        onEnded={(clerk) => {
                            setEnded(clerk);
                            void current.refetch();
                        }}
                    />
                ) : (
                    <ClerkStart
                        passwordRequired={password_required}
                        canOperate={can_operate}
                        onStarted={() => current.refetch()}
                    />
                )}
            </div>
        </div>
    );
}

export const page = definePage({
    path: '/billing/clerk',
    layout: 'app',
    title: 'Clerk',
    component: ClerkPage,
});
