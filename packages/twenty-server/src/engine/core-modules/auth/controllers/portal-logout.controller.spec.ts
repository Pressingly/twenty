import { PortalLogoutController } from 'src/engine/core-modules/auth/controllers/portal-logout.controller';

type ConfigKey = 'PLATFORM_DOMAIN';

const buildController = (
  configOverrides?: Partial<Record<ConfigKey, unknown>>,
) => {
  const config: Record<ConfigKey, unknown> = {
    PLATFORM_DOMAIN: 'foss.arbisoft.com',
    ...configOverrides,
  };

  const twentyConfigService = {
    get: jest.fn((key: ConfigKey) => config[key]),
  };

  const controller = new PortalLogoutController(twentyConfigService as any);

  const res: any = {
    clearCookie: jest.fn(),
    redirect: jest.fn(),
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
  };

  const portalLogout = (next?: string) => controller.portalLogout(next, res);

  return { controller, twentyConfigService, res, portalLogout };
};

describe('PortalLogoutController.portalLogout', () => {
  it('clears the tokenPair cookie regardless of ?next= validity', () => {
    const { res, portalLogout } = buildController();

    portalLogout('https://evil.example/');

    expect(res.clearCookie).toHaveBeenCalledWith('tokenPair', { path: '/' });
  });

  it('302s to ?next= when host is PLATFORM_DOMAIN', () => {
    const { res, portalLogout } = buildController();

    portalLogout('https://foss.arbisoft.com/done');

    expect(res.redirect).toHaveBeenCalledWith(
      302,
      'https://foss.arbisoft.com/done',
    );
  });

  it('302s to ?next= when host is a subdomain of PLATFORM_DOMAIN', () => {
    const { res, portalLogout } = buildController();

    portalLogout('https://twenty.foss.arbisoft.com/x');

    expect(res.redirect).toHaveBeenCalledWith(
      302,
      'https://twenty.foss.arbisoft.com/x',
    );
  });

  it('200s without redirect when ?next= host is unrelated', () => {
    const { res, portalLogout } = buildController();

    portalLogout('https://evil.example/steal');

    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalled();
  });

  it('enforces dot boundary on suffix match', () => {
    // `foss.arbisoft.com.evil` must NOT match `foss.arbisoft.com`.
    const { res, portalLogout } = buildController();

    portalLogout('https://foss.arbisoft.com.evil/x');

    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects non-http(s) schemes', () => {
    const { res, portalLogout } = buildController();

    portalLogout('javascript:alert(document.cookie)');

    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('200s without redirect when ?next= is omitted', () => {
    const { res, portalLogout } = buildController();

    portalLogout();

    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.clearCookie).toHaveBeenCalledWith('tokenPair', { path: '/' });
  });

  it('rejects every ?next= when PLATFORM_DOMAIN is unset', () => {
    const { res, portalLogout } = buildController({ PLATFORM_DOMAIN: '' });

    portalLogout('https://foss.arbisoft.com/x');

    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects malformed ?next= values', () => {
    const { res, portalLogout } = buildController();

    portalLogout(':::garbage');

    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('normalises a leading dot in PLATFORM_DOMAIN', () => {
    const { res, portalLogout } = buildController({
      PLATFORM_DOMAIN: '.foss.arbisoft.com',
    });

    portalLogout('https://twenty.foss.arbisoft.com/');

    expect(res.redirect).toHaveBeenCalledWith(
      302,
      'https://twenty.foss.arbisoft.com/',
    );
  });
});
