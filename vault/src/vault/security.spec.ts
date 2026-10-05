import { describe, it, expect } from 'vitest'
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  bytesToHexStr,
  deriveMasterKek,
  randomBytes,
} from './crypto'
import { benchmarkWrongPasswordSimulation } from '../research'
import { createNewVault, decryptVaultWithMasterPassword, recoverVaultWithSharesAndRotateMasterPassword } from './vault'

describe('cryptography', () => {
  it('encrypts and decrypts with AES-GCM', async () => {
    const key = randomBytes(32)
    const plaintext = new TextEncoder().encode('hello vault')

    const encrypted = await aesGcmEncrypt(key, plaintext)
    const decrypted = await aesGcmDecrypt(key, encrypted.nonce, encrypted.ciphertext)

    expect(new TextDecoder().decode(decrypted)).toBe('hello vault')
  })

  it('rejects tamper changes to ciphertext and nonce', async () => {
    const key = randomBytes(32)
    const plaintext = new TextEncoder().encode('tamper test')
    const encrypted = await aesGcmEncrypt(key, plaintext)

    const ciphertext = new Uint8Array(encrypted.ciphertext)
    ciphertext[0] ^= 0x01

    await expect(aesGcmDecrypt(key, encrypted.nonce, ciphertext)).rejects.toThrow()

    const nonce = new Uint8Array(encrypted.nonce)
    nonce[0] ^= 0x01
    await expect(aesGcmDecrypt(key, nonce, encrypted.ciphertext)).rejects.toThrow()
  })

  it('derives deterministic keys for the same inputs', async () => {
    const salt = randomBytes(16)
    const params = { name: 'pbkdf2-sha256' as const, salt, iterations: 310_000, dkLen: 32 }

    const first = await deriveMasterKek('Password!123', params)
    const second = await deriveMasterKek('Password!123', params)

    expect(bytesToHexStr(first)).toBe(bytesToHexStr(second))
  })
})

describe('shamir recovery', () => {
  it('recovers at threshold and fails below threshold', async () => {
    const created = await createNewVault({
      masterPassword: 'OriginalPassword!123',
      shares: 3,
      threshold: 2,
    })

    const recovered = await recoverVaultWithSharesAndRotateMasterPassword(created.blob, {
      shares: created.recoveryShares.slice(0, 2),
      newMasterPassword: 'NewPassword!456',
    })

    expect(recovered.newBlob.version).toBe(1)
    await expect(
      recoverVaultWithSharesAndRotateMasterPassword(created.blob, {
        shares: created.recoveryShares.slice(0, 1),
        newMasterPassword: 'NewPassword!456',
      }),
    ).rejects.toThrow()
  })
})

describe('vault lifecycle', () => {
  it('creates, unlocks, and rotates master password with recovery shares', async () => {
    const created = await createNewVault({
      masterPassword: 'OriginalPassword!123',
      shares: 3,
      threshold: 2,
    })

    const unlocked = await decryptVaultWithMasterPassword(created.blob, 'OriginalPassword!123')
    expect(unlocked.data.entries).toHaveLength(0)

    const recovered = await recoverVaultWithSharesAndRotateMasterPassword(created.blob, {
      shares: created.recoveryShares.slice(0, 2),
      newMasterPassword: 'NewPassword!456',
    })

    const rotated = await decryptVaultWithMasterPassword(recovered.newBlob, 'NewPassword!456')
    expect(rotated.data.entries).toHaveLength(0)

    await expect(decryptVaultWithMasterPassword(recovered.newBlob, 'OriginalPassword!123')).rejects.toThrow()
  })

  it('records failed wrong-password attempts without aborting the benchmark', async () => {
    const report = await benchmarkWrongPasswordSimulation()

    expect(report.experiment).toBe('wrong-password-offline-simulation')
    expect(report.metrics.attempts).toBeGreaterThan(0)
    expect(Array.isArray(report.metrics.timingsMs)).toBe(true)
  })
})
