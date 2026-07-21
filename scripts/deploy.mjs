/**
 * Publish dist/ to the gh-pages branch.
 *
 * Uses a throwaway git repo in a temp directory rather than touching the
 * working tree, so an interrupted deploy can never leave the source repo on the
 * wrong branch or with a dirty index.
 *
 * Assumes `npm run verify` already ran — the `deploy` script chains them.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, cpSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REMOTE = 'https://github.com/realdavidbryansmith-design/solar-forge.git'
const BRANCH = 'gh-pages'

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim()

if (!existsSync('dist/index.html')) {
  console.error('dist/index.html is missing — run `npm run build` first.')
  process.exit(1)
}

const sha = run('git', ['rev-parse', '--short', 'HEAD'], process.cwd())
const dirty = run('git', ['status', '--porcelain'], process.cwd())
if (dirty) {
  console.warn('! Working tree has uncommitted changes; deploying them anyway.')
}

const staging = mkdtempSync(join(tmpdir(), 'solarforge-deploy-'))
try {
  cpSync('dist', staging, { recursive: true })
  // Stop GitHub Pages running the output through Jekyll, which would drop any
  // file or directory beginning with an underscore.
  writeFileSync(join(staging, '.nojekyll'), '')

  run('git', ['init', '-q'], staging)
  run('git', ['checkout', '-qb', BRANCH], staging)
  run('git', ['add', '-A'], staging)
  run(
    'git',
    ['-c', 'user.name=deploy', '-c', 'user.email=deploy@local', 'commit', '-q', '-m', `Deploy ${sha}`],
    staging,
  )
  run('git', ['remote', 'add', 'origin', REMOTE], staging)
  run('git', ['push', '-qf', 'origin', BRANCH], staging)

  console.log(`Deployed ${sha} to ${BRANCH}.`)
  console.log('https://realdavidbryansmith-design.github.io/solar-forge/')
} finally {
  rmSync(staging, { recursive: true, force: true })
}
