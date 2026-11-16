export const buildSmbWorkspaceDisplayName = (subdomain: string): string =>
  subdomain.charAt(0).toUpperCase() + subdomain.slice(1);
