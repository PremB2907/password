import { Buffer, combine, split } from 'shamirs-secret-sharing'
import { type VaultBlobV1, type VaultData, vaultDataSchema } from './schema'
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  b64ToBytes,
  bytesToB64,
  bytesToUtf8,
  deriveMasterKek,
  randomBytes,
  type KdfParams,
  type Pbkdf2Params,
  utf8ToBytes,
} from './crypto'

export type UnlockedVault = {
  vaultKey: Uint8Array
  data: VaultData
}

const DEFAULT_KDF: Omit<Pbkdf2Params, 'salt'> = {
  name: 'pbkdf2-sha256',
  iterations: 310_000,
  dkLen: 32,
}

function now(): number {
  return Date.now()
}

function newId(): string {
  return crypto.randomUUID()
}

export type EncryptedVaultPayload = VaultBlobV1['payload']

export async function encryptVaultPayload(
  vaultKey: Uint8Array,
  data: VaultData,
): Promise<EncryptedVaultPayload> {
  const bytes = utf8ToBytes(JSON.stringify(data))
  const encrypted = await aesGcmEncrypt(vaultKey, bytes)
  return {
    nonceB64: bytesToB64(encrypted.nonce),
    ctB64: bytesToB64(encrypted.ciphertext),
  }
}

export async function decryptVaultPayload(
  vaultKey: Uint8Array,
  payload: EncryptedVaultPayload,
): Promise<VaultData> {
  const pt = await aesGcmDecrypt(
    vaultKey,
    b64ToBytes(payload.nonceB64),
    b64ToBytes(payload.ctB64),
  )
  const json = JSON.parse(bytesToUtf8(pt)) as unknown
  const parsed = vaultDataSchema.safeParse(json)
  if (!parsed.success) throw new Error('Invalid vault payload')
  return parsed.data
}

function toKdfParams(salt: Uint8Array, kdf: VaultBlobV1['kdf']): KdfParams {
  if (kdf.name === 'argon2id') {
    return {
      name: 'argon2id',
      salt,
      iterations: kdf.iterations,
      memorySize: kdf.memorySize ?? 65536,
      parallelism: kdf.parallelism ?? 1,
      dkLen: kdf.dkLen,
    }
  }

  return {
    name: 'pbkdf2-sha256',
    salt,
    iterations: kdf.iterations,
    dkLen: kdf.dkLen,
  }
}

export async function createNewVault(input: {
  masterPassword: string
  shares: number
  threshold: number
  kdf?: KdfParams
}): Promise<{ blob: VaultBlobV1; recoveryShares: string[]; unlocked: UnlockedVault }> {
  const createdAt = now()

  const salt = randomBytes(16)
  const selectedKdf: KdfParams = input.kdf ?? { ...DEFAULT_KDF, name: 'pbkdf2-sha256', salt }
  const masterKek = await deriveMasterKek(input.masterPassword, selectedKdf)

  const vaultKey = randomBytes(32)
  const recoveryKey = randomBytes(32)

  const wrapMaster = await aesGcmEncrypt(masterKek, vaultKey)
  const wrapRecovery = await aesGcmEncrypt(recoveryKey, vaultKey)

  const initialData: VaultData = { entries: [] }
  const payload = await encryptVaultPayload(vaultKey, initialData)

  const blob: VaultBlobV1 = {
    version: 1,
    createdAt,
    kdf: {
      name: selectedKdf.name,
      saltB64: bytesToB64(salt),
      iterations: selectedKdf.iterations,
      dkLen: selectedKdf.dkLen,
      ...(selectedKdf.name === 'argon2id'
        ? { memorySize: selectedKdf.memorySize, parallelism: selectedKdf.parallelism }
        : {}),
    },
    wrap: {
      master: { nonceB64: bytesToB64(wrapMaster.nonce), ctB64: bytesToB64(wrapMaster.ciphertext) },
      recovery: {
        nonceB64: bytesToB64(wrapRecovery.nonce),
        ctB64: bytesToB64(wrapRecovery.ciphertext),
      },
    },
    payload,
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
  const salt = b64ToBytes(blob.kdf.saltB64)
  const masterKek = await deriveMasterKek(masterPassword, toKdfParams(salt, blob.kdf))

  const vaultKey = await aesGcmDecrypt(
    masterKek,
    b64ToBytes(blob.wrap.master.nonceB64),
    b64ToBytes(blob.wrap.master.ctB64),
  )

  const data = await decryptVaultPayload(vaultKey, blob.payload)
  return { vaultKey, data }
}

export async function recoverVaultWithSharesAndRotateMasterPassword(
  blob: VaultBlobV1,
  input: { shares: string[]; newMasterPassword: string; kdf?: KdfParams },
): Promise<{ newBlob: VaultBlobV1; unlocked: UnlockedVault }> {
  const recovered = combine(input.shares.map((s) => Buffer.from(s.trim(), 'hex')))
  const recoveryKey = Uint8Array.from(recovered)

  const vaultKey = await aesGcmDecrypt(
    recoveryKey,
    b64ToBytes(blob.wrap.recovery.nonceB64),
    b64ToBytes(blob.wrap.recovery.ctB64),
  )

  const data = await decryptVaultPayload(vaultKey, blob.payload)

  const newSalt = randomBytes(16)
  const selectedKdf: KdfParams = input.kdf ?? { ...DEFAULT_KDF, name: 'pbkdf2-sha256', salt: newSalt }
  const newMasterKek = await deriveMasterKek(input.newMasterPassword, selectedKdf)
  const wrapMaster = await aesGcmEncrypt(newMasterKek, vaultKey)

  const newBlob: VaultBlobV1 = {
    ...blob,
    kdf: {
      name: selectedKdf.name,
      saltB64: bytesToB64(newSalt),
      iterations: selectedKdf.iterations,
      dkLen: selectedKdf.dkLen,
      ...(selectedKdf.name === 'argon2id'
        ? { memorySize: selectedKdf.memorySize, parallelism: selectedKdf.parallelism }
        : {}),
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

  const payload = await encryptVaultPayload(unlocked.vaultKey, next)
  const newBlob: VaultBlobV1 = {
    ...blob,
    payload,
  }

  return { newUnlocked: { ...unlocked, data: next }, newBlob }
}

