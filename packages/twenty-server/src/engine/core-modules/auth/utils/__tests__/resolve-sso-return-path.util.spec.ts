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
