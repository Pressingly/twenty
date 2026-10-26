import { buildSsoProxyLoginUrl } from '@/auth/utils/buildSsoProxyLoginUrl';

const base = 'https://crm.example.com';

describe('buildSsoProxyLoginUrl', () => {
  it('points at the proxy-login endpoint of the given base', () => {
    expect(buildSsoProxyLoginUrl(base, '')).toBe(
      'https://crm.example.com/auth/sso/proxy-login',
    );
  });

  it('forwards the target the sign-in page was sent with', () => {
    const url = new URL(
      buildSsoProxyLoginUrl(
        base,
        `?returnToPath=${encodeURIComponent('/authorize?client_id=abc#consent')}`,
      ),
    );

    expect(url.searchParams.get('returnToPath')).toBe(
      '/authorize?client_id=abc#consent',
    );
  });

  it('never forwards a target pointing back at the sign-in page', () => {
    const url = new URL(
      buildSsoProxyLoginUrl(
        base,
        `?returnToPath=${encodeURIComponent('/welcome?x=1')}`,
      ),
    );

    expect(url.searchParams.has('returnToPath')).toBe(false);
  });

  it('never forwards an external target', () => {
    const url = new URL(
      buildSsoProxyLoginUrl(base, '?returnToPath=%2F%2Fevil.com'),
    );

    expect(url.searchParams.has('returnToPath')).toBe(false);
  });
});
