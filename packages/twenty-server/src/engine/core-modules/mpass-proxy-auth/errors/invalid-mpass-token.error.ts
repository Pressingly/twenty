export type InvalidMpassTokenReason =
  | 'verifier_unconfigured'
  | 'malformed'
  | 'disallowed_algorithm'
  | 'untrusted_issuer'
  | 'jwks_unavailable'
  | 'unknown_signing_key'
  | 'bad_signature'
  | 'expired'
  | 'invalid'
  | 'wrong_audience';

export class InvalidMpassTokenError extends Error {
  constructor(readonly reason: InvalidMpassTokenReason) {
    super(reason);
    this.name = 'InvalidMpassTokenError';
  }
}
