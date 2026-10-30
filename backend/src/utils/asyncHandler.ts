import { NextFunction, Request, Response } from "express";

// Path params are always plain strings for our `/:id`-style routes. A bare `Request` falls back
// to @types/express-serve-static-core's ParamsDictionary (`string | string[]`), which would force
// a cast at every `req.params.x` use.
type Params = Record<string, string>;
type Handler = (req: Request<Params>, res: Response, next: NextFunction) => Promise<any>;

/** Wraps an async route handler so rejected promises are forwarded to Express's error middleware. */
export function asyncHandler(handler: Handler) {
  return (req: Request<Params>, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}
