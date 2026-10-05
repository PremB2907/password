import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import {
  exportResearchCsv,
  exportResearchJson,
  runResearchSuite,
  type ResearchReport,
} from '../research'
import { type VaultBlobV1, vaultBlobV1Schema } from '../vault/schema'
import {
  createNewVault,
  decryptVaultWithMasterPassword,
  recoverVaultWithSharesAndRotateMasterPassword,
  type UnlockedVault,
  upsertEntryAndSave,
} from '../vault/vault'
import { loadVaultBlob, saveVaultBlob, deleteVaultBlob } from '../vault/storage'

const newVaultSchema = z.object({
  masterPassword: z.string().min(8, 'Use at least 8 characters'),
  confirmMasterPassword: z.string().min(8),
  shares: z.coerce.number().int().min(2).max(10),
  threshold: z.coerce.number().int().min(2).max(10),
})

const unlockSchema = z.object({
  masterPassword: z.string().min(1),
})

const recoverSchema = z.object({
  sharesText: z.string().min(1, 'Paste at least one share'),
  newMasterPassword: z.string().min(8, 'Use at least 8 characters'),
})

type ViewMode = 'vault' | 'research'

function parseSharesMultiline(text: string): string[] {
  return text
    .split(/\r?\n/g)
    .map((s) => s.trim())
    .filter(Boolean)
}

function getViewMode(): ViewMode {
  if (typeof window === 'undefined') return 'vault'
  return window.location.pathname.startsWith('/research') ? 'research' : 'vault'
}

function renderStats(value: number): string {
  return `${Number(value).toFixed(3)} ms`
}

function ResearchDashboard() {
  const [report, setReport] = useState<Record<string, ResearchReport> | null>(null)
  const [busy, setBusy] = useState(false)

  async function runSuite() {
    setBusy(true)
    try {
      setReport(await runResearchSuite())
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void runSuite()
  }, [])

  async function copyJson() {
    if (!report) return
    try {
      await navigator.clipboard.writeText(exportResearchJson(report))
    } catch {
      // no-op for unsupported clipboard contexts
    }
  }

  async function copyCsv() {
    if (!report) return
    try {
      await navigator.clipboard.writeText(exportResearchCsv(report))
    } catch {
      // no-op for unsupported clipboard contexts
    }
  }

  return (
    <div className="research-shell">
      <div className="card">
        <div className="row space">
          <div>
            <div className="title">Research dashboard</div>
            <div className="subtitle">
              Production vault functionality remains separate from the experimental benchmark suite.
            </div>
          </div>
          <div className="row">
            <button className="btn primary" onClick={() => void runSuite()} disabled={busy}>
              Run benchmark suite
            </button>
            <button className="btn" onClick={copyJson} disabled={!report || busy}>
              Export JSON
            </button>
            <button className="btn" onClick={copyCsv} disabled={!report || busy}>
              Export CSV
            </button>
          </div>
        </div>
      </div>

      {busy && <div className="card">Running research experiments…</div>}

      {report && (
        <>
          <div className="card">
            <h2>KDF Benchmark</h2>
            <table>
              <thead>
                <tr>
                  <th>Algorithm</th>
                  <th>Parameters</th>
                  <th>Median</th>
                  <th>Samples</th>
                  <th>Std Dev</th>
                </tr>
              </thead>
              <tbody>
                {((report.kdf.metrics.configurations as Array<{ algorithm: string; parameters: Record<string, unknown>; timingsMs: number[]; stats: { mean: number; median: number; stddev: number; samples: number } }>) ?? []).map((row) => (
                  <tr key={`${row.algorithm}-${JSON.stringify(row.parameters)}`}>
                    <td>{row.algorithm}</td>
                    <td>{JSON.stringify(row.parameters)}</td>
                    <td>{renderStats(row.stats.median)}</td>
                    <td>n={row.stats.samples}</td>
                    <td>{renderStats(row.stats.stddev)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>Recovery Benchmark</h2>
            <table>
              <thead>
                <tr>
                  <th>Threshold</th>
                  <th>Total Shares</th>
                  <th>Generation</th>
                  <th>Exact Threshold</th>
                  <th>Exact / Above</th>
                  <th>Insufficient</th>
                </tr>
              </thead>
              <tbody>
                {((report.recovery.metrics.results as Array<{ threshold: number; totalShares: number; generationStats: { median: number }; exactThresholdStats: { median: number }; exactThresholdSuccess: { successes: number; trials: number }; aboveThresholdSuccess: { successes: number }; insufficientShareFailure: { successes: number } }>) ?? []).map((row) => (
                  <tr key={`recovery-${row.threshold}-${row.totalShares}`}>
                    <td>{row.threshold}</td>
                    <td>{row.totalShares}</td>
                    <td>{renderStats(row.generationStats.median)}</td>
                    <td>{renderStats(row.exactThresholdStats.median)}</td>
                    <td>{row.exactThresholdSuccess.successes}/{row.exactThresholdSuccess.trials} / {row.aboveThresholdSuccess.successes}/{row.exactThresholdSuccess.trials}</td>
                    <td>{row.insufficientShareFailure.successes}/{row.exactThresholdSuccess.trials} failed</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>Vault Benchmark</h2>
            <table>
              <thead>
                <tr>
                  <th>Entries</th>
                  <th>Encryption</th>
                  <th>Decryption</th>
                  <th>Vault Size</th>
                </tr>
              </thead>
              <tbody>
                {((report.vault.metrics.results as Array<{ entryCount: number; encryptionStats: { median: number; samples: number }; decryptionStats: { median: number }; serializedVaultSizeBytes: number }>) ?? []).map((row) => (
                  <tr key={`vault-${row.entryCount}`}>
                    <td>{row.entryCount}</td>
                    <td>{renderStats(row.encryptionStats.median)} (n={row.encryptionStats.samples})</td>
                    <td>{renderStats(row.decryptionStats.median)}</td>
                    <td>{row.serializedVaultSizeBytes} B</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>Tamper Tests</h2>
            <table>
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Expected</th>
                  <th>Actual</th>
                  <th>PASS/FAIL</th>
                </tr>
              </thead>
              <tbody>
                {((report.tamper.metrics.tests as Array<{ test: string; expectedResult: string; actualResult: string; pass: boolean; successes: number; trials: number }>) ?? []).map((row) => (
                  <tr key={row.test}>
                    <td>{row.test}</td>
                    <td>{row.expectedResult}</td>
                    <td>{row.actualResult}</td>
                    <td>{row.successes}/{row.trials} ({row.pass ? 'PASS' : 'FAIL'})</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

export function App() {
  const [status, setStatus] = useState<string>('')
  const [blob, setBlob] = useState<VaultBlobV1 | null>(null)
  const [unlocked, setUnlocked] = useState<UnlockedVault | null>(null)
  const [view, setView] = useState<ViewMode>(getViewMode)

  const [newVault, setNewVault] = useState({
    masterPassword: '',
    confirmMasterPassword: '',
    shares: 3,
    threshold: 2,
  })

  const [unlockForm, setUnlockForm] = useState({ masterPassword: '' })
  const [recoverForm, setRecoverForm] = useState({ sharesText: '', newMasterPassword: '' })
  const [newEntry, setNewEntry] = useState({ title: '', username: '', password: '' })

  const hasVault = !!blob

  useEffect(() => {
    ;(async () => {
      const loaded = await loadVaultBlob()
      if (loaded) setBlob(loaded)
    })().catch((e) => setStatus(String(e)))
  }, [])

  useEffect(() => {
    const onPopState = () => setView(getViewMode())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const entries = unlocked?.data.entries ?? []

  const vaultMeta = useMemo(() => {
    if (!blob) return null
    return { version: blob.version, createdAt: new Date(blob.createdAt).toLocaleString() }
  }, [blob])

  async function onCreateVault() {
    setStatus('')
    const parsed = newVaultSchema.safeParse(newVault)
    if (!parsed.success) return setStatus(parsed.error.issues[0]?.message ?? 'Invalid form')
    if (parsed.data.masterPassword !== parsed.data.confirmMasterPassword) {
      return setStatus('Master password confirmation does not match')
    }
    if (parsed.data.threshold > parsed.data.shares) {
      return setStatus('Threshold must be <= number of shares')
    }

    const created = await createNewVault({
      masterPassword: parsed.data.masterPassword,
      shares: parsed.data.shares,
      threshold: parsed.data.threshold,
    })
    await saveVaultBlob(created.blob)
    setBlob(created.blob)
    setUnlocked(created.unlocked)
    setStatus(`Vault created. Save your recovery shares safely:\n\n${created.recoveryShares.join('\n')}`)
  }

  async function onUnlock() {
    setStatus('')
    if (!blob) return
    const parsed = unlockSchema.safeParse(unlockForm)
    if (!parsed.success) return setStatus(parsed.error.issues[0]?.message ?? 'Invalid form')
    try {
      const u = await decryptVaultWithMasterPassword(blob, parsed.data.masterPassword)
      setUnlocked(u)
      setStatus('Unlocked.')
    } catch {
      setStatus('Failed to unlock (wrong password or corrupted vault).')
    }
  }

  async function onRecover() {
    setStatus('')
    if (!blob) return
    const parsed = recoverSchema.safeParse(recoverForm)
    if (!parsed.success) return setStatus(parsed.error.issues[0]?.message ?? 'Invalid form')
    const shares = parseSharesMultiline(parsed.data.sharesText)
    try {
      const res = await recoverVaultWithSharesAndRotateMasterPassword(blob, {
        shares,
        newMasterPassword: parsed.data.newMasterPassword,
      })
      await saveVaultBlob(res.newBlob)
      setBlob(res.newBlob)
      setUnlocked(res.unlocked)
      setStatus('Recovered vault and set a new master password.')
    } catch {
      setStatus('Recovery failed (not enough valid shares or corrupted vault).')
    }
  }

  async function onAddEntry() {
    setStatus('')
    if (!blob || !unlocked) return
    if (!newEntry.title.trim()) return setStatus('Title is required')
    const { newUnlocked, newBlob } = await upsertEntryAndSave(unlocked, blob, {
      title: newEntry.title.trim(),
      username: newEntry.username.trim(),
      password: newEntry.password,
    })
    await saveVaultBlob(newBlob)
    setBlob(newBlob)
    setUnlocked(newUnlocked)
    setNewEntry({ title: '', username: '', password: '' })
    setStatus('Saved.')
  }

  async function onLock() {
    setUnlocked(null)
    setUnlockForm({ masterPassword: '' })
    setStatus('Locked.')
  }

  async function onDeleteAll() {
    await deleteVaultBlob()
    setUnlocked(null)
    setBlob(null)
    setStatus('Deleted local vault.')
  }

  async function onImport() {
    setStatus('')
    const text = prompt('Paste vault JSON')
    if (!text) return
    try {
      const json = JSON.parse(text) as unknown
      const parsed = vaultBlobV1Schema.safeParse(json)
      if (!parsed.success) return setStatus('Invalid vault JSON')
      await saveVaultBlob(parsed.data)
      setBlob(parsed.data)
      setUnlocked(null)
      setStatus('Imported vault.')
    } catch {
      setStatus('Invalid JSON')
    }
  }

  function onExport() {
    if (!blob) return
    navigator.clipboard
      .writeText(JSON.stringify(blob))
      .then(() => setStatus('Copied vault JSON to clipboard.'))
      .catch(() => setStatus('Failed to copy.'))
  }

  function navigateTo(path: string) {
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', path)
    }
    setView(path === '/research' ? 'research' : 'vault')
  }

  return (
    <div className="container">
      <header className="header">
        <div>
          <div className="title">Zero‑Trust Vault</div>
          <div className="subtitle">
            Offline-first, client-side E2EE, threshold recovery, and reproducible research benchmarks.
          </div>
        </div>
        <div className="row nav-row">
          <button className="btn" onClick={() => navigateTo('/')}>
            Vault
          </button>
          <button className="btn" onClick={() => navigateTo('/research')}>
            Research
          </button>
          {view === 'vault' && (
            <>
              <button className="btn" onClick={onImport}>
                Import
              </button>
              <button className="btn" onClick={onExport} disabled={!blob}>
                Export
              </button>
              <button className="btn danger" onClick={onDeleteAll} disabled={!blob && !unlocked}>
                Delete local
              </button>
            </>
          )}
        </div>
      </header>

      {view === 'research' ? (
        <ResearchDashboard />
      ) : (
        <>
          {vaultMeta && (
            <div className="card">
              <div className="meta">
                <div>
                  <strong>Vault:</strong> v{vaultMeta.version} • created {vaultMeta.createdAt}
                </div>
                <div>
                  <strong>Status:</strong> {unlocked ? 'Unlocked' : hasVault ? 'Locked' : 'None'}
                </div>
              </div>
            </div>
          )}

          {!hasVault && (
            <div className="card">
              <h2>Create new vault</h2>
              <div className="grid">
                <label>
                  Master password
                  <input
                    type="password"
                    value={newVault.masterPassword}
                    onChange={(e) => setNewVault((s) => ({ ...s, masterPassword: e.target.value }))}
                  />
                </label>
                <label>
                  Confirm
                  <input
                    type="password"
                    value={newVault.confirmMasterPassword}
                    onChange={(e) =>
                      setNewVault((s) => ({ ...s, confirmMasterPassword: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Shares (n)
                  <input
                    type="number"
                    value={newVault.shares}
                    onChange={(e) => setNewVault((s) => ({ ...s, shares: Number(e.target.value) }))}
                  />
                </label>
                <label>
                  Threshold (k)
                  <input
                    type="number"
                    value={newVault.threshold}
                    onChange={(e) =>
                      setNewVault((s) => ({ ...s, threshold: Number(e.target.value) }))
                    }
                  />
                </label>
              </div>
              <div className="row">
                <button className="btn primary" onClick={onCreateVault}>
                  Create
                </button>
              </div>
              <div className="hint">
                Recovery shares will be shown once. Copy them somewhere safe (e.g., 2 trusted contacts +
                1 device).
              </div>
            </div>
          )}

          {hasVault && !unlocked && (
            <div className="grid2">
              <div className="card">
                <h2>Unlock</h2>
                <label>
                  Master password
                  <input
                    type="password"
                    value={unlockForm.masterPassword}
                    onChange={(e) => setUnlockForm({ masterPassword: e.target.value })}
                  />
                </label>
                <div className="row">
                  <button className="btn primary" onClick={onUnlock}>
                    Unlock
                  </button>
                </div>
              </div>

              <div className="card">
                <h2>Recover (Shamir shares)</h2>
                <label>
                  Paste shares (one per line)
                  <textarea
                    value={recoverForm.sharesText}
                    onChange={(e) => setRecoverForm((s) => ({ ...s, sharesText: e.target.value }))}
                    rows={6}
                  />
                </label>
                <label>
                  New master password
                  <input
                    type="password"
                    value={recoverForm.newMasterPassword}
                    onChange={(e) =>
                      setRecoverForm((s) => ({ ...s, newMasterPassword: e.target.value }))
                    }
                  />
                </label>
                <div className="row">
                  <button className="btn primary" onClick={onRecover}>
                    Recover &amp; set new password
                  </button>
                </div>
              </div>
            </div>
          )}

          {unlocked && blob && (
            <div className="card">
              <div className="row space">
                <h2>Vault entries</h2>
                <button className="btn" onClick={onLock}>
                  Lock
                </button>
              </div>

              <div className="grid">
                <label>
                  Title
                  <input
                    value={newEntry.title}
                    onChange={(e) => setNewEntry((s) => ({ ...s, title: e.target.value }))}
                  />
                </label>
                <label>
                  Username
                  <input
                    value={newEntry.username}
                    onChange={(e) => setNewEntry((s) => ({ ...s, username: e.target.value }))}
                  />
                </label>
                <label>
                  Password
                  <input
                    value={newEntry.password}
                    onChange={(e) => setNewEntry((s) => ({ ...s, password: e.target.value }))}
                  />
                </label>
              </div>
              <div className="row">
                <button className="btn primary" onClick={onAddEntry}>
                  Save entry
                </button>
              </div>

              <div className="list">
                {entries.length === 0 && <div className="hint">No entries yet.</div>}
                {entries.map((e) => (
                  <div key={e.id} className="row entry">
                    <div className="grow">
                      <div className="entryTitle">{e.title}</div>
                      <div className="entryMeta">{e.username}</div>
                    </div>
                    <button
                      className="btn"
                      onClick={() => navigator.clipboard.writeText(e.password)}
                      title="Copies password"
                    >
                      Copy password
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {status && (
        <div className="card status">
          <pre>{status}</pre>
        </div>
      )}
    </div>
  )
}

