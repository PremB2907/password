# Security Audit

This audit reflects the actual code in the repository as updated for the research prototype. It intentionally distinguishes between the verified code paths and the research extensions.

## Current cryptographic primitives

### KDF

The current baseline is PBKDF2-HMAC-SHA256, not Argon2id. This is visible in the code path that calls `crypto.subtle.importKey(..., 'PBKDF2', ...)` and `crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', ... })`.

Evidence from the implementation:
- `vault/src/vault/crypto.ts` contains the KDF logic.
- `vault/src/vault/vault.ts` stores the KDF name as `pbkdf2-sha256` in the vault blob metadata.
- The default iteration count is `310_000`.

This is a correct PBKDF2 baseline. The project does not silently replace it with Argon2id.

### AES-GCM

The vault payload and wrapped key material use WebCrypto AES-GCM. This provides confidentiality and authentication. A fresh 12-byte nonce is generated for each encryption operation. The WebCrypto layer verifies the authentication tag on decryption.

### Shamir secret sharing

Recovery material is split using the `shamirs-secret-sharing` library. Recovery shares are used to reconstruct a random recovery key, which is then used to unwrap the vault key.

### IndexedDB storage

The application stores the encrypted vault blob in IndexedDB using `idb-keyval`. The blob is validated with Zod before use.

## Key hierarchy

The code implements the following structure:

```
Master Password
  -> PBKDF2-HMAC-SHA256
  -> Master KEK
  -> AES-GCM wrap of Vault Key

Vault Key
  -> AES-GCM encrypt vault JSON payload

Recovery Secret
  -> Shamir split into shares
  -> Reconstruct recovery secret
  -> AES-GCM unwrap Vault Key
```

The essential design choice is that the vault key is independent of the master password. The vault key is wrapped under both the master KEK and the recovery key.

## Password derivation

The implementation uses a random 16-byte salt and derives a 32-byte key using PBKDF2-HMAC-SHA256. The current explicit default is `310_000` iterations. This is documented as the baseline and preserved for compatibility.

## Salt generation

Vault creation and password rotation generate a new 16-byte random salt using `crypto.getRandomValues()`.

## Nonce generation

Each AES-GCM encryption call creates a new 12-byte nonce. This matches the standard recommendation for AES-GCM.

## Vault-key generation

The vault key is a random 32-byte AES key created per vault.

## Key wrapping

The vault key is encrypted under:
- the master password-derived KEK
- the recovery key reconstructed from Shamir shares

This allows ordinary unlock and recovery flows without re-encrypting the entire payload when the master password changes.

## Recovery mechanism

The recovery flow reconstructs enough shares to recover the recovery key. That recovered key unwraps the vault key, and then the vault JSON is decrypted. After a successful recovery, a new salt and new master KEK are derived and the vault key is re-wrapped under the new master password.

## Key rotation

The rotation flow changes the password-derived KEK and the master-wrap for the vault key. It does not replace the vault key itself. This is a correct design for a password-only rotation because the vault payload remains encrypted under the same vault key.

## IndexedDB and import/export

The vault blob is stored in the browser and is exported as JSON. Import is validated via schema parsing. The export format contains encrypted material only; the project explicitly avoids exporting plaintext passwords or plaintext vault contents.

## Plaintext exposure points

The main plaintext exposure points are:
- the master password while the user types it
- the vault data while the vault is unlocked in the browser memory
- any page script or browser extension that runs in the same JavaScript context as the vault

The encrypted blob itself is not plaintext.

## Possible attack surfaces

- offline brute-force on the encrypted blob if the attacker learns it and the password is weak
- browser compromise or malicious same-origin script execution
- malicious or corrupted recovery shares
- local device theft when the vault is already unlocked

## Current weaknesses

- PBKDF2 is slower than Argon2id but remains the baseline, not a security regression in the current implementation.
- The project is local-only and does not include anti-guessing rate limiting.
- Browser runtime compromise can expose plaintext while the vault is unlocked.
- Recovery-share integrity is not separately verified beyond the AES-GCM authentication path.

## Recommended changes

- keep PBKDF2 as the benchmark baseline and preserve explicit metadata for the active KDF
- benchmark Argon2id separately using a browser-compatible implementation
- add structured research exports for JSON and CSV
- document result reproducibility explicitly
- consider future keyed metadata signing if the project evolves beyond a local prototype
- keep the current authentication checks intact and avoid weakening AES-GCM validation

## Verdict

The current implementation is a sensible browser-native vault prototype with a clear encrypted key hierarchy, authenticating AES-GCM wrapper logic, and threshold-based recovery. It is not a formal cryptographic protocol and should be assessed as a research prototype rather than a production security claim.
const parsed = vaultBlobV1Schema.safeParse(json)
```

**Finding — SA-17 (Export Copies Encrypted Blob):** Export copies the encrypted vault blob (JSON) to clipboard. Since the blob is encrypted, this is safe provided the clipboard is not monitored by malware.

**Finding — SA-18 (Import Validates Schema):** Import validates the incoming JSON against the Zod schema before saving. This prevents trivially malformed data from being stored. ✓

**Finding — SA-19 (Import Replaces Without Confirmation):** Import replaces the existing vault without confirmation beyond the browser `prompt()` dialog. A user could accidentally overwrite their vault.

**Severity:** Low (UX issue, not security)

---

## 13. Plaintext Exposure Points

| Location | Exposure | Duration |
|---|---|---|
| `vault.ts:31` | Vault data serialized to JSON before encryption | Momentary (in memory) |
| `vault.ts:41` | Decrypted JSON parsed from plaintext | In memory while vault is unlocked |
| `App.tsx:62` | Decrypted entries accessible via React state | While vault is unlocked |
| `App.tsx:365` | Password copied to clipboard via `navigator.clipboard` | Until clipboard is overwritten |
| `crypto.ts:35` | Master password converted to bytes | Momentary (passed to WebCrypto) |
| `vault.ts:59` | Vault key in memory as `Uint8Array` | While vault is unlocked |

**Finding — SA-20 (In-Memory Plaintext):** While the vault is unlocked, plaintext passwords, the vault key, and the master KEK (briefly) exist in JavaScript memory. This is unavoidable in a browser-based implementation. JavaScript does not provide secure memory primitives (no `mlock`, no zeroing guarantees due to GC).

**Severity:** Medium (inherent browser limitation, no mitigation possible in JavaScript)

---

## 14. Possible Attack Surfaces

### A1 — Stolen Device
An attacker with access to the device can read the IndexedDB data. They obtain the encrypted vault blob. They must still derive the master KEK (requiring the password) or reconstruct the recovery key (requiring k shares).

### A2 — Offline Brute Force
An attacker with the encrypted blob can attempt offline password guessing. Defense: PBKDF2 with 310,000 iterations. At approximately 3ms per derivation (modern hardware), an attacker can attempt ~333 passwords/second. A 40-bit entropy password would take ~34 years.

### A3 — XSS / Malicious JavaScript
If an attacker injects JavaScript into the page, they can:
- Read the encrypted blob from IndexedDB
- Intercept the master password during entry
- Read decrypted vault data from React state while unlocked

### A4 — Supply Chain Attack
Compromised npm packages (`shamirs-secret-sharing`, `idb-keyval`, etc.) could exfiltrate data. Mitigation: lockfile pinning, regular audits.

### A5 — Clipboard Monitoring
Exported vault JSON and copied passwords are placed on the system clipboard, which is accessible to other applications.

---

## 15. Current Weaknesses

| ID | Description | Severity | Status |
|---|---|---|---|
| SA-01 | Type named `Argon2idParams` but implementation is PBKDF2 | Medium | To fix |
| SA-06 | PBKDF2 iterations (310k) below OWASP recommendation (600k) | Low-Medium | Configurable for research |
| SA-12 | No Shamir share integrity verification | Low | Accepted (AES-GCM detects) |
| SA-13 | Recovery does not rotate recovery key/shares | Medium | Document |
| SA-16 | IndexedDB accessible to same-origin scripts | Medium | Inherent limitation |
| SA-19 | Import replaces vault without confirmation | Low | UX improvement |
| SA-20 | Plaintext in JavaScript memory while unlocked | Medium | Inherent limitation |

---

## 16. Recommended Changes

### Immediate (Security)
1. **Rename `Argon2idParams` to `KdfParams`** to accurately reflect the implementation
2. **Make KDF configurable** for research benchmarking
3. **Add entry deletion** (currently can only add/update)
4. **Clear sensitive state on lock** (zero out vault key bytes if possible)

### Research Additions
5. **Add Argon2id as an optional KDF** (via WASM, e.g., `argon2-browser` or `hash-wasm`)
6. **KDF benchmarking framework** for PBKDF2 vs Argon2id comparison
7. **Shamir threshold evaluation** for various (k, n) configurations
8. **Tamper detection experiments** validating AES-GCM authentication
9. **Vault performance benchmarks** at various entry counts
10. **Key rotation verification** tests

### Documentation
11. **Threat model** documenting what the system protects against
12. **Cryptographic design** documenting the key hierarchy
13. **Experiment protocol** for reproducibility

---

## 17. Unused Dependencies

| Package | Status |
|---|---|
| `@noble/ciphers` | Listed in `package.json` but **not imported** in any source file |
| `@noble/hashes` | Listed in `package.json` but **not imported** in any source file |
| `counter.ts` | Vite boilerplate, not used by the application |

**Recommendation:** Remove unused dependencies unless they will be used for Argon2id or additional cipher implementations.

---

## Summary

The existing implementation is **fundamentally sound** in its cryptographic design:
- Correct use of AES-GCM with proper nonce handling
- Sound independent vault-key architecture
- Proper CSPRNG usage throughout
- Schema validation on data load
- Working Shamir Secret Sharing recovery

The primary issues are:
1. **Misleading type naming** (Argon2id label on PBKDF2)
2. **Below-recommended KDF parameters** (310k vs 600k iterations)
3. **Inherent browser-based limitations** (memory exposure, XSS surface)

None of these are critical vulnerabilities — the system provides meaningful security for its threat model.
