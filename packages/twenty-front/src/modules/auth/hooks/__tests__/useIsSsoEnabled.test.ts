import { renderHook } from '@testing-library/react';

import { useIsSsoEnabled } from '@/auth/hooks/useIsSsoEnabled';

describe('useIsSsoEnabled', () => {
  const originalEnv = window._env_;

  afterEach(() => {
    window._env_ = originalEnv;
  });

  it('returns true when IS_SSO_ENABLED is "true"', () => {
    window._env_ = { IS_SSO_ENABLED: 'true' };

    const { result } = renderHook(() => useIsSsoEnabled());

    expect(result.current).toBe(true);
  });

  it('returns false when IS_SSO_ENABLED is "false"', () => {
    window._env_ = { IS_SSO_ENABLED: 'false' };

    const { result } = renderHook(() => useIsSsoEnabled());

    expect(result.current).toBe(false);
  });

  it('returns false when IS_SSO_ENABLED is missing', () => {
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
