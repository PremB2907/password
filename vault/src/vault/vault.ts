import { Buffer, combine, split } from 'shamirs-secret-sharing'
import { type VaultBlobV1, type VaultData, vaultDataSchema } from './schema'
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  b64ToBytes,
  bytesToB64,
  deriveMasterKek,
  randomBytes,
  utf8ToBytes,
  bytesToUtf8,
  type Argon2idParams,
} from './crypto'

export type UnlockedVault = {
  vaultKey: Uint8Array
  data: VaultData
}

const DEFAULT_KDF: Omit<Argon2idParams, 'salt'> = { iterations: 310_000, dkLen: 32 }

function now(): number {
  return Date.now()
}

function newId(): string {
  return crypto.randomUUID()
}

async function encryptVaultData(vaultKey: Uint8Array, data: VaultData) {
  const bytes = utf8ToBytes(JSON.stringify(data))
  return aesGcmEncrypt(vaultKey, bytes)
}

async function decryptVaultData(vaultKey: Uint8Array, blob: VaultBlobV1): Promise<VaultData> {
  const pt = await aesGcmDecrypt(
    vaultKey,
    b64ToBytes(blob.payload.nonceB64),
    b64ToBytes(blob.payload.ctB64),
  )
  const json = JSON.parse(bytesToUtf8(pt)) as unknown
  const parsed = vaultDataSchema.safeParse(json)
  if (!parsed.success) throw new Error('Invalid vault payload')
  return parsed.data
}

export async function createNewVault(input: {
  masterPassword: string
  shares: number
  threshold: number
}): Promise<{ blob: VaultBlobV1; recoveryShares: string[]; unlocked: UnlockedVault }> {
  const createdAt = now()

  const salt = randomBytes(16)
  const kdfParams: Argon2idParams = { salt, ...DEFAULT_KDF }
  const masterKek = await deriveMasterKek(input.masterPassword, kdfParams)

  // Random vault key used to encrypt the entire vault payload.
  const vaultKey = randomBytes(32)

  // Random recovery key (will be split to shares). Used only to unwrap vaultKey.
  const recoveryKey = randomBytes(32)

  const wrapMaster = await aesGcmEncrypt(masterKek, vaultKey)
  const wrapRecovery = await aesGcmEncrypt(recoveryKey, vaultKey)

  const initialData: VaultData = { entries: [] }
  const payload = await encryptVaultData(vaultKey, initialData)

  const blob: VaultBlobV1 = {
    version: 1,
    createdAt,
    kdf: {
      name: 'pbkdf2-sha256',
      saltB64: bytesToB64(salt),
      iterations: kdfParams.iterations,
      dkLen: kdfParams.dkLen,
    },
    wrap: {
      master: { nonceB64: bytesToB64(wrapMaster.nonce), ctB64: bytesToB64(wrapMaster.ciphertext) },
      recovery: {
        nonceB64: bytesToB64(wrapRecovery.nonce),
        ctB64: bytesToB64(wrapRecovery.ciphertext),
      },
    },
    payload: { nonceB64: bytesToB64(payload.nonce), ctB64: bytesToB64(payload.ciphertext) },
  }

  const shares = split(Buffer.from(recoveryKey), {
    shares: input.shares,
    threshold: input.threshold,
  }).map((b: Buffer) => b.toString('hex'))

  return { blob, recoveryShares: shares, unlocked: { vaultKey, data: initialData } }
}

export async function decryptVaultWithMasterPassword(
  blob: VaultBlobV1,
  masterPassword: string,
): Promise<UnlockedVault> {
  const masterKek = await deriveMasterKek(masterPassword, {
    salt: b64ToBytes(blob.kdf.saltB64),
    iterations: blob.kdf.iterations,
    dkLen: blob.kdf.dkLen,
  })

  const vaultKey = await aesGcmDecrypt(
    masterKek,
    b64ToBytes(blob.wrap.master.nonceB64),
    b64ToBytes(blob.wrap.master.ctB64),
  )

  const data = await decryptVaultData(vaultKey, blob)
  return { vaultKey, data }
}

export async function recoverVaultWithSharesAndRotateMasterPassword(
  blob: VaultBlobV1,
  input: { shares: string[]; newMasterPassword: string },
): Promise<{ newBlob: VaultBlobV1; unlocked: UnlockedVault }> {
  const recovered = combine(input.shares.map((s) => Buffer.from(s.trim(), 'hex')))
  const recoveryKey = Uint8Array.from(recovered)

  const vaultKey = await aesGcmDecrypt(
    recoveryKey,
    b64ToBytes(blob.wrap.recovery.nonceB64),
    b64ToBytes(blob.wrap.recovery.ctB64),
  )

  const data = await decryptVaultData(vaultKey, blob)

  // Rotate master password: generate new salt + rewrap vaultKey under new master KEK.
  const newSalt = randomBytes(16)
  const kdfParams: Argon2idParams = { salt: newSalt, ...DEFAULT_KDF }
  const newMasterKek = await deriveMasterKek(input.newMasterPassword, kdfParams)
  const wrapMaster = await aesGcmEncrypt(newMasterKek, vaultKey)

  const newBlob: VaultBlobV1 = {
    ...blob,
    kdf: {
      name: 'pbkdf2-sha256',
      saltB64: bytesToB64(newSalt),
      iterations: kdfParams.iterations,
      dkLen: kdfParams.dkLen,
    },
    wrap: {
      master: { nonceB64: bytesToB64(wrapMaster.nonce), ctB64: bytesToB64(wrapMaster.ciphertext) },
      recovery: blob.wrap.recovery,
    },
  }

  return { newBlob, unlocked: { vaultKey, data } }
}

export async function upsertEntryAndSave(
  unlocked: UnlockedVault,
  blob: VaultBlobV1,
  input: { title: string; username: string; password: string },
): Promise<{ newUnlocked: UnlockedVault; newBlob: VaultBlobV1 }> {
  const ts = now()
  const next = structuredClone(unlocked.data) as VaultData
  const existing = next.entries.find((e) => e.title === input.title && e.username === input.username)

  if (existing) {
    existing.password = input.password
    existing.updatedAt = ts
  } else {
    next.entries.push({
      id: newId(),
      title: input.title,
      username: input.username,
      password: input.password,
      createdAt: ts,
      updatedAt: ts,
    })
  }

  const payload = await encryptVaultData(unlocked.vaultKey, next)
  const newBlob: VaultBlobV1 = {
    ...blob,
    payload: { nonceB64: bytesToB64(payload.nonce), ctB64: bytesToB64(payload.ciphertext) },
  }

  return { newUnlocked: { ...unlocked, data: next }, newBlob }
}

