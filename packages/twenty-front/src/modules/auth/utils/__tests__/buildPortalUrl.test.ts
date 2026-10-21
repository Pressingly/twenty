import { buildPortalUrl } from '@/auth/utils/buildPortalUrl';

describe('buildPortalUrl', () => {
  it('strips the first label of a 4-label host', () => {
    expect(buildPortalUrl('twenty.foss.arbisoft.com', 'https:')).toBe(
      'https://foss.arbisoft.com/',
    );
  });

  it('preserves the same scheme for http://', () => {
    expect(buildPortalUrl('twenty.foss.arbisoft.com', 'http:')).toBe(
      'http://foss.arbisoft.com/',
    );
  });

  it('no-ops on `localhost`', () => {
    expect(buildPortalUrl('localhost', 'http:')).toBe('http://localhost/');
  });

  it('no-ops on 3-label hosts', () => {
    expect(buildPortalUrl('foo.example.com', 'https:')).toBe(
      'https://foo.example.com/',
    );
  });

  it('only strips the first label, leaves deeper subdomains alone', () => {
    expect(buildPortalUrl('twenty.a.b.moneta.dev', 'https:')).toBe(
      'https://a.b.moneta.dev/',
    );
  });

  it('preserves port when present', () => {
    expect(buildPortalUrl('twenty.local.moneta.dev:8080', 'http:')).toBe(
      'http://local.moneta.dev:8080/',
    );
  });
});
