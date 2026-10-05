import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportResearchJson, runResearchSuite } from '../src/research/index.ts'

const repetitions = Number(process.env.RESEARCH_REPETITIONS ?? 30)
const warmups = Number(process.env.RESEARCH_WARMUPS ?? 3)
const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const vaultRoot = resolve(scriptDirectory, '..')
const repositoryRoot = resolve(vaultRoot, '..')
const resultRoot = join(repositoryRoot, 'research', 'results')
const rawRoot = join(resultRoot, 'raw')
const processedRoot = join(resultRoot, 'processed')
const startedAt = new Date().toISOString()
const runId = startedAt.replace(/[:.]/g, '-')
const packageJson = JSON.parse(readFileSync(join(vaultRoot, 'package.json'), 'utf8')) as { version: string }
const osRelease = readFileSync('/etc/os-release', 'utf8')
const distribution = osRelease.match(/^PRETTY_NAME="?([^"\n]+)"?/m)?.[1] ?? `${os.type()} ${os.release()}`
const git = (args: string[]) => execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim()
const sourceFiles = [
  'vault/src/research/index.ts',
  'vault/src/vault/crypto.ts',
  'vault/src/vault/vault.ts',
  'vault/package.json',
  'vault/package-lock.json',
  'vault/scripts/run-research.mts',
]
const sourceHash = createHash('sha256')
for (const path of sourceFiles) {
  sourceHash.update(path)
  sourceHash.update('\0')
  sourceHash.update(readFileSync(join(repositoryRoot, path)))
}
const sourceFingerprint = sourceHash.digest('hex')
const gitHead = git(['rev-parse', 'HEAD'])
const gitStatus = execFileSync('git', ['status', '--porcelain'], { cwd: repositoryRoot, encoding: 'utf8' })
const dirtyPaths = gitStatus.trimEnd().split('\n').filter(Boolean).map((line) => line.slice(3))

const environment = {
  operatingSystem: distribution,
  kernel: `${os.type()} ${os.release()}`,
  architecture: os.arch(),
  cpu: os.cpus()[0]?.model ?? 'unknown',
  logicalCpuCount: os.cpus().length,
  memoryTotalBytes: os.totalmem(),
  memoryAvailableAtRunStartBytes: os.freemem(),
  nodeVersion: process.version,
  opensslVersion: process.versions.openssl ?? 'unknown',
  applicationVersion: packageJson.version,
  browser: {
    usedForMeasurement: false,
    observedUserAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Code/1.139.1 Chrome/150.0.7871.250 Electron/43.6.0 Safari/537.36',
    chromeVersion: '150.0.7871.250',
    electronVersion: '43.6.0',
    vscodeVersion: '1.139.1',
  },
  measurementRuntime: 'Node.js global WebCrypto and hash-wasm Argon2id; browser is recorded as host context only',
  gitHead,
  gitWorkingTreeDirty: dirtyPaths.length > 0,
  gitDirtyPaths: dirtyPaths,
  benchmarkSourceSha256: sourceFingerprint,
  benchmarkSourceFiles: sourceFiles,
}

console.log(`Starting research run ${runId}: ${repetitions} samples/configuration, ${warmups} KDF/vault warm-ups`)
const experiments = await runResearchSuite({ repetitions, warmups })
const document = {
  schemaVersion: 2,
  run: {
    id: runId,
    startedAt,
    completedAt: new Date().toISOString(),
    repetitions,
    warmups,
    statisticalMethods: {
      standardDeviation: 'sample standard deviation (n - 1)',
      meanConfidenceInterval: 'two-sided 95% Student t interval using Cornish-Fisher approximation',
      medianConfidenceInterval: 'deterministic percentile bootstrap, 2000 resamples',
      binaryConfidenceInterval: 'two-sided 95% Wilson score interval',
    },
  },
  environment,
  experiments,
}

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

const csvRows: unknown[][] = [['runId', 'experiment', 'configuration', 'repetition', 'measurement', 'value', 'unit', 'outcome']]
const kdfConfigurations = experiments.kdf.metrics.configurations as Array<{
  algorithm: string
  parameters: Record<string, unknown>
  warmupTimingsMs: number[]
  timingsMs: number[]
}>
for (const configuration of kdfConfigurations) {
  const name = `${configuration.algorithm} ${JSON.stringify(configuration.parameters)}`
  configuration.warmupTimingsMs.forEach((value, index) => csvRows.push([runId, 'kdf', name, index + 1, 'warmup', value, 'ms', 'excluded']))
  configuration.timingsMs.forEach((value, index) => csvRows.push([runId, 'kdf', name, index + 1, 'derivation', value, 'ms', 'measured']))
}
const recoveryRows = experiments.recovery.metrics.results as Array<{
  threshold: number
  totalShares: number
  samples: Array<Record<string, unknown>>
}>
for (const configuration of recoveryRows) {
  for (const sample of configuration.samples) {
    const name = `${configuration.threshold}-of-${configuration.totalShares}`
    const repetition = sample.repetition
    for (const measurement of ['generationMs', 'exactThresholdMs', 'aboveThresholdMs', 'insufficientMs']) {
      csvRows.push([runId, 'shamir', name, repetition, measurement, sample[measurement], 'ms', 'measured'])
    }
    for (const outcome of ['exactThresholdSuccess', 'aboveThresholdSuccess', 'insufficientShareFailure']) {
      csvRows.push([runId, 'shamir', name, repetition, outcome, sample[outcome], 'boolean', 'measured'])
    }
  }
}
const vaultRows = experiments.vault.metrics.results as Array<{
  entryCount: number
  samples: Array<Record<string, unknown>>
}>
for (const configuration of vaultRows) {
  for (const sample of configuration.samples) {
    csvRows.push([runId, 'vault', configuration.entryCount, sample.repetition, 'encryption', sample.encryptionTimeMs, 'ms', 'measured'])
    csvRows.push([runId, 'vault', configuration.entryCount, sample.repetition, 'decryption', sample.decryptionTimeMs, 'ms', 'measured'])
  }
}
const tamperRows = experiments.tamper.metrics.tests as Array<{
  test: string
  samples: boolean[]
}>
for (const test of tamperRows) {
  test.samples.forEach((passed, index) => csvRows.push([runId, 'tamper', test.test, index + 1, 'detection', passed, 'boolean', 'measured']))
}
const offline = experiments.offline.metrics
;(offline.timingsMs as number[]).forEach((value, index) => csvRows.push([runId, 'offline-simulation', 'synthetic wrong-password', index + 1, 'derivation-and-rejection', value, 'ms', 'measured']))
for (const [name, value] of Object.entries(experiments.rotation.metrics)) {
  csvRows.push([runId, 'key-rotation', 'recovery and rewrap', '', name, value, 'boolean', 'measured'])
}
const csv = csvRows.map((row) => row.map(csvCell).join(',')).join('\n')
const summary = {
  schemaVersion: 2,
  run: document.run,
  environment,
  summary: Object.fromEntries(Object.entries(experiments).map(([name, experiment]) => [name, experiment.metrics])),
}

mkdirSync(rawRoot, { recursive: true })
mkdirSync(processedRoot, { recursive: true })
const rawJsonPath = join(rawRoot, `research-run-${runId}.json`)
const rawCsvPath = join(rawRoot, `research-run-${runId}.csv`)
const summaryPath = join(processedRoot, `summary-${runId}.json`)
writeFileSync(rawJsonPath, exportResearchJson(document as never), { encoding: 'utf8', flag: 'wx' })
writeFileSync(rawCsvPath, csv, { encoding: 'utf8', flag: 'wx' })
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
console.log(JSON.stringify({ rawJsonPath, rawCsvPath, summaryPath, sourceFingerprint, gitHead }, null, 2))
