# Threat Model

This document defines the threat model for the current browser-based password vault prototype. The system is designed as a local, offline vault with encryption on the client and no remote database; the model below therefore focuses on local compromise, offline guessing, cryptographic tampering, and browser execution risks.

## A1 - Stolen Device

Attacker obtains the local encrypted vault data from a laptop, workstation, or browser profile.

Protection status:
- The vault blob is stored in IndexedDB and is encrypted at rest with AES-GCM.
- The attacker cannot read plaintext vault entries without the master password or the recovery secret material.
- If the master password is strong and uncompromised, the local encrypted blob alone is not sufficient to decrypt the vault content.

Limitations:
- If the attacker also steals an unlocked browser session or the master password from memory, the vault can be accessed.
- The browser environment itself is not a secure hardware enclave; memory exposure remains a practical risk.

## A2 - Offline Attacker

Attacker obtains the encrypted vault and attempts password guessing offline.

Protection status:
- The active baseline KDF is PBKDF2-HMAC-SHA256 with a configurable iteration count.
- The key derivation uses a unique per-vault salt and a 32-byte key length.
- Guessing remains expensive and scales with the configured work factor.

Limitations:
- A weak master password remains vulnerable to offline guessing.
- The model assumes the attacker does not obtain the password through another channel.
- The implementation does not include rate limiting or account lockouts because the vault is local-only.

## A3 - Partial Recovery Share Compromise

Attacker obtains fewer than k Shamir shares.

Protection status:
- The system does not reconstruct the recovery secret unless enough shares are present.
- Fewer than k shares are insufficient for vault-key recovery.

Limitations:
- An attacker who obtains some shares but not enough cannot decrypt the vault key directly.
- The design does not provide share integrity signatures beyond AES-GCM authentication on the wrapped recovery material.

## A4 - Recovery Share Compromise

Attacker obtains at least k shares.

Protection status:
- The attacker can reconstruct the recovery secret and unwrap the vault key from the recovery-wrapped material.
- This is an intentional capability of threshold recovery.

Limitations:
- This is a valid recovery path and therefore not a compromise of confidentiality if the attacker possesses the required shares.
- The system does not attempt to hide the fact that recovery shares can reconstruct the recovery secret.

## A5 - Vault Tampering

Attacker modifies encrypted vault data or wrapped key material.

Protection status:
- AES-GCM authentication tags verify data integrity and authenticity.
- Modified ciphertext, nonce, or wrapped-key material will fail decryption.
- The implementation treats such tampering as a decryption failure.

Limitations:
- The storage layer does not provide signed metadata beyond the authenticated ciphertext and nonce structure.
- Authentication failures are not used to distinguish between malicious and accidental corruption beyond a generic error.

## A6 - Wrong Password

Repeated incorrect password attempts.

Protection status:
- Each failed password attempt derives a candidate KEK and attempts to unwrap the vault key.
- The system fails closed on wrong-password attempts by rejecting decryption.

Limitations:
- Offline password guessing can still be attempted if the attacker has the encrypted blob and a local device.
- The implementation does not include anti-guessing lockouts or hardware-backed throttling.

## A7 - Malicious Runtime / XSS

Attacker executes attacker-controlled JavaScript in the same origin as the vault application.

Protection status:
- The vault data is encrypted and stored in IndexedDB; script execution alone does not reveal plaintext entries.
- The system relies on browser origin isolation and the integrity of the application code.

Limitations:
- Any XSS or malicious browser extension with access to the page context can read local plaintext in memory while the vault is unlocked.
- Browser-based password vaults are inherently exposed to same-origin script compromise.
- The vault does not defend against a malicious page that runs in the same JS context as the vault UI.

## Summary

The architecture provides partial but meaningful protections against stolen encrypted data, partial share compromise, and tampering. It does not claim to defend against a malicious runtime environment, a weak master password, or a privileged attacker who obtains the master credential or a sufficient set of recovery shares.
