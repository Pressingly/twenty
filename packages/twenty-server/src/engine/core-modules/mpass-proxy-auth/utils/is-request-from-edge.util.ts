import { createHash, timingSafeEqual } from 'crypto';

import { isString } from '@sniptt/guards';

import { isEdgeSecretUsable } from 'src/engine/core-modules/mpass-proxy-auth/utils/is-edge-secret-usable.util';

const sha256 = (value: string): Buffer =>
  createHash('sha256').update(value).digest();

// Digests make the compare length-independent, which timingSafeEqual needs.
// An unusable secret trusts nothing: without it a direct backend call is
// indistinguishable from one that passed mPass ForwardAuth.
export const isRequestFromEdge = (
  presentedSecret: unknown,
  edgeSecret: string,
): boolean => {
  if (!isEdgeSecretUsable(edgeSecret) || !isString(presentedSecret)) {
    return false;
  }

  return timingSafeEqual(sha256(presentedSecret), sha256(edgeSecret));
};
