export const useIsSsoEnabled = (): boolean => {
  return window._env_?.IS_SSO_ENABLED === 'true';
};
