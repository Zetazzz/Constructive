/**
 * String content hashing using Web Crypto API.
 *
 * Complements `hashFile` (which accepts File/Blob) with a convenience
 * function for hashing plain strings. Uses the same Web Crypto API —
 * no Node.js-only dependencies.
 *
 * @example
 * ```typescript
 * import { hashContent } from '@constructive-io/upload-client';
 *
 * const hash = await hashContent('hello world');
 * // "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
 * ```
 */

import { UploadError } from './types';

/**
 * Compute the SHA-256 hex digest of a string using Web Crypto API.
 *
 * @param content - The string content to hash
 * @returns 64-character lowercase hex string
 */
export async function hashContent(content: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const bytes = new Uint8Array(hashBuffer);
    const hex = new Array<string>(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      hex[i] = bytes[i].toString(16).padStart(2, '0');
    }
    return hex.join('');
  } catch (err) {
    throw new UploadError('HASH_FAILED', 'Failed to compute SHA-256 hash', err);
  }
}
