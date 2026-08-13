import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface CommercetoolsError {
    httpErrorStatus?: number;
    code?: string;
    message?: string;
    body?: {
        message?: string;
        errors?: Array<{ code: string; message: string }>;
    };
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(GlobalExceptionFilter.name);

    catch(exception: unknown, host: ArgumentsHost): void {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request>();

        if (exception instanceof HttpException) {
            const status = exception.getStatus();
            const body = exception.getResponse();

            this.logger.warn(
                `${request.method} ${request.url} → ${status} ${JSON.stringify(body)}`,
            );

            response.status(status).json(
                typeof body === 'string' ? { statusCode: status, message: body } : body,
            );

            return;
        }

        const ctError = exception as CommercetoolsError;
        if (ctError?.httpErrorStatus && ctError?.code) {
            const status = ctError.httpErrorStatus;
            const message = ctError.body?.message ?? ctError.message ?? 'commercetools error';
            const errors = ctError.body?.errors ?? [{ code: ctError.code, message }];

            this.logger.warn(
                `${request.method} ${request.url} → CT ${status} ${ctError.code}: ${message}`,
            );

            response.status(status).json({
                statusCode: status,
                code: ctError.code,
                message,
                errors,
            });

            return;
        }

        const err = exception as Error;
        this.logger.error(
            `${request.method} ${request.url} → 500 ${err?.message ?? 'unknown'}`,
            err?.stack,
        );

        response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: 'Internal server error',
        });

        return;
    }
}