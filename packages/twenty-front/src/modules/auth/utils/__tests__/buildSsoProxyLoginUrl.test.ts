import { buildSsoProxyLoginUrl } from '@/auth/utils/buildSsoProxyLoginUrl';

const base = 'https://crm.example.com';

describe('buildSsoProxyLoginUrl', () => {
  it('points at the proxy-login endpoint of the given base', () => {
    expect(
      buildSsoProxyLoginUrl(base, { pathname: '/', search: '', hash: '' }),
    ).toBe('https://crm.example.com/auth/sso/proxy-login');
  });

  it('carries the current path, query and hash as returnToPath', () => {
    const url = new URL(
      buildSsoProxyLoginUrl(base, {
        pathname: '/authorize',
        search: '?client_id=abc',
        hash: '#consent',
      }),
    );

    expect(url.searchParams.get('returnToPath')).toBe(
      '/authorize?client_id=abc#consent',
    );
  });

  it.each(['/welcome', '/welcome/', '/welcome/sub'])(
    'never carries the sign-in page %s as returnToPath',
    (pathname) => {
      const url = new URL(
        buildSsoProxyLoginUrl(base, { pathname, search: '?x=1', hash: '' }),
      );

      expect(url.searchParams.has('returnToPath')).toBe(false);
    },
  );

  it('keeps paths that only share the sign-in prefix', () => {
    const url = new URL(
      buildSsoProxyLoginUrl(base, {
        pathname: '/welcome-back',
        search: '',
        hash: '',
      }),
    );

    expect(url.searchParams.get('returnToPath')).toBe('/welcome-back');
  });
});
