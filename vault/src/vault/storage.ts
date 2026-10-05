import { get, set, del } from 'idb-keyval'
import { vaultBlobV1Schema, type VaultBlobV1 } from './schema'

const KEY = 'zero-trust-vault-blob-v1'

export async function loadVaultBlob(): Promise<VaultBlobV1 | null> {
  const raw = (await get(KEY)) as unknown
  if (!raw) return null
  const parsed = vaultBlobV1Schema.safeParse(raw)
  if (!parsed.success) return null
  return parsed.data
}

export async function saveVaultBlob(blob: VaultBlobV1): Promise<void> {
  await set(KEY, blob)
}

export async function deleteVaultBlob(): Promise<void> {
  await del(KEY)
}

