import {
  PROXY_ACCESS_TOKEN_HEADER_NAME,
  PROXY_EMAIL_HEADER_NAME,
  PROXY_USER_HEADER_NAME,
} from 'src/engine/core-modules/mpass-proxy-auth/constants/mpass-proxy-header-names.constant';
import { type ProxyIdentityHeaders } from 'src/engine/core-modules/mpass-proxy-auth/types/proxy-identity-headers.type';
import {
  readProxyHeader,
  type RequestWithHeaderGetter,
} from 'src/engine/core-modules/mpass-proxy-auth/utils/read-proxy-header.util';

export const readProxyIdentityHeaders = (
  request: RequestWithHeaderGetter,
): ProxyIdentityHeaders => ({
  email: readProxyHeader(request, PROXY_EMAIL_HEADER_NAME),
  user: readProxyHeader(request, PROXY_USER_HEADER_NAME),
  accessToken: readProxyHeader(request, PROXY_ACCESS_TOKEN_HEADER_NAME),
});
