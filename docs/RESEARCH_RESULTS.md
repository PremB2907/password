# Research Results

This record separates the initial exploratory run from the repeated run with corrected measurement boundaries. Numeric summaries below are transcribed from the archived raw JSON artifacts. Raw sample arrays remain authoritative.

## Experiment Setup

**Definitive repeated run:** `2026-10-05T17-49-16-071Z`, executed from `npm run research:run` after `npm test` and `npm run build` passed. Thirty measured repetitions were collected for each KDF, Shamir, and vault configuration. Three KDF warm-up durations were stored separately; three vault warm-up operations were executed per size and excluded, but their durations were not retained. Tamper cases were repeated 30 times each.

An earlier complete repeated suite (`2026-10-05T17-47-11-835Z`, 30 samples/configuration) is preserved as a separate replication in [its raw JSON](../research/results/raw/research-run-2026-10-05T17-47-11-835Z.json), [CSV](../research/results/raw/research-run-2026-10-05T17-47-11-835Z.csv), and [processed summary](../research/results/processed/summary-2026-10-05T17-47-11-835Z.json). It is not pooled into the tables below because it predates the final provenance capture/fingerprint correction. The figures and summary table below use the definitive run identified above.

**Environment:** Ubuntu 26.04.1 LTS, Linux 7.0.0-34-generic, x86_64; Intel Core i5-12450H, 12 logical CPUs; 15,648,215,040 bytes total RAM and 6,615,404,544 bytes available at run start. Measurements ran under Node.js v22.22.1 using Node WebCrypto and `hash-wasm`; OpenSSL 3.5.5; application version 0.0.0. The observed host browser was Chrome 150.0.7871.250 / Electron 43.6.0 / VS Code 1.139.1, but was not the measurement runtime.

Git HEAD was `3192c3ad0823fa4d98fa6806bf9bf8a6973e6ce7`. The worktree was dirty; the benchmark source SHA-256 was `b1a4cee7d144af0aa2131bbe5f46210a84fb611ecb27c1b1c43168d071b7d524`. This hash covers `vault/src/research/index.ts`, `vault/src/vault/crypto.ts`, `vault/src/vault/vault.ts`, `vault/package.json`, `vault/package-lock.json`, and `vault/scripts/run-research.mts`. The commit identifies the base revision; it does not alone identify the dirty benchmark source.

Timing summaries report sample standard deviation (denominator n-1). Mean intervals are two-sided 95% Student t intervals using a Cornish-Fisher critical-value approximation. Median intervals are deterministic percentile-bootstrap intervals from 2,000 resamples. Binary intervals are 95% Wilson score intervals. These intervals describe uncertainty; no hypothesis tests or significance claims were made.

## Raw Results

### First recorded run

The initial run remains archived without modification:

- [First-run JSON](../research/results/raw/benchmark-run-2026-10-05T17-38-04-704Z.json)
- [First-run CSV](../research/results/raw/benchmark-run-2026-10-05T17-38-04-704Z.csv)
- [Original processed summary](../research/results/processed/latest-summary.json)

The first run used five KDF samples per configuration and did not record warm-ups. Its raw KDF medians (ms) were PBKDF2 100k: 12.66, 200k: 25.04, 310k: 38.62, 400k: 49.99, 600k: 77.29; Argon2id 2/64 MiB: 125.02, 3/64 MiB: 166.59, 3/256 MiB: 664.64. First-run recovery latency was end-to-end recovery/rotation, not isolated Shamir reconstruction; `generationMs: 0` was a placeholder, not a measurement. The corrected archived raw values for 4-of-7 and 5-of-10 were 41.74 ms and 42.66 ms, respectively; earlier prose transcribed those two values incorrectly.

The first run's vault values were also preserved, but its columns were not comparable: for 10 entries it recorded 2.96 ms encryption and 41.85 ms decryption; for 1000 entries it recorded 2011.74 ms encryption and 46.81 ms decryption. The cause and corrected experiment are described under Observations.

### Repeated-run KDF samples

Each row has n=30 measured samples; all individual values and three warm-ups are in the raw JSON/CSV.

| KDF configuration | Mean (ms) | Median (ms), 95% bootstrap CI | Sample SD (ms) | Min–max (ms) |
| --- | ---: | ---: | ---: | ---: |
| PBKDF2, 100k | 13.16 | 13.09 [12.62, 13.62] | 0.82 | 11.94–14.78 |
| PBKDF2, 200k | 26.31 | 25.78 [25.35, 26.72] | 1.90 | 23.59–31.81 |
| PBKDF2, 310k | 40.45 | 39.63 [39.41, 40.93] | 2.24 | 38.01–48.37 |
| PBKDF2, 400k | 52.87 | 52.87 [51.96, 54.19] | 2.33 | 48.46–58.07 |
| PBKDF2, 600k | 79.12 | 78.58 [76.66, 80.66] | 3.88 | 73.48–92.61 |
| Argon2id, 2 / 64 MiB | 118.39 | 117.50 [114.35, 119.52] | 7.97 | 109.34–151.16 |
| Argon2id, 3 / 64 MiB | 168.32 | 168.74 [163.05, 171.07] | 9.06 | 151.30–190.86 |
| Argon2id, 3 / 256 MiB | 684.43 | 684.77 [674.27, 694.29] | 23.04 | 640.03–732.52 |

The raw JSON also contains 95% t intervals for every mean.

### Repeated Shamir samples

Each configuration has 30 fresh recovery keys. Latencies below are medians in ms; exact and above-threshold reconstruction matched the original key in 30/30 trials, and insufficient-share reconstruction failed in 30/30 trials for every configuration.

| k-of-n | Generation median | Exact-k reconstruction median, 95% bootstrap CI | Exact / above / insufficient outcomes |
| --- | ---: | ---: | --- |
| 2-of-3 | 1.474 | 0.681 [0.573, 0.936] | 30/30, 30/30, 30/30 |
| 2-of-5 | 1.722 | 0.580 [0.559, 0.745] | 30/30, 30/30, 30/30 |
| 3-of-5 | 1.922 | 1.211 [0.855, 1.481] | 30/30, 30/30, 30/30 |
| 3-of-7 | 2.382 | 0.846 [0.807, 1.278] | 30/30, 30/30, 30/30 |
| 4-of-7 | 2.617 | 1.095 [1.064, 1.474] | 30/30, 30/30, 30/30 |
| 5-of-10 | 3.841 | 1.332 [1.296, 1.975] | 30/30, 30/30, 30/30 |

### Repeated vault-size samples

Each row has 30 paired observations. Latency is median (95% bootstrap CI) in ms; byte count is the serialized full vault size.

| Entries | Serialized bytes | Encryption median [CI] | Encryption mean / SD | Decryption median [CI] | Decryption mean / SD |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 2,494 | 0.061 [0.054, 0.092] | 0.083 / 0.046 | 0.068 [0.054, 0.158] | 0.118 / 0.087 |
| 50 | 10,758 | 0.187 [0.154, 0.206] | 0.198 / 0.063 | 0.236 [0.204, 0.277] | 0.252 / 0.090 |
| 100 | 21,098 | 0.224 [0.201, 0.230] | 0.232 / 0.049 | 0.230 [0.155, 0.255] | 0.234 / 0.106 |
| 500 | 105,898 | 1.096 [1.014, 1.213] | 1.336 / 0.595 | 0.688 [0.569, 0.747] | 1.061 / 1.926 |
| 1000 | 211,902 | 1.989 [1.933, 2.136] | 2.652 / 1.389 | 1.278 [1.225, 1.379] | 1.345 / 0.191 |

### Tamper outcomes

Each mutation was tested 30 times. Ciphertext, nonce, and wrapping-key mutations each caused decryption rejection in 30/30 trials (observed rate 1.00; Wilson 95% CI [0.886, 1.000]).

## Statistical Summary

Raw samples are preserved in [the repeated-run JSON](../research/results/raw/research-run-2026-10-05T17-49-16-071Z.json); a long-form CSV has one row per sample/measurement in [the repeated-run CSV](../research/results/raw/research-run-2026-10-05T17-49-16-071Z.csv). The separately named processed file is [the run summary](../research/results/processed/summary-2026-10-05T17-49-16-071Z.json). The original `latest-summary.json` was not replaced.

## Observations

**Vault-performance anomaly.** The first benchmark timed N sequential `upsertEntryAndSave` operations for N entries. Each operation structured-cloned the accumulated vault, searched it, appended one entry, serialized the whole updated payload, and performed a whole-payload AES-GCM encryption. Across N additions, this repeats growing work and leads to approximately quadratic data processing, plus N WebCrypto calls. In contrast, decryption was timed once through `decryptVaultWithMasterPassword`, which includes PBKDF2 derivation as well as payload decrypt, parsing, and validation. The old encryption/decryption columns therefore measured different workloads. The code identifies repeated clone/search/serialize/encrypt as the primary cause; the first run did not instrument these components separately, so their individual shares, garbage-collection contribution, and per-call WebCrypto cost cannot be quantified from that artifact.

The repeated experiment instead constructs data outside the timer and performs exactly one production payload encrypt and one paired payload decrypt per sample. Encryption includes JSON serialization, UTF-8 encoding, AES-GCM, base64 encoding, and encrypted-payload object construction. Decryption includes base64 decoding, AES-GCM, UTF-8 decoding, JSON parsing, and schema validation. Both exclude KDF and storage I/O. On these boundaries the 10-to-1000-entry encryption median rose from 0.061 to 1.989 ms, and decryption from 0.068 to 1.278 ms. The vault byte size rose from 2,494 to 211,902 bytes.

## Hypothesis Evaluation

- **H1:** Supported descriptively in this run. PBKDF2 median latency rose monotonically from 13.09 ms at 100k iterations to 78.58 ms at 600k.
- **H2:** Supported descriptively for the tested Argon2id configurations. Median latency rose from 117.50 ms (2 / 64 MiB) to 168.74 ms (3 / 64 MiB) and 684.77 ms (3 / 256 MiB). The last comparison changes memory while holding time cost at 3, but the full design does not isolate every parameter interaction.
- **H3:** Not evaluated as a security hypothesis. The experiment measures defender-side derivation latency only; it does not measure attacker hardware, attack economics, effective resistance, or user acceptability. Higher measured cost is not proof of increased resistance.
- **H4:** Supported for the tested bulk-payload workload at the endpoint: serialized size and both median operation times were higher at 1000 entries than at 10. Per-size decryption medians were not strictly monotonic, and timing dispersion/outliers were present.
- **H5:** Supported for the tested valid-share cases: exact-k and k+1 shares reconstructed the secret in every trial; k-1 shares did not reconstruct the original secret in every trial. This is a finite functional test, not a proof about all inputs or implementations.

No hypothesis test was run; confidence intervals are not used to claim statistical significance.

## Limitations

- This is one host/runtime and one repeated suite execution; serial measurements can be affected by scheduling, thermal state, garbage collection, and memory pressure.
- Node.js WebCrypto and Argon2id WASM timings do not establish browser-engine performance. Browser version is recorded as host context only.
- Argon2id parameter comparisons do not form a complete factorial design; effects cannot be attributed independently to each parameter across all configurations.
- Bootstrap intervals assume resampling of the observed timing population; repeated measurements in one process may be dependent. Small Shamir timing values are near timer resolution.
- The tamper sample is limited to three deterministic single-bit mutation classes. A 30/30 result still has a Wilson lower bound below 1.
- No comparative offline attacker benchmark, user study, cross-device replication, hypothesis testing, or multiple-comparison correction was performed.

## Reproducibility

- Runner: `cd vault && npm run research:run` (30 samples; 3 warm-ups by default).
- Figures: `node research/analysis/generate-figures.mjs research/results/raw/research-run-2026-10-05T17-49-16-071Z.json`.
- Figure outputs and source manifest: [per-run figure directory](../research/analysis/figures/research-run-2026-10-05T17-49-16-071Z/).
- Figure input SHA-256: `2689751c3db02db972960a53cb4ec58ecc9e69dd989650d981f1d5b885725d63`.
- Benchmark source SHA-256: `b1a4cee7d144af0aa2131bbe5f46210a84fb611ecb27c1b1c43168d071b7d524`.
- The graph generator reads only the selected raw JSON for numeric points and intervals; no measured values are embedded in the script.
- The first-run raw JSON, CSV, and original processed summary remain at their original paths and were verified unchanged by SHA-256 after the repeated run.
