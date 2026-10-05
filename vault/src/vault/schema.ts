import { z } from 'zod'

export const vaultEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  username: z.string(),
  password: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export type VaultEntry = z.infer<typeof vaultEntrySchema>

export const vaultDataSchema = z.object({
  entries: z.array(vaultEntrySchema),
})

export type VaultData = z.infer<typeof vaultDataSchema>

export const vaultBlobV1Schema = z.object({
  version: z.literal(1),
  createdAt: z.number(),
  // KDF params for master password -> master KEK (key-encryption-key)
  kdf: z.object({
    name: z.literal('pbkdf2-sha256'),
    saltB64: z.string(),
    iterations: z.number().int().positive(),
    dkLen: z.number().int().positive(),
  }),
  // Encrypted vault KEK wrapping and encrypted vault payload.
  wrap: z.object({
    // vaultKey encrypted under master KEK
    master: z.object({
      nonceB64: z.string(),
      ctB64: z.string(),
    }),
    // vaultKey encrypted under recovery key (reconstructed from shares)
    recovery: z.object({
      nonceB64: z.string(),
      ctB64: z.string(),
    }),
  }),
  payload: z.object({
    nonceB64: z.string(),
    ctB64: z.string(),
  }),
})

export type VaultBlobV1 = z.infer<typeof vaultBlobV1Schema>

