/**
 * Node.js content hashing utility.
 *
 * Complements the browser-oriented `hashFile` (Web Crypto + File/Blob)
 * with a Node.js-native SHA-256 helper that accepts plain strings or
 * Buffers. Useful in tests, scripts, and server-side code.
 *
 * @example
 * ```typescript
 * import { hashContent } from '@constructive-io/upload-client';
 *
 * const hash = hashContent('hello world');
 * // "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
 * ```
 */

import { createHash } from 'crypto';

/**
 * Compute the SHA-256 hex digest of a string or Buffer.
 *
 * @param content - The content to hash
 * @returns 64-character lowercase hex string
 */
export function hashContent(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}
