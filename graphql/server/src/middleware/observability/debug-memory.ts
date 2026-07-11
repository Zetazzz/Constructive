import { Logger } from '@pgpmjs/logger';
import type { RequestHandler } from 'express';
import type { ConstructiveNodeEnv } from '@constructive-io/graphql-types';
import { getDebugMemorySnapshot } from '../../diagnostics/debug-memory-snapshot';

const log = new Logger('debug-memory');

export const createDebugMemoryMiddleware = (
  nodeEnv?: ConstructiveNodeEnv
): RequestHandler => (_req, res) => {
  const response = getDebugMemorySnapshot(nodeEnv);

  log.debug('Memory snapshot:', response);
  res.json(response);
};

export const debugMemory: RequestHandler = createDebugMemoryMiddleware();
