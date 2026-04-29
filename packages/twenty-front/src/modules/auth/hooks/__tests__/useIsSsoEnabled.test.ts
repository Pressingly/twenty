import { renderHook } from '@testing-library/react';

import { useIsSsoEnabled } from '@/auth/hooks/useIsSsoEnabled';

describe('useIsSsoEnabled', () => {
  const originalEnv = window._env_;

  afterEach(() => {
    window._env_ = originalEnv;
  });

  it('returns true when AUTH_TYPE is "SSO"', () => {
    window._env_ = { AUTH_TYPE: 'SSO' };

    const { result } = renderHook(() => useIsSsoEnabled());

    expect(result.current).toBe(true);
  });

  it('returns false when AUTH_TYPE is some other value', () => {
    window._env_ = { AUTH_TYPE: 'PASSWORD' };

    const { result } = renderHook(() => useIsSsoEnabled());

    expect(result.current).toBe(false);
  });

  it('returns false when AUTH_TYPE is missing', () => {
    window._env_ = {};

    const { result } = renderHook(() => useIsSsoEnabled());

    expect(result.current).toBe(false);
  });

  it('returns false when window._env_ is undefined', () => {
    window._env_ = undefined;

    const { result } = renderHook(() => useIsSsoEnabled());

    expect(result.current).toBe(false);
  });
});
