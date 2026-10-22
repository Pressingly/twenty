import { buildPortalUrl } from '@/auth/utils/buildPortalUrl';

describe('buildPortalUrl', () => {
  it('strips the app label from <app>.<prefix>.<domain>', () => {
    expect(buildPortalUrl('twenty.foss.arbisoft.com', 'https:')).toBe(
      'https://foss.arbisoft.com/',
    );
  });

  it('preserves the same scheme for http://', () => {
    expect(buildPortalUrl('twenty.foss.arbisoft.com', 'http:')).toBe(
      'http://foss.arbisoft.com/',
    );
  });

  it('only strips the first label on deeper hosts', () => {
    expect(buildPortalUrl('twenty.foss.staging.moneta.dev', 'https:')).toBe(
      'https://foss.staging.moneta.dev/',
    );
  });

  it('preserves port when present', () => {
    expect(buildPortalUrl('twenty.foss.local.moneta.dev:8080', 'http:')).toBe(
      'http://foss.local.moneta.dev:8080/',
    );
  });

  it('no-ops on `localhost`', () => {
    expect(buildPortalUrl('localhost', 'http:')).toBe('http://localhost/');
  });

  it('no-ops on 3-label hosts so the registrable domain is never stripped', () => {
    expect(buildPortalUrl('foo.example.com', 'https:')).toBe(
      'https://foo.example.com/',
    );
  });
});
