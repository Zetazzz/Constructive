import { getSafeConfigForLog } from '../src/utils';

describe('getSafeConfigForLog', () => {
  it('keeps operational fields and excludes aggregate credentials', () => {
    const safe = getSafeConfigForLog({
      pg: {
        host: 'db.internal',
        database: 'app',
        user: 'app_user',
        password: 'PG_PASSWORD_MARKER',
      },
      server: { host: 'localhost', port: 3000 },
      graphile: {
        schema: ['app_public'],
        preset: { secretMarker: 'GRAPHILE_PRESET_MARKER' } as never,
      },
      mailgun: { key: 'MAILGUN_KEY_MARKER' },
      smtp: { pass: 'SMTP_PASSWORD_MARKER' },
      graphqlClient: { authToken: 'GRAPHQL_TOKEN_MARKER' },
      captcha: { recaptchaSecretKey: 'CAPTCHA_SECRET_MARKER' },
      cdn: {
        awsAccessKey: 'AWS_ACCESS_MARKER',
        awsSecretKey: 'AWS_SECRET_MARKER',
      },
    });

    const output = JSON.stringify(safe);
    expect(output).toContain('db.internal');
    expect(output).toContain('localhost');
    expect(output).toContain('app_public');
    expect(output).not.toMatch(/_MARKER/);
  });
});
