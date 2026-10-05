# Experiment Protocol

This protocol defines the sampling design, boundaries, and analysis rules for the local research benchmark. The run recorder measures under Node.js; a browser is recorded as host context and is not represented as the execution engine for these measurements.

## Research hypotheses

- **H1:** Increasing PBKDF2 iteration count increases password-derived key generation latency.
- **H2:** Increasing Argon2id computational/memory parameters increases key derivation latency.
- **H3:** Higher KDF cost provides increased computational resistance at the expense of user-facing unlock latency.
- **H4:** Increasing vault size increases encryption/decryption workload.
- **H5:** Shamir recovery succeeds when at least k valid shares are available and fails when fewer than k shares are available.

These are hypotheses, not conclusions. Latency results alone do not establish attacker cost, effective resistance, or user-perceived unlock acceptability.

## 1. Environment and provenance

- Record OS distribution and kernel, architecture, CPU model/logical CPU count, total RAM, and available RAM at run start.
- Record Node.js, OpenSSL, application/package version, Git HEAD, dirty-tree state, and a SHA-256 fingerprint of benchmark source files.
- Record the available browser and its user agent/version as host context only. The checked-in run command executes under Node.js, not in that browser.
- Results from a dirty worktree must be associated with the recorded source fingerprint and must not be described as being fully represented by the Git commit alone.

## 2. Setup and execution

1. From `vault`, install dependencies with `npm install`.
2. Run `npm run research:run`; defaults are 30 measured repetitions per configuration and 3 warm-up derivations for each KDF configuration and 3 vault payload warm-ups per size.
3. Set `RESEARCH_REPETITIONS` or `RESEARCH_WARMUPS` only when intentionally changing the protocol; the exact values are embedded in the run artifact.
4. The command writes uniquely named raw JSON and CSV files and a uniquely named processed summary. It never overwrites historical runs or `latest-summary.json`.
5. Generate figures from a specific raw file with `node ../research/analysis/generate-figures.mjs ../research/results/raw/<run-file>.json`.

## 3. Benchmark methodology

### KDF benchmark

- Evaluate PBKDF2 at 100k, 200k, 310k, 400k, and 600k iterations.
- Evaluate Argon2id at 2 iterations / 64 MiB, 3 iterations / 64 MiB, and 3 iterations / 256 MiB.
- Use 30 measured derivations and 3 separately recorded warm-up derivations per configuration; warm-ups are excluded from summary statistics.
- Retain every warm-up and measured sample. Rotate configuration order between measured rounds to reduce fixed-order bias.
- Use a fixed synthetic password and a random salt per configuration, held constant across its repetitions.
- Time the complete `deriveMasterKek` call, including WebCrypto key import/parameter conversion for PBKDF2 or Argon2id input handling.
- Record mean, median, minimum, maximum, sample standard deviation, 95% t interval for the mean, and deterministic percentile-bootstrap interval for the median.

### Shamir recovery benchmark

- Evaluate 2-of-3, 2-of-5, 3-of-5, 3-of-7, 4-of-7, and 5-of-10, with 30 repetitions per configuration and a new random 32-byte secret per repetition.
- Generation timing includes conversion of the recovery key to the library Buffer, Shamir split, and hexadecimal encoding; random-secret generation is excluded.
- Reconstruction timing includes share selection, hex decoding, Shamir combine, and conversion to output bytes; comparison against the known secret is excluded.
- Record raw latency samples for generation, exact-k reconstruction, (k+1)-share reconstruction, and (k-1)-share reconstruction.
- Exact-k and above-k success require byte-for-byte equality to the original secret. Fewer-than-k failure is defined as combine throwing or output differing from the original secret.

### Tamper detection

- Begin from a valid AES-GCM ciphertext and repeat ciphertext, nonce, and key mutations 30 times each.
- Record every Boolean outcome and report a Wilson score interval for each mutation's observed detection proportion.

### Offline attack simulation

- Use synthetic passwords only and measure derivation plus rejection for wrong guesses against a synthetic vault.
- Label this as a controlled local benchmark, not a real-world attack tool. Do not interpret the measured rate as representative of attackers or other hardware.

### Vault performance

- Generate synthetic datasets with 10, 50, 100, 500, and 1000 entries before timing. Run 3 warm-ups and retain 30 measured samples per size.
- Encryption includes JSON serialization, UTF-8 encoding, AES-GCM encryption, base64 encoding, and encrypted-payload object construction. It excludes data construction, password KDF, outer vault-blob serialization, and storage I/O.
- Decryption includes base64 decoding, AES-GCM decryption, UTF-8 decoding, JSON parsing, and schema validation. It excludes password KDF and storage I/O. Each decryption uses the ciphertext produced by its paired measured encryption.
- Record serialized full-vault byte size separately from the timed encryption boundary.
- The first run's sequential-upsert timing is retained as such: it includes N clones/searches/appends and N full-payload encryptions, not one bulk encryption.

### Key rotation

- Create a synthetic vault, recover using a threshold set of shares, rotate to a new master password, then confirm new-password unlock and old-password rejection.

## 4. Statistical calculations and interpretation

- Report n, arithmetic mean, median, minimum, maximum, and sample standard deviation (denominator n-1) for continuous timings.
- The 95% confidence interval for a mean uses a Student t critical value approximated with the Cornish-Fisher expansion. The median interval is the 2.5th to 97.5th percentile of 2,000 bootstrap resamples using a deterministic seed derived from observed values.
- Binary outcome intervals use the two-sided 95% Wilson score interval.
- Report intervals as uncertainty summaries, not significance tests. No hypothesis test or multiple-comparison adjustment is performed.
- Bootstrap intervals are reproducible approximations; observations are collected serially on one host and may not be independent under thermal, scheduling, or memory-pressure effects.

## 5. Synthetic data rules

- Never export or store real passwords or real user vault contents.
- Use generated labels such as `Entry 1`, `user1`, and synthetic random strings. Results contain timings and metadata, not the generated vault plaintext.

## 6. Reproducibility checklist

- Keep the first-run artifacts unchanged and write every subsequent run to unique filenames.
- Confirm each KDF configuration has the configured warm-up and measured sample counts; ensure warm-ups are excluded from reported statistics.
- Validate all raw arrays and summary calculations from JSON before graphing.
- Generate figures only from a named raw JSON run; scripts must not contain manually entered measurements.
- Keep Git HEAD, source fingerprint, environment metadata, and raw files together. Record a clean worktree for a final paper-quality replication where possible.

## 7. Scope

The suite evaluates implementation latency and selected functional outcomes. It does not provide formal security proofs, measure attacker economics, conduct hypothesis tests, characterize cross-device variation, or establish universally optimal parameters.
