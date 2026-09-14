import Joi from 'joi';

/**
 * Boot-time environment validation. The application fails fast when a required
 * variable is missing or malformed rather than limping along with bad config.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'staging', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  API_PREFIX: Joi.string().default('api/v1'),
  CORS_ORIGINS: Joi.string().default(''),

  // Database
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),

  // Redis / queue
  REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }).required(),

  // Auth
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  JWT_REFRESH_TTL: Joi.string().default('30d'),
  EMAIL_VERIFICATION_REQUIRED: Joi.boolean().default(true),

  // SMTP
  SMTP_HOST: Joi.string().allow('').optional(),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_USER: Joi.string().allow('').optional(),
  SMTP_PASS: Joi.string().allow('').optional(),
  MAIL_FROM: Joi.string().default('SME ERP <noreply@example.com>'),

  // eTIMS (KRA)
  ETIMS_ENV: Joi.string().valid('sandbox', 'production').default('sandbox'),
  ETIMS_CERT_PATH: Joi.string().allow('').optional(),
  ETIMS_CERT_PASSPHRASE: Joi.string().allow('').optional(),
  ETIMS_MODE: Joi.string().valid('mock', 'live').default('mock'),
  ETIMS_BASE_URL: Joi.string().uri().default('https://preprod-tims.kra.go.ke'),
  ETIMS_CLIENT_ID: Joi.string().allow('').optional(),
  ETIMS_CLIENT_SECRET: Joi.string().allow('').optional(),
  ETIMS_TAXPAYER_PIN: Joi.string().allow('').optional(),
  ETIMS_DEVICE_SERIAL: Joi.string().allow('').optional(),
  ETIMS_TIMEOUT_MS: Joi.number().integer().positive().default(10000),

  // Outbox worker
  OUTBOX_WORKER_ENABLED: Joi.boolean().default(true),
  OUTBOX_POLL_INTERVAL_MS: Joi.number().integer().positive().default(5000),
  OUTBOX_BATCH_SIZE: Joi.number().integer().positive().default(10),

  // Throttler
  THROTTLE_TTL: Joi.number().integer().positive().default(60),
  THROTTLE_LIMIT: Joi.number().integer().positive().default(100),
}).options({ abortEarly: false, allowUnknown: true, stripUnknown: true });