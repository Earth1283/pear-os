import { useEffect, useState } from 'react'
import { ArrowDownToLine, Check, ExternalLink, RefreshCw, TriangleAlert } from 'lucide-react'
import type { Win } from '../store'
import { useBackend } from '../lib/backend'
import './SoftwareUpdate.css'

const REPO = 'https://github.com/Earth1283/pear-os'
const API = 'https://api.github.com/repos/Earth1283/pear-os'
const build = __PEAR_BUILD__
type Commit = { sha: string; commit: { message: string } }
type Comparison = {
  status: 'ahead' | 'behind' | 'identical' | 'diverged'
  ahead_by: number
  behind_by: number
  total_commits: number
  commits: Commit[]
  files?: { filename: string; previous_filename?: string }[]
}
type Result = {
  at: number
  kind: 'comparison' | 'unknown' | 'error'
  comparison?: Comparison
  message?: string
  latest?: string
  resetAt?: number
  remaining?: number
}
let cached: Result | null = null
let pending: Promise<Result> | null = null
const skippedPath = (path: string) => path.startsWith('server/') || path.endsWith('.md')
const dateText = (value: string) => {
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? 'Unknown' : time.toLocaleString()
}

async function requestCheck(): Promise<Result> {
  const at = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)
  let remaining: number | undefined
  try {
    const hasSha = /^[a-f0-9]{7,40}$/i.test(build.sha)
    const url = hasSha ? `${API}/compare/${encodeURIComponent(build.sha)}...main?per_page=100&page=1` : `${API}/commits/main`
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/vnd.github+json' }, cache: 'no-cache' })
    const remainingHeader = response.headers.get('x-ratelimit-remaining')
    if (remainingHeader !== null && Number.isFinite(Number(remainingHeader))) remaining = Number(remainingHeader)
    const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000
    const retry = response.headers.get('retry-after')
    const retryAt = retry ? (/^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : Date.parse(retry)) : NaN
    if (response.status === 429 || (response.status === 403 && (remaining === 0 || retry !== null))) {
      const resetAt = Number.isFinite(retryAt) ? retryAt : reset > 0 ? reset : undefined
      return {
        at,
        kind: 'error',
        remaining,
        resetAt,
        message: `GitHub’s rate limit has intervened. Unauthenticated requests normally get 60 checks per hour, shared with other requests from your IP.${resetAt ? ` Try again after ${new Date(resetAt).toLocaleString()}.` : ' GitHub did not provide a retry time.'}`,
      }
    }
    if (hasSha && (response.status === 404 || response.status === 422))
      return {
        at,
        kind: 'unknown',
        remaining,
        message:
          'GitHub could not compare this build revision with main. It may be local, unpublished, or no longer in the repository. No update status can be determined.',
      }
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}. No update status can be determined.`)
    const json = await response.json()
    if (!hasSha)
      return {
        at,
        kind: 'unknown',
        remaining,
        latest: typeof json.sha === 'string' ? json.sha : undefined,
        message: 'This build has no usable Git revision. GitHub was reached, but there is no honest way to count how far behind this build is.',
      }
    if (
      !['ahead', 'behind', 'identical', 'diverged'].includes(json.status) ||
      !Number.isInteger(json.ahead_by) ||
      json.ahead_by < 0 ||
      !Number.isInteger(json.behind_by) ||
      json.behind_by < 0 ||
      !Array.isArray(json.commits) ||
      !json.commits.every((c: Commit) => typeof c.sha === 'string' && typeof c.commit?.message === 'string')
    )
      throw new Error('GitHub returned an unexpected comparison. No update status can be determined.')
    return { at, kind: 'comparison', remaining, comparison: json as Comparison }
  } catch (e) {
    return {
      at,
      kind: 'error',
      remaining,
      message: controller.signal.aborted
        ? 'GitHub took too long to answer. The check timed out; your update status is unknown.'
        : `Couldn’t check for updates. ${e instanceof TypeError ? 'The network or GitHub is unavailable. Your update status is unknown.' : e instanceof Error ? e.message : String(e)}`,
    }
  } finally {
    clearTimeout(timeout)
  }
}

function check(force = false): Promise<Result> {
  if (pending) return pending
  if (cached?.resetAt && cached.resetAt > Date.now()) return Promise.resolve(cached)
  if (cached && !force) return Promise.resolve(cached)
  pending = requestCheck()
    .then((result) => {
      cached = result
      return result
    })
    .finally(() => {
      pending = null
    })
  return pending
}

export function SoftwareUpdate(_: { win: Win }) {
  const [result, setResult] = useState<Result | null>(cached)
  const [checking, setChecking] = useState(!cached)
  const [now, setNow] = useState(Date.now())
  const present = useBackend((s) => s.present)
  useEffect(() => {
    let live = true
    check().then((next) => {
      if (live) {
        setResult(next)
        setChecking(false)
      }
    })
    return () => {
      live = false
    }
  }, [])
  useEffect(() => {
    if (!result?.resetAt || result.resetAt <= Date.now()) return
    const timer = setInterval(() => {
      const time = Date.now()
      setNow(time)
      if (time >= result.resetAt!) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [result?.resetAt])
  const runCheck = async () => {
    setChecking(true)
    const next = await check(true)
    setResult(next)
    setNow(Date.now())
    setChecking(false)
  }
  const comparison = result?.comparison
  const ahead = comparison?.ahead_by ?? 0
  const behind = comparison?.behind_by ?? 0
  const files = comparison?.files
  const ignoredOnly =
    !!files?.length && files.length < 300 && files.every((f) => skippedPath(f.filename) && (!f.previous_filename || skippedPath(f.previous_filename)))
  const pagesCurrent = !present && comparison?.status === 'ahead' && ignoredOnly
  const current = comparison?.status === 'identical'
  const available = comparison?.status === 'ahead' && !pagesCurrent
  const forked = comparison?.status === 'diverged'
  const localAhead = comparison?.status === 'behind'
  const cooldown = !!result?.resetAt && result.resetAt > now
  const title = checking
    ? 'Checking for updates…'
    : current
      ? 'Your Pear is up to date'
      : pagesCurrent
        ? 'Your web UI is up to date'
        : available
          ? `${ahead} ${ahead === 1 ? 'commit' : 'commits'} behind main`
          : forked
            ? 'This build has taken a different path'
            : localAhead
              ? 'This build is ahead of main'
              : result?.kind === 'unknown'
                ? 'Build revision unknown'
                : 'Unable to check for updates'
  const description = checking
    ? 'Asking GitHub. The pause is real; the suspense is complimentary.'
    : current
      ? 'This build’s revision matches main. Enjoy this brief alignment of circumstances.'
      : pagesCurrent
        ? `${ahead} new ${ahead === 1 ? 'commit changes' : 'commits change'} only Markdown or server files. Those paths do not trigger a GitHub Pages deployment. There is no deployed UI update to fetch for these changes.`
        : available
          ? 'Main has newer commits. This update includes bug fixes and new bugs. GitHub does not confirm whether the new build has finished deploying.'
          : forked
            ? `Main has ${ahead} commits absent from this build; this build has ${behind} commits absent from main. Reloading is not a merge strategy.`
            : localAhead
              ? `This build has ${behind} commits absent from main. There are no newer main commits to fetch.`
              : (result?.message ?? 'No check has completed yet.')
  const StatusIcon = current || pagesCurrent ? Check : available ? ArrowDownToLine : RefreshCw
  const showAction = available || forked || result?.kind === 'unknown'

  return (
    <div className="software-update">
      <header className="su-header" data-drag>
        <h1>Software Update</h1>
      </header>
      <div className="su-scroll">
        <div className="su-intro">
          <div className="su-system-icon">
            <RefreshCw size={38} strokeWidth={1.5} />
          </div>
          <h2>PearOS Sequel</h2>
          <p>Updates to the operating system inside your operating system.</p>
        </div>
        {build.dirty && (
          <div className="su-dirty">
            <TriangleAlert size={17} />
            <p>
              You’re running a build with uncommitted changes.
              <br />
              <b>You are the update.</b> Comparisons use the committed revision only.
            </p>
          </div>
        )}
        <section className="su-status" aria-live="polite" aria-busy={checking}>
          <StatusIcon size={23} className={current || pagesCurrent ? 'su-good' : ''} strokeWidth={1.7} />
          <div>
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
        </section>
        <div className="su-actions">
          <button className="btn" onClick={() => void runCheck()} disabled={checking || cooldown}>
            {checking ? 'Checking…' : cooldown ? 'Waiting for GitHub' : 'Check Now'}
          </button>
          {!checking &&
            showAction &&
            (present ? (
              <a className="btn primary" href={`${REPO}/releases/tag/nightly`} target="_blank" rel="noreferrer">
                Get Nightly Release <ExternalLink size={12} />
              </a>
            ) : (
              <button className="btn primary" onClick={() => location.reload()}>
                Update Now
              </button>
            ))}
        </div>
        {!checking && showAction && (
          <p className="su-action-note">
            {present
              ? 'This UI is embedded in pearosd. Download and install a newer binary from the nightly release; reloading cannot update it.'
              : 'Update Now reloads this page. It fetches a newer build if your web host has deployed one. Save open work first; reloading closes this session.'}
          </p>
        )}
        {present && !showAction && !checking && (
          <p className="su-action-note">This UI is embedded in pearosd. Future updates require installing a newer binary.</p>
        )}
        {!!comparison?.commits.length && (
          <details className="su-notes" open={available || forked}>
            <summary>
              {pagesCurrent ? 'Source changes' : 'Release notes'} · {comparison.commits.length} {comparison.commits.length === 1 ? 'commit' : 'commits'} shown
            </summary>
            <p>Actual commit messages. Marketing declined to improve them.</p>
            <ol>
              {comparison.commits.map((commit) => (
                <li key={commit.sha}>
                  <a href={`${REPO}/commit/${encodeURIComponent(commit.sha)}`} target="_blank" rel="noreferrer">
                    <code>{commit.sha.slice(0, 7)}</code>
                  </a>
                  <span>{commit.commit.message}</span>
                </li>
              ))}
            </ol>
            {comparison.commits.length < ahead && (
              <p>
                Showing the first {comparison.commits.length} of {ahead} new commits.{' '}
                <a href={`${REPO}/compare/${encodeURIComponent(build.sha)}...main`} target="_blank" rel="noreferrer">
                  View the full comparison <ExternalLink size={11} />
                </a>
              </p>
            )}
          </details>
        )}
        {!!files?.length && files.length >= 300 && (
          <p className="su-action-note">GitHub caps the changed-file list at 300. This check cannot rule out UI changes beyond that list.</p>
        )}
        {!!comparison && !files?.length && ahead > 0 && (
          <p className="su-action-note">The comparison exposes no changed files. Deployment impact cannot be determined from this response.</p>
        )}
        <dl className="su-build">
          <div>
            <dt>Installed revision</dt>
            <dd>
              {build.sha ? (
                <a href={`${REPO}/commit/${encodeURIComponent(build.sha)}`} target="_blank" rel="noreferrer">
                  <code>{build.sha.slice(0, 12)}</code>
                </a>
              ) : (
                'Unknown'
              )}
              {build.dirty ? ' · modified' : ''}
            </dd>
          </div>
          <div>
            <dt>Revision date</dt>
            <dd>{dateText(build.date)}</dd>
          </div>
          <div>
            <dt>Built</dt>
            <dd>{dateText(build.builtAt)}</dd>
          </div>
          {result?.latest && (
            <div>
              <dt>Latest main revision</dt>
              <dd>
                <code>{result.latest.slice(0, 12)}</code>
              </dd>
            </div>
          )}
          <div>
            <dt>Last checked</dt>
            <dd>{result ? new Date(result.at).toLocaleString() : 'Not yet checked'}</dd>
          </div>
          {result?.remaining !== undefined && (
            <div>
              <dt>GitHub requests remaining</dt>
              <dd>{result.remaining}</dd>
            </div>
          )}
        </dl>
        <p className="su-cache-note">
          Checks are remembered for this page session. Reopening this window won’t ask GitHub again.{' '}
          <a href={REPO} target="_blank" rel="noreferrer">
            View source <ExternalLink size={10} />
          </a>
        </p>
      </div>
    </div>
  )
}
