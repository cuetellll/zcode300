import type { NextFunction, Request, Response } from 'express';

export class HttpError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message: string, details?: unknown): HttpError {
  return new HttpError(400, message, undefined, details);
}

export function unauthorized(message = 'Authentication required'): HttpError {
  return new HttpError(401, message);
}

export function forbidden(message = 'You do not have permission to do that'): HttpError {
  return new HttpError(403, message);
}

export function notFound(message = 'Not found'): HttpError {
  return new HttpError(404, message);
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/** Wrap an async express handler so rejections reach the error middleware. */
export function asyncHandler(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}
