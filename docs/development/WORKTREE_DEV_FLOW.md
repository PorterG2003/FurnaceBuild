# Git worktrees: frontend + Supabase without Amplify in the worktree

Use the **main clone** for anything that runs **Amplify** (`npx ampx sandbox`, pipeline deploy, refreshing backend outputs). Use a **worktree** only for branch work, Expo web, and Supabase-backed UI—reuse config from main via symlinks so you do not run Amplify in the worktree.

## Paths on this machine (copy-paste)

| Role | Path |
|------|------|
| Main clone | `/Users/porter/Projects/FurnaceBuild` |
| Example Cursor worktree | `/Users/porter/.cursor/worktrees/FurnaceBuild/bft` |

Other worktrees usually live under `/Users/porter/.cursor/worktrees/FurnaceBuild/<short-name>/`. Use your actual worktree directory in the commands below instead of `bft` if different.

## One-time setup (run inside the worktree root)

```bash
cd /Users/porter/.cursor/worktrees/FurnaceBuild/bft
```

Install dependencies (repeat after `package-lock.json` changes on this branch):

```bash
npm ci
```

Link secrets and Amplify outputs to the **main** clone so the app sees the same Supabase and backend URLs as main:

```bash
ln -sf /Users/porter/Projects/FurnaceBuild/.env.local .env.local
ln -sf /Users/porter/Projects/FurnaceBuild/amplify_outputs.json amplify_outputs.json
```

Confirm:

```bash
ls -la .env.local amplify_outputs.json
```

You should see `-> /Users/porter/Projects/FurnaceBuild/...` for both.

## Day-to-day

From the worktree:

```bash
cd /Users/porter/.cursor/worktrees/FurnaceBuild/bft
npm run web
```

(Use `npm run web -- --port 6000` or your preferred Expo flags as needed.)

**Do not** run `npx ampx sandbox` or other Amplify deploy commands in the worktree if you want to avoid extra stacks, exports, and sandbox complexity. Run those only from:

```bash
cd /Users/porter/Projects/FurnaceBuild
```

After you refresh the backend on **main**, `amplify_outputs.json` updates in main; with the symlink above, the worktree picks it up automatically.

## Optional: per-worktree env without changing main’s `.env.local`

If you ever need different variables only in a worktree, **do not** symlink `.env.local`. Instead copy once and edit the copy:

```bash
cd /Users/porter/.cursor/worktrees/FurnaceBuild/bft
cp /Users/porter/Projects/FurnaceBuild/.env.local .env.local
```

Keep symlinking `amplify_outputs.json` from main unless you intentionally point at another backend.

## Optional: Smartlead / ECS launcher

If you **do** run Amplify from this worktree later and lack `infra/workers` CloudFormation exports, see `AMPLIFY_ENABLE_SMARTLEAD_MIGRATION` in [infra/workers/README.md](../../infra/workers/README.md). Omitting Amplify in the worktree avoids that path entirely.

## Summary

1. **Main:** `/Users/porter/Projects/FurnaceBuild` — Amplify, canonical `.env.local` and `amplify_outputs.json`.
2. **Worktree:** `/Users/porter/.cursor/worktrees/FurnaceBuild/bft` — `npm ci`, symlink those two files, then `npm run web`.
