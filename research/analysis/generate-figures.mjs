import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const inputPath = process.argv[2]
if (!inputPath) throw new Error('Usage: node generate-figures.mjs <raw-run.json>')
const rawPath = resolve(inputPath)
const rawBytes = readFileSync(rawPath)
const raw = JSON.parse(rawBytes.toString('utf8'))
const rawHash = createHash('sha256').update(rawBytes).digest('hex')
const rawName = basename(rawPath)
const outputRoot = join(dirname(fileURLToPath(import.meta.url)), 'figures', rawName.replace(/\.json$/, ''))
mkdirSync(outputRoot, { recursive: true })

const palette = ['#187b73', '#c17a18', '#486b9a', '#a54e42']
const escapeXml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const medianPoint = (stats) => ({
  value: stats.median,
  lower: stats.medianConfidence95?.lower ?? stats.median,
  upper: stats.medianConfidence95?.upper ?? stats.median,
})

function lineFigure({ number, title, subtitle, xLabel, categories, series, forcedMax, errorLabel }) {
  const width = 1040
  const height = 620
  const left = 100
  const right = 970
  const top = 92
  const bottom = 470
  const plotWidth = right - left
  const plotHeight = bottom - top
  const maxValue = forcedMax ?? Math.max(1, ...series.flatMap((item) => item.points.filter(Boolean).map((point) => point.upper)))
  const step = maxValue / 5
  const y = (value) => bottom - (value / maxValue) * plotHeight
  const x = (index) => categories.length === 1 ? left + plotWidth / 2 : left + (index * plotWidth) / (categories.length - 1)
  const pieces = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">`,
    '<rect width="100%" height="100%" fill="#ffffff"/>',
    `<title id="title">Figure ${number}. ${escapeXml(title)}</title>`,
    `<desc id="desc">${escapeXml(subtitle)} Raw source ${escapeXml(rawName)}.</desc>`,
    `<text x="${left}" y="38" class="heading">Figure ${number}. ${escapeXml(title)}</text>`,
    `<text x="${left}" y="66" class="subtitle">${escapeXml(subtitle)}</text>`,
    '<g font-family="Georgia, serif" fill="#252a2d">',
  ]
  for (let tick = 0; tick <= 5; tick += 1) {
    const value = step * tick
    const yy = y(value)
    pieces.push(`<line x1="${left}" y1="${yy}" x2="${right}" y2="${yy}" stroke="#d9dddf" stroke-width="1"/>`)
    pieces.push(`<text x="${left - 14}" y="${yy + 5}" text-anchor="end" font-size="13">${value.toFixed(value < 10 ? 2 : 0)}</text>`)
  }
  pieces.push(`<line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" stroke="#596166"/>`)
  pieces.push(`<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="#596166"/>`)
  categories.forEach((category, index) => {
    const xx = x(index)
    pieces.push(`<line x1="${xx}" y1="${bottom}" x2="${xx}" y2="${bottom + 5}" stroke="#596166"/>`)
    pieces.push(`<text x="${xx}" y="${bottom + 25}" text-anchor="middle" font-size="12">${escapeXml(category)}</text>`)
  })
  pieces.push(`<text x="${(left + right) / 2}" y="${bottom + 62}" text-anchor="middle" font-size="15">${escapeXml(xLabel)}</text>`)
  pieces.push(`<text transform="translate(30 ${(top + bottom) / 2}) rotate(-90)" text-anchor="middle" font-size="15">Latency (ms)</text>`)

  series.forEach((item, seriesIndex) => {
    const color = item.color ?? palette[seriesIndex % palette.length]
    const points = item.points.map((point, index) => point ? { ...point, x: x(index), y: y(point.value) } : null)
    let path = ''
    let active = false
    points.forEach((point) => {
      if (!point) {
        active = false
        return
      }
      path += `${active ? 'L' : 'M'} ${point.x} ${point.y} `
      active = true
    })
    pieces.push(`<path d="${path}" fill="none" stroke="${color}" stroke-width="3"/>`)
    points.forEach((point) => {
      if (!point) return
      const lower = y(Math.max(0, point.lower))
      const upper = y(point.upper)
      pieces.push(`<line x1="${point.x}" y1="${upper}" x2="${point.x}" y2="${lower}" stroke="${color}" stroke-width="1.5"/>`)
      pieces.push(`<line x1="${point.x - 5}" y1="${upper}" x2="${point.x + 5}" y2="${upper}" stroke="${color}"/>`)
      pieces.push(`<line x1="${point.x - 5}" y1="${lower}" x2="${point.x + 5}" y2="${lower}" stroke="${color}"/>`)
      pieces.push(`<circle cx="${point.x}" cy="${point.y}" r="5" fill="${color}"/>`)
    })
  })

  let legendX = left
  const legendY = 552
  series.forEach((item, index) => {
    if (item.points.every((point) => !point)) return
    const color = item.color ?? palette[index % palette.length]
    pieces.push(`<line x1="${legendX}" y1="${legendY}" x2="${legendX + 24}" y2="${legendY}" stroke="${color}" stroke-width="3"/>`)
    pieces.push(`<text x="${legendX + 31}" y="${legendY + 5}" font-size="13">${escapeXml(item.name)}</text>`)
    legendX += Math.max(160, item.name.length * 8 + 62)
  })
  pieces.push(`<text x="${left}" y="590" font-size="11" fill="#586168">Error bars: ${escapeXml(errorLabel)}. Source SHA-256: ${rawHash}</text>`)
  pieces.push('</g><style>.heading{font:600 24px Georgia,serif;fill:#202629}.subtitle{font:14px Georgia,serif;fill:#596166}</style></svg>')
  return pieces.join('\n')
}

function barFigure({ number, title, subtitle, categories, points, forcedMax = 1 }) {
  const width = 1040
  const height = 620
  const left = 100
  const right = 970
  const top = 92
  const bottom = 470
  const plotHeight = bottom - top
  const y = (value) => bottom - value / forcedMax * plotHeight
  const maxTick = forcedMax
  const step = maxTick / 5
  const slotWidth = (right - left) / categories.length
  const barWidth = Math.min(80, slotWidth * 0.48)
  const pieces = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">`,
    '<rect width="100%" height="100%" fill="#ffffff"/>',
    `<title id="title">Figure ${number}. ${escapeXml(title)}</title>`,
    `<desc id="desc">${escapeXml(subtitle)} Raw source ${escapeXml(rawName)}.</desc>`,
    `<text x="${left}" y="38" class="heading">Figure ${number}. ${escapeXml(title)}</text>`,
    `<text x="${left}" y="66" class="subtitle">${escapeXml(subtitle)}</text>`,
    '<g font-family="Georgia, serif" fill="#252a2d">',
  ]
  for (let tick = 0; tick <= 5; tick += 1) {
    const value = step * tick
    const yy = y(value)
    pieces.push(`<line x1="${left}" y1="${yy}" x2="${right}" y2="${yy}" stroke="#d9dddf"/>`)
    pieces.push(`<text x="${left - 14}" y="${yy + 5}" text-anchor="end" font-size="13">${(value * 100).toFixed(0)}%</text>`)
  }
  pieces.push(`<line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" stroke="#596166"/>`)
  pieces.push(`<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="#596166"/>`)
  points.forEach((point, index) => {
    const center = left + (index + 0.5) * slotWidth
    const barTop = y(point.value)
    const upper = y(point.upper)
    const lower = y(point.lower)
    const color = palette[index % palette.length]
    pieces.push(`<rect x="${center - barWidth / 2}" y="${barTop}" width="${barWidth}" height="${bottom - barTop}" fill="${color}"/>`)
    pieces.push(`<line x1="${center}" y1="${upper}" x2="${center}" y2="${lower}" stroke="#202629" stroke-width="2"/>`)
    pieces.push(`<line x1="${center - 7}" y1="${upper}" x2="${center + 7}" y2="${upper}" stroke="#202629"/>`)
    pieces.push(`<line x1="${center - 7}" y1="${lower}" x2="${center + 7}" y2="${lower}" stroke="#202629"/>`)
    pieces.push(`<text x="${center}" y="${bottom + 25}" text-anchor="middle" font-size="13">${escapeXml(categories[index])}</text>`)
  })
  pieces.push(`<text transform="translate(30 ${(top + bottom) / 2}) rotate(-90)" text-anchor="middle" font-size="15">Observed detection rate</text>`)
  pieces.push(`<text x="${left}" y="552" font-size="12">Wilson score 95% intervals; ${escapeXml(repetitionsLabel(points))}. Source SHA-256: ${rawHash}</text>`)
  pieces.push('</g><style>.heading{font:600 24px Georgia,serif;fill:#202629}.subtitle{font:14px Georgia,serif;fill:#596166}</style></svg>')
  return pieces.join('\n')
}

function repetitionsLabel(points) {
  return `${points[0]?.trials ?? 'n'} trials per mutation`
}

function saveFigure(name, content) {
  writeFileSync(join(outputRoot, name), `${content}\n`, { flag: 'w' })
}

const kdfRows = raw.experiments.kdf.metrics.configurations
const pbkdfRows = kdfRows.filter((row) => row.algorithm === 'pbkdf2-sha256')
const argonRows = kdfRows.filter((row) => row.algorithm === 'argon2id')
const kdfLabel = (row) => row.algorithm === 'pbkdf2-sha256'
  ? `${Math.round(row.parameters.iterations / 1000)}k`
  : `${row.parameters.iterations}t/${Math.round(row.parameters.memorySize / 1024)}MiB`

saveFigure('figure-01-pbkdf2-iterations.svg', lineFigure({
  number: 1,
  title: 'PBKDF2 Iteration Count and Median Derivation Latency',
  subtitle: 'Thirty measured derivations per configuration; 95% bootstrap intervals for the median.',
  xLabel: 'PBKDF2-HMAC-SHA256 iterations',
  categories: pbkdfRows.map((row) => kdfLabel(row)),
  series: [{ name: 'PBKDF2 median', color: palette[0], points: pbkdfRows.map((row) => medianPoint(row.stats)) }],
  errorLabel: '95% percentile-bootstrap CI for median',
}))

saveFigure('figure-02-argon2id-parameters.svg', lineFigure({
  number: 2,
  title: 'Argon2id Parameters and Median Derivation Latency',
  subtitle: 'Configurations encode time cost and memory; 30 measured derivations each.',
  xLabel: 'Argon2id configuration (time cost / memory)',
  categories: argonRows.map(kdfLabel),
  series: [{ name: 'Argon2id median', color: palette[1], points: argonRows.map((row) => medianPoint(row.stats)) }],
  errorLabel: '95% percentile-bootstrap CI for median',
}))

const baseline = pbkdfRows.find((row) => row.parameters.iterations === 100000)?.stats.median
if (!(baseline > 0)) throw new Error('Raw file has no positive PBKDF2 100k baseline')
const normalizedCategories = kdfRows.map(kdfLabel)
const normalizedSeries = ['pbkdf2-sha256', 'argon2id'].map((algorithm, index) => ({
  name: `${algorithm} median / PBKDF2 100k median`,
  color: palette[index],
  points: kdfRows.map((row) => row.algorithm === algorithm ? {
    value: row.stats.median / baseline,
    lower: (row.stats.medianConfidence95?.lower ?? row.stats.median) / baseline,
    upper: (row.stats.medianConfidence95?.upper ?? row.stats.median) / baseline,
  } : null),
}))
saveFigure('figure-03-normalized-kdf-latency.svg', lineFigure({
  number: 3,
  title: 'Normalized PBKDF2 and Argon2id Derivation Latency',
  subtitle: 'Median latency ratios relative to the measured PBKDF2 100k configuration.',
  xLabel: 'KDF configuration',
  categories: normalizedCategories,
  series: normalizedSeries,
  errorLabel: '95% percentile-bootstrap CI for median, normalized by baseline',
}))

const shamirRows = raw.experiments.recovery.metrics.results
saveFigure('figure-04-shamir-reconstruction.svg', lineFigure({
  number: 4,
  title: 'Shamir Threshold Configuration and Reconstruction Latency',
  subtitle: 'Exact-threshold reconstruction, 30 independent generated secrets per configuration.',
  xLabel: 'Threshold k-of-n',
  categories: shamirRows.map((row) => `${row.threshold}-of-${row.totalShares}`),
  series: [{ name: 'Exact-k median', color: palette[2], points: shamirRows.map((row) => medianPoint(row.exactThresholdStats)) }],
  errorLabel: '95% percentile-bootstrap CI for median',
}))

const vaultRows = raw.experiments.vault.metrics.results
for (const [number, field, filename, title] of [
  [5, 'encryptionStats', 'figure-05-vault-encryption.svg', 'Vault Entry Count and Payload Encryption Latency'],
  [6, 'decryptionStats', 'figure-06-vault-decryption.svg', 'Vault Entry Count and Payload Decryption Latency'],
]) {
  saveFigure(filename, lineFigure({
    number,
    title,
    subtitle: 'One bulk payload operation per observation; key derivation and data construction excluded.',
    xLabel: 'Synthetic vault entries',
    categories: vaultRows.map((row) => String(row.entryCount)),
    series: [{
      name: `Median ${field === 'encryptionStats' ? 'encryption' : 'decryption'}`,
      color: field === 'encryptionStats' ? palette[0] : palette[2],
      points: vaultRows.map((row) => medianPoint(row[field])),
    }],
    errorLabel: '95% percentile-bootstrap CI for median',
  }))
}

const tamperRows = raw.experiments.tamper.metrics.tests
saveFigure('figure-07-tamper-detection.svg', barFigure({
  number: 7,
  title: 'AES-GCM Tamper-Detection Success Rate',
  subtitle: 'Observed decryption rejection proportion for each mutation class.',
  categories: tamperRows.map((row) => row.test.replaceAll('-mutated', '')),
  points: tamperRows.map((row) => ({
    value: row.proportion,
    lower: row.confidence95.lower,
    upper: row.confidence95.upper,
    trials: row.trials,
  })),
}))

const manifest = {
  sourceFile: rawName,
  sourceSha256: rawHash,
  outputFigures: [
    'figure-01-pbkdf2-iterations.svg',
    'figure-02-argon2id-parameters.svg',
    'figure-03-normalized-kdf-latency.svg',
    'figure-04-shamir-reconstruction.svg',
    'figure-05-vault-encryption.svg',
    'figure-06-vault-decryption.svg',
    'figure-07-tamper-detection.svg',
  ],
}
writeFileSync(join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'w' })
console.log(JSON.stringify({ outputRoot, sourceFile: rawName, sourceSha256: rawHash, figures: manifest.outputFigures }, null, 2))
