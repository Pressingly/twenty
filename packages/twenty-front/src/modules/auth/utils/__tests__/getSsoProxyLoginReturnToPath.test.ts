import { getSsoProxyLoginReturnToPath } from '@/auth/utils/getSsoProxyLoginReturnToPath';

describe('getSsoProxyLoginReturnToPath', () => {
  it('should unwrap the MCP authorize target the sign-in page was sent with', () => {
    expect(
      getSsoProxyLoginReturnToPath(
        '?returnToPath=%2Fauthorize%3FclientId%3Dabc%26state%3Dxyz',
      ),
    ).toBe('/authorize?clientId=abc&state=xyz');
  });

  it('should return null when no returnToPath is present', () => {
    expect(getSsoProxyLoginReturnToPath('')).toBeNull();
    expect(getSsoProxyLoginReturnToPath('?email=a%40b.com')).toBeNull();
  });

  it('should return null for an external returnToPath', () => {
    expect(
      getSsoProxyLoginReturnToPath('?returnToPath=%2F%2Fevil.com'),
    ).toBeNull();
  });

  it('should return null for a returnToPath that points back at sign-in', () => {
    expect(
      getSsoProxyLoginReturnToPath(
        '?returnToPath=%2Fwelcome%3FreturnToPath%3D%252Fauthorize',
      ),
    ).toBeNull();
  });
});
