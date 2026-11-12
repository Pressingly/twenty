import { isNonEmptyString, isString } from '@sniptt/guards';
import { type Request } from 'express';

export type RequestWithHeaderGetter = Pick<Request, 'get'>;

export const readProxyHeader = (
  request: RequestWithHeaderGetter,
  headerName: string,
): string | undefined => {
  const value = request.get(headerName);
  const trimmed = isString(value) ? value.trim() : '';

  return isNonEmptyString(trimmed) ? trimmed : undefined;
};
