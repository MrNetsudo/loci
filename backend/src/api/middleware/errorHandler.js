'use strict';

const logger = require('../../utils/logger');

const notFound = (req, res, next) => {
  const err = new Error(`Not Found — ${req.originalUrl}`);
  err.status = 404;
  next(err);
};

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  if (status >= 500) {
    logger.error('Server error', { status, message, stack: err.stack, url: req.originalUrl });
  }

  res.status(status).json({
    error: err.code || 'SERVER_ERROR',
    message: process.env.NODE_ENV === 'production' && status === 500
      ? 'An unexpected error occurred'
      : message,
  });
};

module.exports = { notFound, errorHandler };
