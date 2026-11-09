import { $ } from 'bun';
import { relative, resolve, sep } from 'node:path';

type Worktree = { path: string; branch: string | null };
type Verdict =
    { kind: 'remove'; branch: string } | { kind: 'keep'; reason: string };
type PullRequest = {
    number: number;
    state: 'OPEN' | 'CLOSED' | 'MERGED';
    headRefOid: string;
};

const dryRun = process.argv.includes('--dry-run');

function parse(porcelain: string): Worktree[] {
    return porcelain
        .trim()
        .split(/\n\n+/)
        .map((block) => {
            const lines = block.split('\n');
            const path =
                lines
                    .find((line) => line.startsWith('worktree '))
                    ?.slice('worktree '.length) ?? '';
            const ref = lines
                .find((line) => line.startsWith('branch '))
                ?.slice('branch '.length);
            return {
                path,
                branch: ref ? ref.replace('refs/heads/', '') : null,
            };
        });
}

async function verdict(worktree: Worktree): Promise<Verdict> {
    if (worktree.branch === null) {
        return { kind: 'keep', reason: 'tidak sedang di branch mana pun' };
    }
    const dirty = await $`git -C ${worktree.path} status --porcelain`.text();
    if (dirty.trim() !== '') {
        return {
            kind: 'keep',
            reason: 'masih ada perubahan yang belum di-commit',
        };
    }
    const pulls: PullRequest[] =
        await $`gh pr list --head ${worktree.branch} --state all --json number,state,headRefOid --limit 1`.json();
    const pull = pulls[0];
    if (pull === undefined) {
        return { kind: 'keep', reason: 'belum ada PR' };
    }
    switch (pull.state) {
        case 'OPEN':
            return { kind: 'keep', reason: `PR #${pull.number} masih terbuka` };
        case 'MERGED':
        case 'CLOSED': {
            // Dibandingkan dengan commit terakhir PR, bukan upstream: upstream bisa hilang saat branch remote
            // dihapus sesudah merge, dan branch dari origin/main melacak main, bukan dirinya sendiri.
            const head = await $`git -C ${worktree.path} rev-parse HEAD`.text();
            if (head.trim() !== pull.headRefOid) {
                return {
                    kind: 'keep',
                    reason: `ada commit sesudah PR #${pull.number}`,
                };
            }
            return { kind: 'remove', branch: worktree.branch };
        }
        default: {
            const unknown: never = pull.state;
            throw new Error(`Status PR tidak dikenal: ${unknown}`);
        }
    }
}

const worktrees = parse(await $`git worktree list --porcelain`.text());
const [main, ...others] = worktrees;
if (main === undefined) {
    throw new Error('git worktree list tidak memulangkan apa pun.');
}
const root = resolve(main.path, '.worktrees') + sep;

for (const worktree of others) {
    if (!resolve(worktree.path).startsWith(root)) {
        continue;
    }
    const name = relative(main.path, worktree.path);
    const result = await verdict(worktree);
    switch (result.kind) {
        case 'keep':
            console.log(`tetap    ${name}: ${result.reason}`);
            break;
        case 'remove':
            if (dryRun) {
                console.log(`dihapus  ${name} (dry run, tidak diubah)`);
                break;
            }
            await $`git worktree remove ${worktree.path}`;
            await $`git branch -D ${result.branch}`.quiet();
            console.log(`dihapus  ${name} dan branch ${result.branch}`);
            break;
        default: {
            const unknown: never = result;
            throw new Error(
                `Keputusan tidak dikenal: ${JSON.stringify(unknown)}`,
            );
        }
    }
}
await $`git worktree prune`;
