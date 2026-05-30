/**
 * Accept-Language middleware for PostGraphile v5
 *
 * Parses the Accept-Language header and injects `langCodes` into the
 * GraphQL context so the i18n plugin can resolve the best translation.
 */

import * as acceptLanguageParser from 'accept-language-parser';

/**
 * Extract the Accept-Language header from a request object.
 * Supports Express (req.get) and raw Node.js (req.headers).
 */
function getAcceptLanguageHeader(req: any): string | undefined {
  if (!req) return undefined;
  const header = typeof req.get === 'function'
    ? req.get('accept-language')
    : req.headers?.['accept-language'];
  return Array.isArray(header) ? header.join(',') : header;
}

export interface I18nMiddlewareOptions {
  /**
   * Supported languages for Accept-Language negotiation.
   * @default ['en']
   */
  supportedLanguages?: string[];
}

/**
 * PostGraphile v5 additionalGraphQLContextFromRequest function.
 *
 * Parses Accept-Language and injects `langCodes` into the GraphQL context.
 *
 * @example
 * ```typescript
 * import { makeI18nContext } from 'graphile-i18n';
 *
 * const preset = {
 *   grafast: {
 *     context: makeI18nContext({ supportedLanguages: ['en', 'es', 'fr'] }),
 *   },
 * };
 * ```
 */
export function makeI18nContext(options: I18nMiddlewareOptions = {}) {
  const { supportedLanguages = ['en'] } = options;

  return async (req: any, _res: any) => {
    const acceptLanguage = getAcceptLanguageHeader(req);
    const picked = acceptLanguage
      ? acceptLanguageParser.pick(supportedLanguages, acceptLanguage)
      : null;

    const langCodes = picked ? [picked] : [supportedLanguages[0]];

    return { langCodes };
  };
}

/**
 * Convenience export matching the v4 API signature.
 */
export const additionalGraphQLContextFromRequest = makeI18nContext();
