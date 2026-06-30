import { Injectable, NestMiddleware } from "@nestjs/common";
import { NextFunction } from "express";
import { runWithRequestContext } from "./request-context";

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId = (req.headers['x-correlation-id'] as string) || undefined;
    const requestId = (req.headers['x-request-id'] as string) || undefined;

    runWithRequestContext({correlationId, requestId}, () => next());
  }
}