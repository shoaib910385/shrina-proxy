import { Request, Response, NextFunction } from 'express';
import { cors as honoCors } from 'hono/cors';
import pino from 'pino';
import { SERVER, PROXY, LOGGING } from './config/constants.js';

// ==================== LOGGER MIDDLEWARE ====================

// Determine environment
const isProd = SERVER.IS_PRODUCTION || process.env.NODE_ENV === 'production';

// Create a Pino logger instance
// Disable "pino-pretty" in production (Vercel) because transports are not supported
export const logger = isProd
  ? pino({
      level: LOGGING.LEVEL || 'info',
    })
  : pino({
      level: LOGGING.LEVEL || 'debug',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    });

/**
 * Request logger middleware for Express
 */
export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const requestId =
    req.headers['x-request-id'] ||
    Math.random().toString(36).substring(2);

  // Add request ID to response headers
  res.setHeader('x-request-id', requestId as string);

  // Log request start
  const requestLog = {
    requestId,
    method: req.method,
    url: req.url,
    path: req.path,
    query: req.query,
    headers: getFilteredHeaders(req),
    remoteAddress: req.ip || req.socket.remoteAddress || 'unknown',
  };

  logger.debug({ type: 'request', ...requestLog }, 'Request received');

  // Capture the original end method
  const originalEnd = res.end;

  // Override res.end to log responses
  // @ts-ignore
  res.end = function (chunk: any, encoding: BufferEncoding) {
    const responseTime = Date.now() - startTime;

    const logData = {
      type: 'response',
      requestId,
      method: req.method,
      url: req.url,
      path: req.path,
      status: res.statusCode,
      responseTime,
    };

    const message = `Response sent: ${res.statusCode} (${responseTime}ms)`;

    if (res.statusCode >= 500) {
      logger.error(logData, message);
    } else if (res.statusCode >= 400) {
      logger.warn(logData, message);
    } else {
      logger.info(logData, message);
    }

    return originalEnd.apply(res, arguments as any);
  };

  next();
};

/**
 * Get filtered headers to avoid logging sensitive information
 */
function getFilteredHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  const sensitiveHeaders = ['authorization', 'cookie', 'set-cookie'];

  for (const [key, value] of Object.entries(req.headers)) {
    if (sensitiveHeaders.includes(key.toLowerCase())) {
      headers[key] = '[REDACTED]';
    } else {
      headers[key] = Array.isArray(value)
        ? value.join(', ')
        : value || '';
    }
  }

  return headers;
}

// ==================== CORS MIDDLEWARE ====================

/**
 * Convert Hono middleware to Express middleware
 */
const honoAdapter = (middleware: any) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const c = {
      req: {
        raw: req,
        header: (name: string) => req.headers[name.toLowerCase()] as string,
        method: req.method,
        url: req.url,
      },
      res: {
        headers: new Headers(),
        status: (code: number) => {
          res.status(code);
          return c;
        },
        body: (body: any) => c,
      },
      header: (name: string, value: string) => {
        res.setHeader(name, value);
        return c;
      },
    };

    try {
      const result = await middleware(c, async () => {});
      if (result !== undefined && req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * CORS middleware using Hono's CORS implementation
 */
export const corsMiddleware = honoAdapter(
  honoCors({
    origin: PROXY.ALLOWED_ORIGINS.includes('*')
      ? '*'
      : PROXY.ALLOWED_ORIGINS,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',
      'Range',
    ],
    exposeHeaders: [
      'Content-Length',
      'Content-Range',
      'Content-Type',
      'Accept-Ranges',
    ],
    credentials: true,
    maxAge: 86400, // 24 hours
  })
);

// ==================== ERROR HANDLER MIDDLEWARE ====================

export interface ErrorResponse {
  error: {
    code: number;
    message: string;
    details?: any;
  };
  success: false;
  timestamp: string;
  path?: string;
}

/**
 * Global error handler middleware for Express
 */
export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const statusCode = err.status || err.statusCode || 500;
  const errorMessage = err.message || 'Internal Server Error';
  let errorDetails: any;

  // Log the error
  logger.error(
    {
      error: err instanceof Error ? err : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      path: req.path,
      method: req.method,
      url: req.url,
    },
    'Request error'
  );

  if (!SERVER.IS_PRODUCTION) {
    errorDetails = { name: err.name, stack: err.stack };
  }

  const errorResponse: ErrorResponse = {
    error: {
      code: statusCode,
      message: errorMessage,
      ...(errorDetails ? { details: errorDetails } : {}),
    },
    success: false,
    timestamp: new Date().toISOString(),
    path: req.path,
  };

  res.status(statusCode).json(errorResponse);
};

// ==================== EXPORTS ====================

export default {
  logger,
  requestLogger,
  corsMiddleware,
  errorHandler,
};
