const mockSetLogScopes = jest.fn();

jest.mock('@pgpmjs/logger', () => ({ setLogScopes: mockSetLogScopes }));

import { getConstructiveEnvOptions } from '../src';

describe('LOG_SCOPE application', () => {
  beforeEach(() => {
    mockSetLogScopes.mockClear();
  });

  it('applies an explicit resolved scope, including an explicit clear', () => {
    getConstructiveEnvOptions(
      { runtime: { logScope: 'api, ^jobs' } },
      process.cwd(),
      {}
    );
    expect(mockSetLogScopes).toHaveBeenLastCalledWith(['api', '^jobs']);

    getConstructiveEnvOptions({ runtime: { logScope: '' } }, process.cwd(), {});
    expect(mockSetLogScopes).toHaveBeenLastCalledWith([]);
  });

  it('does not erase an earlier scope when a nested resolver has no scope', () => {
    getConstructiveEnvOptions(
      { runtime: { logScope: 'only' } },
      process.cwd(),
      {}
    );
    expect(mockSetLogScopes).toHaveBeenCalledTimes(1);

    getConstructiveEnvOptions({}, process.cwd(), {});
    expect(mockSetLogScopes).toHaveBeenCalledTimes(1);
  });

  it('does not downgrade a runtime override during a later process-env resolution', () => {
    const previousLogScope = process.env.LOG_SCOPE;
    process.env.LOG_SCOPE = 'from-process-env';

    try {
      getConstructiveEnvOptions(
        { runtime: { logScope: 'from-runtime-override' } },
        process.cwd(),
        process.env
      );
      expect(mockSetLogScopes).toHaveBeenLastCalledWith([
        'from-runtime-override',
      ]);

      getConstructiveEnvOptions();
      expect(mockSetLogScopes).toHaveBeenCalledTimes(1);
    } finally {
      if (previousLogScope === undefined) delete process.env.LOG_SCOPE;
      else process.env.LOG_SCOPE = previousLogScope;
    }
  });
});
