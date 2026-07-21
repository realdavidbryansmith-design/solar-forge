# Deploying SolarForge

**Live:** https://realdavidbryansmith-design.github.io/solar-forge/

The app is fully client-side — no backend, no API keys, no database. Any static
host will serve it.

## Redeploy

```bash
npm run deploy
```

That builds and force-pushes `dist/` to the `gh-pages` branch. GitHub Pages
picks it up within a minute or so.

Check it landed:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://realdavidbryansmith-design.github.io/solar-forge/
```

## The base path matters

`vite.config.ts` sets `base` to `/solar-forge/` so assets resolve on a GitHub
Pages *project* site. Deploying anywhere else needs that changed:

```bash
BASE_PATH=/ npm run build        # custom domain, or a site root
BASE_PATH=/solar/ npm run build  # a subfolder named /solar
```

Never hardcode the base into `index.html` — Vite rewrites relative asset paths
against it at build time, and a hardcoded prefix breaks every other target.

## Continuous deployment (not enabled yet)

A GitHub Actions workflow that typechecks, tests, builds and deploys on every
push to `main` is written and ready at `.ci-pending/deploy.yml`. It is not in
the repo because pushing a workflow file needs the `workflow` OAuth scope, and
the current `gh` token has only `gist`, `read:org` and `repo`.

To enable it:

```bash
gh auth refresh -h github.com -s workflow    # opens a browser, ~30 seconds
mkdir -p .github/workflows
cp .ci-pending/deploy.yml .github/workflows/deploy.yml
git add .github && git commit -m "Add CI" && git push
```

Then switch Pages from the branch to Actions as its source:

```bash
gh api -X PUT repos/realdavidbryansmith-design/solar-forge/pages -f build_type=workflow
```

Until then, `npm run deploy` is the deployment path and it works fine.

## Moving to a custom domain

1. Point a CNAME at `realdavidbryansmith-design.github.io`
2. Rebuild with `BASE_PATH=/`
3. Add the domain in the repo's Pages settings (this writes a `CNAME` file, so
   the deploy script must stop clobbering it — add it to `dist/` before pushing)

## Pre-deploy checklist

```bash
npx tsc -b        # NOT `tsc --noEmit` — that skips the project references
npx vitest run
npm run build
```

`tsc --noEmit` and `tsc -b` are not equivalent. The build script uses `-b`, and
it caught three errors that `--noEmit` did not.
