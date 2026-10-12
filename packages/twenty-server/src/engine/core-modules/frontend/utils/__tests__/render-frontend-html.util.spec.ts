import { type ClientConfig } from 'src/engine/core-modules/client-config/client-config.entity';
import { renderFrontendHtml } from 'src/engine/core-modules/frontend/utils/render-frontend-html.util';

const TEMPLATE = `<html><head>
<!-- BEGIN: Twenty Config -->
<script id="twenty-env-config">window._env_ = { /* overwritten */ };</script>
<!-- END: Twenty Config -->
</head><body></body></html>`;

const CLIENT_CONFIG = {} as ClientConfig;

const extractRuntimeEnvScript = (html: string): string | undefined =>
  html.match(/<script id="twenty-env-config">[\s\S]*?<\/script>/)?.[0];

describe('renderFrontendHtml', () => {
  it('renders an empty runtime env when none is given', () => {
    const html = renderFrontendHtml(TEMPLATE, CLIENT_CONFIG);

    expect(extractRuntimeEnvScript(html)).toBe(
      '<script id="twenty-env-config">window._env_ = {};</script>',
    );
  });

  it('exposes AUTH_TYPE to the spa through window._env_', () => {
    const html = renderFrontendHtml(TEMPLATE, CLIENT_CONFIG, {
      AUTH_TYPE: 'SSO',
    });

    expect(extractRuntimeEnvScript(html)).toBe(
      '<script id="twenty-env-config">window._env_ = {"AUTH_TYPE":"SSO"};</script>',
    );
  });

  it('escapes runtime env values that would close the inline script', () => {
    const html = renderFrontendHtml(TEMPLATE, CLIENT_CONFIG, {
      AUTH_TYPE: '</script><script>alert(1)</script>',
    });

    expect(html).not.toContain('<script>alert(1)');
    expect(extractRuntimeEnvScript(html)).toContain(
      '\\u003c/script\\u003e\\u003cscript\\u003ealert(1)',
    );
  });

  it('keeps replacement patterns in values literal', () => {
    const html = renderFrontendHtml(TEMPLATE, CLIENT_CONFIG, {
      AUTH_TYPE: "$'$`$$",
    });

    expect(extractRuntimeEnvScript(html)).toContain('"AUTH_TYPE":"$\'$`$$"');
  });
});
