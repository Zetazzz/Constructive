import type { ApiStructure } from '../types';

export type ConstructiveAPIToken = {
  id?: string;
  user_id?: string;
  [key: string]: unknown;
};

declare global {
  namespace Express {
    interface Request {
      api?: ApiStructure;
      svc_key?: string;
      clientIp?: string;
      databaseId?: string;
      requestId?: string;
      token?: ConstructiveAPIToken;
      /**
       * Per-request SQL text transform for multi-tenancy schema remapping.
       * When set, replaces `__pgmt_<schema>__` placeholders in compiled SQL
       * with the real tenant schema names at execution time.
       */
      sqlTextTransform?: ((text: string) => string) | null;
    }
  }
}
