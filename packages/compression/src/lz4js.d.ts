declare module 'lz4js' {
  /** Compress bytes into a full LZ4 frame. */
  export function compress(data: Uint8Array): Uint8Array
  /** Decompress an LZ4 frame back into bytes. */
  export function decompress(data: Uint8Array): Uint8Array
}
