export function depreciationStart(
    date: string,
    convention: string | null,
    fiscalYear: { starts_on: string; ends_on: string } | null = null,
): string {
    const current = new Date(date.slice(0, 10) + 'T00:00:00Z');
    const year = current.getUTCFullYear();
    const month = current.getUTCMonth();
    switch (convention) {
        case 'full_month':
            return new Date(Date.UTC(year, month, 1))
                .toISOString()
                .slice(0, 10);
        case 'mid_month_1st':
            return new Date(
                Date.UTC(year, month + (current.getUTCDate() > 15 ? 1 : 0), 1),
            )
                .toISOString()
                .slice(0, 10);
        case 'mid_month_15th':
            return new Date(Date.UTC(year, month, 15))
                .toISOString()
                .slice(0, 10);
        case 'mid_quarter': {
            const firstMonth = Math.floor(month / 3) * 3;
            const days = new Date(
                Date.UTC(year, firstMonth + 1, 0),
            ).getUTCDate();
            return new Date(
                Date.UTC(year, firstMonth, Math.round((days * 3) / 2)),
            )
                .toISOString()
                .slice(0, 10);
        }
        case 'half_year':
        case 'half_year_start_of_year':
        case 'half_year_next_year': {
            const start = fiscalYear
                ? new Date(fiscalYear.starts_on + 'T00:00:00Z')
                : new Date(Date.UTC(year, 0, 1));
            const end = fiscalYear
                ? new Date(fiscalYear.ends_on + 'T00:00:00Z')
                : new Date(Date.UTC(year, 11, 31));
            const midpoint = new Date(
                start.valueOf() +
                    Math.floor(
                        (end.valueOf() - start.valueOf()) / 86400000 / 2,
                    ) *
                        86400000,
            );
            const firstHalf = current <= midpoint;
            if (convention === 'half_year_start_of_year')
                return (firstHalf ? start : midpoint)
                    .toISOString()
                    .slice(0, 10);
            if (convention === 'half_year_next_year')
                return (firstHalf ? start : new Date(end.valueOf() + 86400000))
                    .toISOString()
                    .slice(0, 10);
            return midpoint.toISOString().slice(0, 10);
        }
        case null:
        default:
            return current.toISOString().slice(0, 10);
    }
}
