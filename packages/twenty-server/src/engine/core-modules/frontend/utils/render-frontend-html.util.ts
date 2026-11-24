import {
  CLIENT_CONFIG_BOOTSTRAP_ELEMENT_ID,
  IFRAME_MEDIA_PERMISSIONS_BOOTSTRAP_ELEMENT_ID,
} from 'twenty-shared/constants';
import { type IframeMediaPermission } from 'twenty-shared/types';

import { serializeJsonForHtmlScript } from 'src/engine/core-modules/frontend/utils/serialize-json-for-html-script.util';

export const renderFrontendHtml = ({
  template,
  clientConfig,
  iframeMediaPermissions,
  runtimeEnv = {},
}: {
  template: string;
  clientConfig: object;
  iframeMediaPermissions: IframeMediaPermission[];
  runtimeEnv?: Record<string, string>;
}): string =>
  template
    .replace(
      /<!-- BEGIN: Twenty Config -->[\s\S]*?<!-- END: Twenty Config -->/,
      () =>
        `<script id="twenty-env-config">window._env_ = ${serializeJsonForHtmlScript(runtimeEnv)};</script>`,
    )
    .replace(
      '</head>',
      () =>
        `<script id="${CLIENT_CONFIG_BOOTSTRAP_ELEMENT_ID}" type="application/json">${serializeJsonForHtmlScript(clientConfig)}</script>` +
        `<script id="${IFRAME_MEDIA_PERMISSIONS_BOOTSTRAP_ELEMENT_ID}" type="application/json">${serializeJsonForHtmlScript(iframeMediaPermissions)}</script></head>`,
    );
