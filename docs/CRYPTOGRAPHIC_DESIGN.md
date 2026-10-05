# Cryptographic Design

This document describes the actual vault design currently implemented in the browser application and is limited to what the code does today.

## Key hierarchy

The application uses a layered key architecture:

Master Password
       |
       v
   KDF (PBKDF2-HMAC-SHA256 baseline)
       |
       v
     Master KEK (32 bytes)
       |
       v
 AES-GCM wrap of Vault Key
       |
       v
      Vault Key (32 bytes)
       |
       v
 AES-GCM encrypt vault JSON
       |
       v
     Encrypted Vault

Recovery path:

Recovery Secret
       |
       v
Shamir Secret Sharing (k-of-n)
       |
       v
    Recovery key shares
       |
       v
  Reconstruct recovery key
       |
       v
 AES-GCM unwrap the vault key
       |
       v
 Recover vault payload
       |
       v
Set new master password
       |
       v
  Re-wrap vault key under new KEK

## Master Password to KEK

The implementation derives a 32-byte key using PBKDF2-HMAC-SHA256 with a random 16-byte salt and a configurable iteration count. This is the current baseline and is explicitly labeled as such in the code and documentation.

The master password is transformed via WebCrypto into a raw key and then derived into a 256-bit key via PBKDF2 with SHA-256. The resulting value is used as the master KEK.

## Vault key

Each new vault creates a random 32-byte vault key. This key is independent of the user password and is the actual encryption key for the encrypted JSON payload.

The vault key is generated once and then encrypted under two separate wrappers:
- the master password-derived KEK
- a separate recovery key reconstructed from Shamir shares

This separation is intentional: it supports both ordinary access and threshold-based recovery while keeping the data-encryption key independent of the password-derived key.

## Recovery secret and Shamir shares

A random 32-byte recovery key is created for each vault. That key is split using the `shamirs-secret-sharing` library into `n` shares with threshold `k`.

The recovery key is not itself the vault key. It is used only to unwrap the vault key that was encrypted under the recovery key. The vault payload is encrypted with the vault key, not with the recovery key.

This distinction matters:
- recovery reconstructs the recovery key
- recovery key unwraps the vault key
- vault key decrypts the payload

The system does not directly reconstruct the payload from shares; it reconstructs the recovery key first, then unwraps the vault key, then decrypts the payload.

## AES-GCM usage

The implementation uses WebCrypto `AES-GCM` with 256-bit keys and random 12-byte nonces. Each encryption call generates a fresh nonce. The ciphertext is authenticated by the AES-GCM tag.

The vault payload and wrapped vault-key material are both encrypted with AES-GCM. Tampering with either encrypted unit causes authentication failure during decryption.

## Key rotation

When a user recovers with shares and sets a new password, the code creates a new salt, derives a new KEK from the new password, and re-wraps the existing vault key under the new KEK. The recovery wrap remains the same unless the recovery key is intentionally rotated separately.

This means the vault key itself remains stable across a password change. The rotation is therefore a master-password/key-wrapping rotation, not a payload re-encryption.

## Important limitation

The current design does not provide a formal zero-knowledge proof or a true end-to-end protocol definition. It provides a local browser implementation that encrypts vault content on the client before storing it in IndexedDB. This is not the same as a cryptographically proven zero-knowledge scheme.
