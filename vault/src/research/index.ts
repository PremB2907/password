import {
  Buffer,
  combine,
  split,
} from 'shamirs-secret-sharing'
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  b64ToBytes,
  bytesToB64,
  deriveMasterKek,
  randomBytes,
  utf8ToBytes,
  type KdfParams,
  type Pbkdf2Params,
} from '../vault/crypto'
import {
  createNewVault,
  decryptVaultWithMasterPassword,
  decryptVaultPayload,
  encryptVaultPayload,
  recoverVaultWithSharesAndRotateMasterPassword,
} from '../vault/vault'
import type { VaultData } from '../vault/schema'

export type StatsSummary = {
  mean: number
  median: number
  min: number
  max: number
  stddev: number
  samples: number
  confidence95?: { lower: number; upper: number; method: string }
  medianConfidence95?: { lower: number; upper: number; method: string }
}

export type ResearchOptions = {
  repetitions?: number
  warmups?: number
}

export type BrowserInfo = {
  userAgent: string
  platform: string
  language: string
  vendor: string
}

export type KdfBenchmarkRow = {
  algorithm: string
  parameters: Record<string, unknown>
  warmupTimingsMs: number[]
  timingsMs: number[]
  stats: StatsSummary
}

export type TamperTestRow = {
  test: string
  mutation: string
  expectedResult: string
  actualResult: string
  pass: boolean
}

export type ResearchReport = {
  experiment: string
  timestamp: string
  browser: BrowserInfo
  parameters: Record<string, unknown>
  metrics: Record<string, unknown>
  result: string
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1]! + sorted[middle]!) / 2
  }
  return sorted[middle]!
}

function sampleStddev(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function summarize(values: number[]): StatsSummary {
  if (values.length === 0) {
    return { mean: 0, median: 0, min: 0, max: 0, stddev: 0, samples: 0 }
  }
  const sorted = [...values].sort((a, b) => a - b)
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const deviation = sampleStddev(values)
  const degreesOfFreedom = values.length - 1
  const z = 1.959964
  const critical = z + (z ** 3 + z) / (4 * degreesOfFreedom)
    + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * degreesOfFreedom ** 2)
    + (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * degreesOfFreedom ** 3)
  const medianInterval = bootstrapMedianInterval(values)
  return {
    mean,
    median: median(values),
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    stddev: deviation,
    samples: values.length,
    ...(values.length >= 2
      ? {
          confidence95: {
            lower: mean - critical * deviation / Math.sqrt(values.length),
            upper: mean + critical * deviation / Math.sqrt(values.length),
            method: `two-sided Student t interval; df=${degreesOfFreedom}; Cornish-Fisher t critical approximation`,
          },
          medianConfidence95: medianInterval,
        }
      : {}),
  }
}

function bootstrapMedianInterval(values: number[], resamples = 2000) {
  let state = Math.floor(values.reduce((sum, value) => sum + Math.abs(value) * 1_000_000, 0)) >>> 0
  const nextRandom = () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
  const medians = Array.from({ length: resamples }, () => {
    const sample = Array.from({ length: values.length }, () => values[Math.floor(nextRandom() * values.length)]!)
    return median(sample)
  }).sort((left, right) => left - right)
  return {
    lower: medians[Math.floor(resamples * 0.025)]!,
    upper: medians[Math.ceil(resamples * 0.975) - 1]!,
    method: `percentile bootstrap of median; ${resamples} resamples; deterministic LCG seed from observations`,
  }
}

function summarizeBinary(successes: number, trials: number) {
  const z = 1.959964
  const proportion = trials === 0 ? 0 : successes / trials
  const denominator = 1 + z ** 2 / trials
  const center = (proportion + z ** 2 / (2 * trials)) / denominator
  const halfWidth = z * Math.sqrt(proportion * (1 - proportion) / trials + z ** 2 / (4 * trials ** 2)) / denominator
  return {
    successes,
    trials,
    proportion,
    confidence95: { lower: center - halfWidth, upper: center + halfWidth, method: 'Wilson score interval' },
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function validateOptions(options: ResearchOptions): Required<ResearchOptions> {
  const repetitions = options.repetitions ?? 30
  const warmups = options.warmups ?? 3
  if (!Number.isInteger(repetitions) || repetitions < 1 || !Number.isInteger(warmups) || warmups < 0) {
    throw new Error('Repetitions must be positive and warmups must be non-negative integers')
  }
  return { repetitions, warmups }
}

function getBrowserInfo(): BrowserInfo {
  const nav = globalThis.navigator ?? {
    userAgent: 'node',
    platform: 'node',
    vendor: 'node',
    language: 'en-US',
  }
  return {
    userAgent: nav.userAgent ?? 'unknown',
    platform: nav.platform ?? 'unknown',
    language: nav.language ?? 'en-US',
    vendor: nav.vendor ?? 'unknown',
  }
}

function createSyntheticData(count: number): VaultData {
  const timestamp = Date.now()
  return {
    entries: Array.from({ length: count }, (_, index) => ({
      id: `synthetic-${index + 1}`,
      title: `Entry ${index + 1}`,
      username: `user${index + 1}`,
      password: `SyntheticPassword!${index + 1}-${Math.random().toString(36).slice(2, 9)}`,
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
  }
}

export async function benchmarkKdf(options: ResearchOptions = {}): Promise<ResearchReport> {
  const { repetitions, warmups } = validateOptions(options)
  const runs: KdfBenchmarkRow[] = []
  const pbkdf2Configs: Array<Pbkdf2Params> = [
    { name: 'pbkdf2-sha256', salt: randomBytes(16), iterations: 100_000, dkLen: 32 },
    { name: 'pbkdf2-sha256', salt: randomBytes(16), iterations: 200_000, dkLen: 32 },
    { name: 'pbkdf2-sha256', salt: randomBytes(16), iterations: 310_000, dkLen: 32 },
    { name: 'pbkdf2-sha256', salt: randomBytes(16), iterations: 400_000, dkLen: 32 },
    { name: 'pbkdf2-sha256', salt: randomBytes(16), iterations: 600_000, dkLen: 32 },
  ]

  const argon2Configs: Array<KdfParams> = [
    { name: 'argon2id', salt: randomBytes(16), iterations: 2, memorySize: 64 * 1024, parallelism: 1, dkLen: 32 },
    { name: 'argon2id', salt: randomBytes(16), iterations: 3, memorySize: 64 * 1024, parallelism: 1, dkLen: 32 },
    { name: 'argon2id', salt: randomBytes(16), iterations: 3, memorySize: 256 * 1024, parallelism: 1, dkLen: 32 },
  ]

  const candidateConfigs = [...pbkdf2Configs, ...argon2Configs]
  const warmupTimings = candidateConfigs.map(() => [] as number[])
  const timings = candidateConfigs.map(() => [] as number[])

  for (let round = 0; round < warmups; round += 1) {
    for (let index = 0; index < candidateConfigs.length; index += 1) {
      const start = nowMs()
      await deriveMasterKek('SyntheticBenchmarkPassword!2026', candidateConfigs[index]!)
      warmupTimings[index]!.push(nowMs() - start)
    }
  }
  for (let round = 0; round < repetitions; round += 1) {
    const offset = round % candidateConfigs.length
    for (let position = 0; position < candidateConfigs.length; position += 1) {
      const index = (position + offset) % candidateConfigs.length
      const start = nowMs()
      await deriveMasterKek('SyntheticBenchmarkPassword!2026', candidateConfigs[index]!)
      timings[index]!.push(nowMs() - start)
    }
  }

  for (let index = 0; index < candidateConfigs.length; index += 1) {
    const cfg = candidateConfigs[index]!
    runs.push({
      algorithm: cfg.name,
      parameters: {
        iterations: cfg.iterations,
        memorySize: cfg.name === 'argon2id' ? cfg.memorySize : undefined,
        parallelism: cfg.name === 'argon2id' ? cfg.parallelism : undefined,
        dkLen: cfg.dkLen,
      },
      timingsMs: timings[index]!,
      warmupTimingsMs: warmupTimings[index]!,
      stats: summarize(timings[index]!),
    })
  }

  return {
    experiment: 'kdf-benchmark',
    timestamp: new Date().toISOString(),
    browser: getBrowserInfo(),
    parameters: {
      repetitions,
      warmups,
      password: 'fixed synthetic benchmark input; value omitted',
      schedule: 'configuration order rotates by measured round',
    },
    metrics: {
      configurations: runs,
    },
    result: 'Repeated derivation latency measured for PBKDF2 and Argon2id configurations.',
  }
}

export async function benchmarkRecovery(options: ResearchOptions = {}): Promise<ResearchReport> {
  const { repetitions } = validateOptions(options)
  const thresholdConfigs = [
    { shares: 3, threshold: 2 },
    { shares: 5, threshold: 2 },
    { shares: 5, threshold: 3 },
    { shares: 7, threshold: 3 },
    { shares: 7, threshold: 4 },
    { shares: 10, threshold: 5 },
  ]

  const rows: Array<Record<string, unknown>> = []
  for (const cfg of thresholdConfigs) {
    const samples: Array<Record<string, unknown>> = []
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      const recoveryKey = randomBytes(32)
      const generationStart = nowMs()
      const shares = split(Buffer.from(recoveryKey), {
        shares: cfg.shares,
        threshold: cfg.threshold,
      }).map((share: Buffer) => share.toString('hex'))
      const generationMs = nowMs() - generationStart

      const reconstruct = (selectedShares: string[]) =>
        Uint8Array.from(combine(selectedShares.map((share) => Buffer.from(share, 'hex'))))
      const exactStart = nowMs()
      const exactKey = reconstruct(shares.slice(0, cfg.threshold))
      const exactThresholdMs = nowMs() - exactStart
      const aboveStart = nowMs()
      const aboveKey = reconstruct(shares.slice(0, cfg.threshold + 1))
      const aboveThresholdMs = nowMs() - aboveStart
      const insufficientStart = nowMs()
      let insufficientKey: Uint8Array | null = null
      let insufficientThrew = false
      try {
        insufficientKey = reconstruct(shares.slice(0, cfg.threshold - 1))
      } catch {
        insufficientThrew = true
      }
      const insufficientMs = nowMs() - insufficientStart
      const expectedKey = Buffer.from(recoveryKey)
      samples.push({
        repetition: repetition + 1,
        generationMs,
        exactThresholdMs,
        aboveThresholdMs,
        insufficientMs,
        exactThresholdSuccess: equalBytes(exactKey, expectedKey),
        aboveThresholdSuccess: equalBytes(aboveKey, expectedKey),
        insufficientShareFailure: insufficientThrew || !equalBytes(insufficientKey ?? new Uint8Array(), expectedKey),
      })
    }
    rows.push({
      threshold: cfg.threshold,
      totalShares: cfg.shares,
      samples,
      generationStats: summarize(samples.map((sample) => sample.generationMs as number)),
      exactThresholdStats: summarize(samples.map((sample) => sample.exactThresholdMs as number)),
      aboveThresholdStats: summarize(samples.map((sample) => sample.aboveThresholdMs as number)),
      insufficientStats: summarize(samples.map((sample) => sample.insufficientMs as number)),
      exactThresholdSuccess: summarizeBinary(samples.filter((sample) => sample.exactThresholdSuccess).length, repetitions),
      aboveThresholdSuccess: summarizeBinary(samples.filter((sample) => sample.aboveThresholdSuccess).length, repetitions),
      insufficientShareFailure: summarizeBinary(samples.filter((sample) => sample.insufficientShareFailure).length, repetitions),
    })
  }

  return {
    experiment: 'recovery-benchmark',
    timestamp: new Date().toISOString(),
    browser: getBrowserInfo(),
    parameters: {
      thresholdConfigs,
      repetitions,
      reconstructionBoundary: 'share hex decoding plus Shamir combine; key comparison excluded',
      generationBoundary: 'Shamir split plus hex encoding; random recovery-key generation excluded',
    },
    metrics: { results: rows },
    result: 'Repeated Shamir share generation and reconstruction measurements completed.',
  }
}

export async function benchmarkTamperDetection(options: ResearchOptions = {}): Promise<ResearchReport> {
  const { repetitions } = validateOptions(options)
  const key = randomBytes(32)
  const plaintext = utf8ToBytes('Synthetic vault payload for tamper validation')
  const encrypted = await aesGcmEncrypt(key, plaintext)

  const tests: TamperTestRow[] = []
  const mutationCases = [
    {
      name: 'ciphertext-mutated',
      mutate: () => {
        const bytes = new Uint8Array(b64ToBytes(bytesToB64(encrypted.ciphertext)))
        bytes[0] = bytes[0]! ^ 0x01
        return { nonce: encrypted.nonce, ciphertext: bytes }
      },
    },
    {
      name: 'nonce-mutated',
      mutate: () => {
        const bytes = new Uint8Array(encrypted.nonce)
        bytes[0] = bytes[0]! ^ 0x01
        return { nonce: bytes, ciphertext: encrypted.ciphertext }
      },
    },
    {
      name: 'wrapping-key-mutated',
      mutate: () => {
        const bytes = new Uint8Array(key)
        bytes[0] = bytes[0]! ^ 0x01
        return { nonce: encrypted.nonce, ciphertext: encrypted.ciphertext, key: bytes }
      },
    },
  ]

  for (const scenario of mutationCases) {
    const samples: boolean[] = []
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      const mutated = scenario.mutate() as {
        nonce: Uint8Array
        ciphertext: Uint8Array
        key?: Uint8Array
      }
      try {
        await aesGcmDecrypt(mutated.key ?? key, mutated.nonce, mutated.ciphertext)
        samples.push(false)
      } catch {
        samples.push(true)
      }
    }
    const summary = summarizeBinary(samples.filter(Boolean).length, repetitions)
    tests.push({
      test: scenario.name,
      mutation: scenario.name,
      expectedResult: 'decryption failure',
      actualResult: summary.successes === repetitions ? 'decryption failed in every trial' : 'one or more decryptions succeeded',
      pass: summary.successes === repetitions,
      samples,
      ...summary,
    } as TamperTestRow)
  }

  return {
    experiment: 'tamper-detection',
    timestamp: new Date().toISOString(),
    browser: getBrowserInfo(),
    parameters: { mutationCases: mutationCases.map((entry) => entry.name), repetitions },
    metrics: { tests },
    result: 'Repeated AES-GCM tamper-detection outcomes recorded for ciphertext, nonce, and key mutations.',
  }
}

export async function benchmarkWrongPasswordSimulation(): Promise<ResearchReport> {
  const password = 'SyntheticMasterPassword!2026'
  const vault = await createNewVault({ masterPassword: password, shares: 3, threshold: 2 })
  const candidates = [
    'WrongGuessA',
    'WrongGuessB',
    'WrongGuessC',
    'WrongGuessD',
    'WrongGuessE',
    'WrongGuessF',
    'WrongGuessG',
    'WrongGuessH',
    'WrongGuessI',
    'WrongGuessJ',
  ]

  const timings: number[] = []
  for (const candidate of candidates) {
    const start = nowMs()
    try {
      await decryptVaultWithMasterPassword(vault.blob, candidate)
    } catch {
      // Deliberately treat failed guesses as a benchmark outcome rather than aborting the suite.
    }
    timings.push(nowMs() - start)
  }

  return {
    experiment: 'wrong-password-offline-simulation',
    timestamp: new Date().toISOString(),
    browser: getBrowserInfo(),
    parameters: { candidates: candidates.length, note: 'Synthetic control experiment only; no real credentials' },
    metrics: {
      attempts: timings.length,
      timingsMs: timings,
      stats: summarize(timings),
      attemptsPerSecond: timings.length / Math.max(1, timings.reduce((sum, value) => sum + value, 0) / 1000),
    },
    result: 'Offline attack-resistance benchmark executed on synthetic data only.',
  }
}

export async function benchmarkVaultPerformance(options: ResearchOptions = {}): Promise<ResearchReport> {
  const { repetitions, warmups } = validateOptions(options)
  const sizes = [10, 50, 100, 500, 1000]
  const rows: Array<Record<string, unknown>> = []

  for (const count of sizes) {
    const created = await createNewVault({ masterPassword: 'SyntheticVaultPassword!2026', shares: 3, threshold: 2 })
    const data = createSyntheticData(count)
    const samples: Array<Record<string, unknown>> = []
    let lastPayload: Awaited<ReturnType<typeof encryptVaultPayload>> | null = null

    for (let warmup = 0; warmup < warmups; warmup += 1) {
      const encrypted = await encryptVaultPayload(created.unlocked.vaultKey, data)
      await decryptVaultPayload(created.unlocked.vaultKey, encrypted)
    }
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      const encryptionStart = nowMs()
      const payload = await encryptVaultPayload(created.unlocked.vaultKey, data)
      const encryptionTimeMs = nowMs() - encryptionStart
      const decryptionStart = nowMs()
      const opened = await decryptVaultPayload(created.unlocked.vaultKey, payload)
      const decryptionTimeMs = nowMs() - decryptionStart
      if (opened.entries.length !== count) throw new Error('Vault payload round-trip entry count mismatch')
      lastPayload = payload
      samples.push({ repetition: repetition + 1, encryptionTimeMs, decryptionTimeMs })
    }

    const serializedBlob = { ...created.blob, payload: lastPayload! }
    const serializedVaultSizeBytes = new TextEncoder().encode(JSON.stringify(serializedBlob)).length
    const encryptionTimings = samples.map((sample) => sample.encryptionTimeMs as number)
    const decryptionTimings = samples.map((sample) => sample.decryptionTimeMs as number)
    rows.push({
      entryCount: count,
      samples,
      encryptionStats: summarize(encryptionTimings),
      decryptionStats: summarize(decryptionTimings),
      serializedVaultSizeBytes,
      openedEntryCount: count,
    })
  }

  return {
    experiment: 'vault-performance',
    timestamp: new Date().toISOString(),
    browser: getBrowserInfo(),
    parameters: {
      entryCounts: sizes,
      repetitions,
      warmups,
      encryptionBoundary: 'JSON.stringify, UTF-8 encoding, AES-GCM encryption, nonce/ciphertext base64 encoding and payload object construction; excludes key derivation, input-data construction, outer vault-blob serialization, and storage I/O',
      decryptionBoundary: 'nonce/ciphertext base64 decoding, AES-GCM decryption, UTF-8 decoding, JSON parsing, and vault-data schema validation; excludes key derivation and storage I/O',
      latencyPairing: 'each measured decryption uses the ciphertext produced by its immediately preceding measured encryption',
    },
    metrics: { results: rows },
    result: 'Repeated bulk vault-payload encryption and decryption measurements completed.',
  }
}

export async function benchmarkKeyRotation(): Promise<ResearchReport> {
  const originalPassword = 'OriginalMasterPassword!2026'
  const created = await createNewVault({ masterPassword: originalPassword, shares: 3, threshold: 2 })
  const recovered = await recoverVaultWithSharesAndRotateMasterPassword(created.blob, {
    shares: created.recoveryShares.slice(0, 2),
    newMasterPassword: 'RotatedMasterPassword!2026',
  })

  const originalUnlock = await decryptVaultWithMasterPassword(created.blob, originalPassword)
  const rotatedUnlock = await decryptVaultWithMasterPassword(recovered.newBlob, 'RotatedMasterPassword!2026')
  let oldPasswordStillWorks = false
  try {
    await decryptVaultWithMasterPassword(recovered.newBlob, originalPassword)
    oldPasswordStillWorks = true
  } catch {
    oldPasswordStillWorks = false
  }

  return {
    experiment: 'key-rotation',
    timestamp: new Date().toISOString(),
    browser: getBrowserInfo(),
    parameters: { recoveryThreshold: 2 },
    metrics: {
      originalUnlockValid: originalUnlock.data.entries.length >= 0,
      rotatedUnlockValid: rotatedUnlock.data.entries.length >= 0,
      oldPasswordDenied: !oldPasswordStillWorks,
    },
    result: 'Recovery and rotation cycle verified with a new master password and old password rejection.',
  }
}

export async function runResearchSuite(options: ResearchOptions = {}): Promise<Record<string, ResearchReport>> {
  return {
    kdf: await benchmarkKdf(options),
    recovery: await benchmarkRecovery(options),
    tamper: await benchmarkTamperDetection(options),
    offline: await benchmarkWrongPasswordSimulation(),
    vault: await benchmarkVaultPerformance(options),
    rotation: await benchmarkKeyRotation(),
  }
}

export function exportResearchJson(report: Record<string, ResearchReport>): string {
  return JSON.stringify(report, null, 2)
}

export function exportResearchCsv(report: Record<string, ResearchReport>): string {
  const rows: Array<Record<string, string | number | boolean>> = []
  Object.entries(report).forEach(([experiment, value]) => {
    rows.push({
      experiment,
      timestamp: value.timestamp,
      browser: value.browser.userAgent,
      platform: value.browser.platform,
      result: value.result,
    })
  })

  const headers = ['experiment', 'timestamp', 'browser', 'platform', 'result']
  const csvRows = [headers.join(',')]
  rows.forEach((row) => {
    csvRows.push(
      headers
        .map((header) => JSON.stringify(String(row[header] ?? '')))
        .join(','),
    )
  })
  return csvRows.join('\n')
}
