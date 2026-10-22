import { resolveSsoReturnPath } from 'src/engine/core-modules/auth/utils/resolve-sso-return-path.util';

describe('resolveSsoReturnPath', () => {
  it.each([
    ['/authorize?client_id=abc', '/authorize?client_id=abc'],
    ['/objects/people#top', '/objects/people#top'],
    ['/', '/'],
  ])('keeps the same-origin path %s', (input, expected) => {
    expect(resolveSsoReturnPath(input)).toBe(expected);
  });

  it.each([['/welcome'], ['/welcome?x=1'], ['/welcome#hash'], ['/welcome/']])(
    'never returns the sign-in page %s',
    (input) => {
      expect(resolveSsoReturnPath(input)).toBe('/');
    },
  );

  it('keeps the original path and query for deep links', () => {
    expect(resolveSsoReturnPath('/Authorize?client_id=Abc%20d')).toBe(
      '/Authorize?client_id=Abc%20d',
    );
  });

  it('does not throw on malformed percent encoding and keeps the path', () => {
    expect(resolveSsoReturnPath('/objects/%E0%A4%A')).toBe('/objects/%E0%A4%A');
  });

  it('keeps paths that only share the sign-in prefix', () => {
    expect(resolveSsoReturnPath('/welcome-back')).toBe('/welcome-back');
  });

  it.each([
    ['//evil.com'],
    ['/\\evil.com'],
    ['https://evil.com'],
    ['evil.com'],
    [''],
  ])('falls back to / for the unsafe value %p', (input) => {
    expect(resolveSsoReturnPath(input)).toBe('/');
  });

  it.each([[undefined], [null], [['/a', '/b']], [{ a: 1 }]])(
    'falls back to / for the non-string value %p',
    (input) => {
      expect(resolveSsoReturnPath(input)).toBe('/');
    },
  );
});
