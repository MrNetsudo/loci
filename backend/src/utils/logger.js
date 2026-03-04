'use strict';

const { createLogger, format, transports } = require('winston');
const config = require('../config');

const logger = createLogger({
  level: config.logging.level,
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    config.app.env === 'production'
      ? format.json()
      : format.combine(format.colorize(), format.simple())
  ),
  transports: [
    new transports.Console(),
  ],
});

module.exports = logger;
