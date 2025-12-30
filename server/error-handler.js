import chalk from 'chalk';

/**
 * Custom error class for application-specific errors
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 404 Not Found handler
 * Catches all requests to undefined routes
 */
export function notFoundHandler(req, res, next) {
  const message = `Route not found: ${req.method} ${req.originalUrl}`;
  console.warn(chalk.yellow(`[404] ${message}`));
  
  res.status(404).json({
    error: 'Not Found',
    message: 'The requested resource was not found',
    path: req.originalUrl,
    method: req.method
  });
}

/**
 * Global error handler middleware
 * Handles all errors passed to next() or thrown in routes
 */
export function errorHandler(err, req, res, next) {
  // Default to 500 server error
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let details = err.details || null;

  // Handle specific error types
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation Error';
    details = err.details || err.message;
  } else if (err.name === 'UnauthorizedError') {
    statusCode = 401;
    message = 'Unauthorized';
  } else if (err.code === 'ENOENT') {
    statusCode = 404;
    message = 'Resource not found';
  } else if (err.code === 'EACCES') {
    statusCode = 403;
    message = 'Access denied';
  }

  // Log error details
  if (statusCode >= 500) {
    console.error(chalk.red(`[ERROR] ${req.method} ${req.originalUrl}`));
    console.error(chalk.red(`  ${message}`));
    if (err.stack && process.env.DEBUG) {
      console.error(chalk.gray(err.stack));
    }
  } else {
    console.warn(chalk.yellow(`[${statusCode}] ${req.method} ${req.originalUrl}: ${message}`));
  }

  // Build error response
  const errorResponse = {
    error: statusCode >= 500 ? 'Internal Server Error' : message,
    message: statusCode >= 500 ? 'An unexpected error occurred' : message,
    path: req.originalUrl,
    timestamp: new Date().toISOString()
  };

  // Include details in non-production or for client errors
  if ((process.env.NODE_ENV !== 'production' || statusCode < 500) && details) {
    errorResponse.details = details;
  }

  // Include stack trace in development
  if (process.env.NODE_ENV === 'development' && err.stack) {
    errorResponse.stack = err.stack;
  }

  res.status(statusCode).json(errorResponse);
}

/**
 * Async route wrapper to catch errors in async handlers
 * Usage: app.get('/route', asyncHandler(async (req, res) => { ... }))
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
