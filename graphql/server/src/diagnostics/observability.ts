import { getConstructiveEnvOptions } from '@constructive-io/graphql-env';
import type { ConstructiveOptions } from '@constructive-io/graphql-types';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1']);

const normalizeHost = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('[')) {
    const closingIndex = trimmed.indexOf(']');
    return closingIndex === -1 ? trimmed : trimmed.slice(0, closingIndex + 1);
  }

  const colonCount = trimmed.split(':').length - 1;
  if (colonCount === 1) {
    return trimmed.split(':')[0] || null;
  }

  return trimmed;
};

const normalizeAddress = (value: string | null | undefined): string | null => {
  const normalized = normalizeHost(value);
  if (!normalized) {
    return null;
  }

  return normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized;
};

const resolveOptions = (opts?: ConstructiveOptions): ConstructiveOptions =>
  opts ?? getConstructiveEnvOptions();

export const isDevelopmentObservabilityMode = (opts?: ConstructiveOptions): boolean =>
  resolveOptions(opts).runtime?.nodeEnv === 'development';

export const isLoopbackHost = (value: string | null | undefined): boolean => {
  const normalized = normalizeHost(value);
  return normalized != null && LOOPBACK_HOSTS.has(normalized);
};

export const isLoopbackAddress = (value: string | null | undefined): boolean => {
  const normalized = normalizeAddress(value);
  return normalized != null && LOOPBACK_ADDRESSES.has(normalized);
};

export const isGraphqlObservabilityRequested = (opts?: ConstructiveOptions): boolean =>
  resolveOptions(opts).observability?.enabled ?? false;

export const isGraphqlObservabilityEnabled = (serverHost?: string | null, opts?: ConstructiveOptions): boolean =>
  isDevelopmentObservabilityMode(opts) &&
  isGraphqlObservabilityRequested(opts) &&
  isLoopbackHost(serverHost);

export const isGraphqlDebugSamplerEnabled = (serverHost?: string | null, opts?: ConstructiveOptions): boolean =>
  isGraphqlObservabilityEnabled(serverHost, opts) &&
  (resolveOptions(opts).observability?.debugSamplerEnabled ?? true);
