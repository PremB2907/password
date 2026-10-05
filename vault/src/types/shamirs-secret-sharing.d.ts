declare module 'shamirs-secret-sharing' {
  export class Buffer extends Uint8Array {
    static from(input: unknown, encoding?: string): Buffer
    toString(encoding?: string): string
  }

  export function split(
    input: string | ArrayBuffer | Uint8Array,
    options: { shares: number; threshold: number; random?: (n: number) => Buffer },
  ): Buffer[]

  export function combine(shares: Array<string | ArrayBuffer | Uint8Array>): Buffer
}

