import { isDefined } from 'twenty-shared/utils';

import {
  PROXY_PREFERRED_USERNAME_HEADER_NAME,
  PROXY_USER_HEADER_NAME,
} from 'src/engine/core-modules/mpass-proxy-auth/constants/mpass-proxy-header-names.constant';
import {
  readProxyHeader,
  type RequestWithHeaderGetter,
} from 'src/engine/core-modules/mpass-proxy-auth/utils/read-proxy-header.util';

// With email capture on, X-Auth-Request-User carries the email, which must
// never reach a log line.
export const mpassIdForLogs = (request: RequestWithHeaderGetter): string =>
  [PROXY_USER_HEADER_NAME, PROXY_PREFERRED_USERNAME_HEADER_NAME]
    .map((headerName) => readProxyHeader(request, headerName))
    .find((value) => isDefined(value) && !value.includes('@')) ?? '-';
