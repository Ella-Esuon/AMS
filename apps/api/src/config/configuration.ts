import * as Joi from 'joi';

export interface AppConfig {
  app: {
    name: string;
    nodeEnv: string;
    port: number;
    apiPrefix: string;
    appUrl: string;
    frontendUrl: string;
    corsOrigins: string;
  };
  database: {
    url: string;
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
    ssl: boolean;
    poolMin: number;
    poolMax: number;
  };
  redis: {
    host: string;
    port: number;
    password: string;
    db: number;
    ttl: number;
    keyPrefix: string;
  };
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessExpiresIn: string;
    refreshExpiresIn: string;
    issuer: string;
    audience: string;
  };
  aws: {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    cognito: {
      userPoolId: string;
      clientId: string;
      clientSecret: string;
      jwksUrl: string;
    };
    s3: {
      bucket: string;
      region: string;
      presignedUrlExpires: number;
    };
    sns: {
      topicArn: string;
    };
    ses: {
      fromEmail: string;
      fromName: string;
    };
  };
  throttle: {
    ttl: number;
    limit: number;
    authTtl: number;
    authLimit: number;
  };
  mfa: {
    appName: string;
    window: number;
  };
  encryption: {
    key: string;
    ivLength: number;
  };
  logging: {
    level: string;
    format: string;
    filePath: string;
  };
}

export const configuration = (): AppConfig => ({
  app: {
    name: process.env.APP_NAME || 'AMS',
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.APP_PORT || '3000', 10),
    apiPrefix: process.env.API_PREFIX || 'api/v1',
    appUrl: process.env.APP_URL || 'http://localhost:3000',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3001',
    corsOrigins: process.env.CORS_ORIGINS || 'http://localhost:3001',
  },
  database: {
    url: process.env.DATABASE_URL || '',
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    name: process.env.DATABASE_NAME || 'ams_db',
    user: process.env.DATABASE_USER || 'ams_user',
    password: process.env.DATABASE_PASSWORD || '',
    ssl: process.env.DATABASE_SSL === 'true',
    poolMin: parseInt(process.env.DATABASE_POOL_MIN || '2', 10),
    poolMax: parseInt(process.env.DATABASE_POOL_MAX || '20', 10),
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || '',
    db: parseInt(process.env.REDIS_DB || '0', 10),
    ttl: parseInt(process.env.REDIS_TTL || '3600', 10),
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'ams:',
  },
  jwt: {
    // Non-null: validationSchema below requires these (min 32 chars) before boot completes.
    accessSecret: process.env.JWT_ACCESS_SECRET!,
    refreshSecret: process.env.JWT_REFRESH_SECRET!,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    issuer: process.env.JWT_ISSUER || 'ams-platform',
    audience: process.env.JWT_AUDIENCE || 'ams-clients',
  },
  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    cognito: {
      userPoolId: process.env.COGNITO_USER_POOL_ID || '',
      clientId: process.env.COGNITO_CLIENT_ID || '',
      clientSecret: process.env.COGNITO_CLIENT_SECRET || '',
      jwksUrl: process.env.COGNITO_JWKS_URL || '',
    },
    s3: {
      bucket: process.env.S3_BUCKET_NAME || 'ams-uploads-dev',
      region: process.env.S3_BUCKET_REGION || 'us-east-1',
      presignedUrlExpires: parseInt(process.env.S3_PRESIGNED_URL_EXPIRES || '3600', 10),
    },
    sns: {
      topicArn: process.env.SNS_TOPIC_ARN || '',
    },
    ses: {
      fromEmail: process.env.SES_FROM_EMAIL || 'noreply@example.com',
      fromName: process.env.SES_FROM_NAME || 'AMS Platform',
    },
  },
  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL || '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT || '100', 10),
    authTtl: parseInt(process.env.AUTH_THROTTLE_TTL || '60', 10),
    authLimit: parseInt(process.env.AUTH_THROTTLE_LIMIT || '10', 10),
  },
  mfa: {
    appName: process.env.MFA_APP_NAME || 'AMS',
    window: parseInt(process.env.MFA_TOTP_WINDOW || '1', 10),
  },
  encryption: {
    // Non-null: validationSchema below requires this (min 32 chars) before boot completes.
    key: process.env.ENCRYPTION_KEY!,
    ivLength: parseInt(process.env.ENCRYPTION_IV_LENGTH || '16', 10),
  },
  logging: {
    level: process.env.LOG_LEVEL || 'debug',
    format: process.env.LOG_FORMAT || 'json',
    filePath: process.env.LOG_FILE_PATH || './logs/app.log',
  },
});

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'staging', 'production', 'test').default('development'),
  APP_PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().required(),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().default(6379),
  ENCRYPTION_KEY: Joi.string().min(32).required(),
});
