import { argon2id } from 'hash-wasm'

export function utf8ToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

export function bytesToUtf8(b: Uint8Array): string {
  return new TextDecoder().decode(b)
}

export function randomBytes(len: number): Uint8Array {
  const b = new Uint8Array(len)
  crypto.getRandomValues(b)
  return b
}

export function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin)
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export type Pbkdf2Params = {
  name: 'pbkdf2-sha256'
  salt: Uint8Array
  iterations: number
  dkLen: number
}

export type Argon2idParams = {
  name: 'argon2id'
  salt: Uint8Array
  iterations: number
  memorySize: number
  parallelism: number
  dkLen: number
}

export type KdfParams = Pbkdf2Params | Argon2idParams

export async function derivePasswordKey(password: string, params: KdfParams): Promise<Uint8Array> {
  if (params.name === 'pbkdf2-sha256') {
    const pw = Uint8Array.from(utf8ToBytes(password))
    const baseKey = await crypto.subtle.importKey('raw', pw, 'PBKDF2', false, ['deriveBits'])
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: Uint8Array.from(params.salt),
        iterations: params.iterations,
      },
      baseKey,
      params.dkLen * 8,
    )
    return new Uint8Array(bits)
  }

  const hashHex = await argon2id({
    password,
    salt: bytesToHexStr(params.salt),
    iterations: params.iterations,
    memorySize: params.memorySize,
    parallelism: params.parallelism,
    hashLength: params.dkLen,
    outputType: 'hex',
  })
  return hexStrToBytes(hashHex)
}

export async function deriveMasterKek(password: string, params: KdfParams): Promise<Uint8Array> {
  return derivePasswordKey(password, params)
}

async function importAesGcmKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  const k = Uint8Array.from(keyBytes)
  return crypto.subtle.importKey('raw', k, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function aesGcmEncrypt(keyBytes: Uint8Array, plaintext: Uint8Array): Promise<{
  nonce: Uint8Array
  ciphertext: Uint8Array
}> {
  const nonce = randomBytes(12)
  const key = await importAesGcmKey(keyBytes)
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: Uint8Array.from(nonce) },
    key,
    Uint8Array.from(plaintext),
  )
  return { nonce, ciphertext: new Uint8Array(ct) }
}

export async function aesGcmDecrypt(
  keyBytes: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const key = await importAesGcmKey(keyBytes)
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Uint8Array.from(nonce) },
    key,
    Uint8Array.from(ciphertext),
  )
  return new Uint8Array(pt)
}

// secrets.js wants hex strings.
export function bytesToHexStr(b: Uint8Array): string {
  let s = ''
  for (const n of b) s += n.toString(16).padStart(2, '0')
  return s
}

export function hexStrToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase()
  if (clean.length % 2 !== 0) throw new Error('Invalid hex')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

