import { renderFrontendHtml } from 'src/engine/core-modules/frontend/utils/render-frontend-html.util';

const TEMPLATE =
  '<html><head><!-- BEGIN: Twenty Config --><script>window._env_ = { stale: true };</script><!-- END: Twenty Config --></head><body></body></html>';

const getBootstrapContent = ({
  html,
  elementId,
}: {
  html: string;
  elementId: string;
}) =>
  html.match(
    new RegExp(
      `<script id="${elementId}" type="application/json">(.*?)</script>`,
    ),
  )?.[1];

const extractRuntimeEnvScript = (html: string): string | undefined =>
  html.match(/<script id="twenty-env-config">[\s\S]*?<\/script>/)?.[0];

const renderWithRuntimeEnv = (runtimeEnv?: Record<string, string>) =>
  renderFrontendHtml({
    template: TEMPLATE,
    clientConfig: {},
    iframeMediaPermissions: [],
    runtimeEnv,
  });

describe('renderFrontendHtml', () => {
  it('embeds the iframe media permissions used for the document policy', () => {
    const html = renderFrontendHtml({
      template: TEMPLATE,
      clientConfig: {},
      iframeMediaPermissions: [
        {
          origin: 'https://phone.example.com',
          microphone: true,
          camera: false,
        },
      ],
    });

    expect(
      JSON.parse(
        getBootstrapContent({
          html,
          elementId: 'twenty-iframe-media-permissions',
        }) ?? '',
      ),
    ).toEqual([
      { origin: 'https://phone.example.com', microphone: true, camera: false },
    ]);
    expect(html).toContain(
      '<script id="twenty-env-config">window._env_ = {};</script>',
    );
  });

  it('escapes markup characters in embedded values', () => {
    const html = renderFrontendHtml({
      template: TEMPLATE,
      clientConfig: {},
      iframeMediaPermissions: [
        {
          origin: '</script><script>alert(1)</script>',
          microphone: true,
          camera: true,
        },
      ],
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(
      getBootstrapContent({
        html,
        elementId: 'twenty-iframe-media-permissions',
      }),
    ).toContain('\\u003c/script\\u003e');
  });

  it('renders an empty runtime env when none is given', () => {
    expect(extractRuntimeEnvScript(renderWithRuntimeEnv())).toBe(
      '<script id="twenty-env-config">window._env_ = {};</script>',
    );
  });

  it('exposes AUTH_TYPE to the spa through window._env_', () => {
    expect(
      extractRuntimeEnvScript(renderWithRuntimeEnv({ AUTH_TYPE: 'SSO' })),
    ).toBe(
      '<script id="twenty-env-config">window._env_ = {"AUTH_TYPE":"SSO"};</script>',
    );
  });

  it('escapes runtime env values that would close the inline script', () => {
    const html = renderWithRuntimeEnv({
      AUTH_TYPE: '</script><script>alert(1)</script>',
    });

    expect(html).not.toContain('<script>alert(1)');
    expect(extractRuntimeEnvScript(html)).toContain(
      '\\u003c/script\\u003e\\u003cscript\\u003ealert(1)',
    );
  });

  it('keeps replacement patterns in values literal', () => {
    const html = renderWithRuntimeEnv({ AUTH_TYPE: "$'$`$$" });

    expect(extractRuntimeEnvScript(html)).toContain('"AUTH_TYPE":"$\'$`$$"');
  });
});
