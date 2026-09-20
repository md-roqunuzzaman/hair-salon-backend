import { env } from "./env.js";

export default {
  node_env: env.NODE_ENV,
  port: env.PORT,
  database_url: env.DATABASE_URL,
  frontend_url: env.CORS_ORIGIN,
  bcrypt_salt_rounds: env.BCRYPT_SALT_ROUNDS,
  jwt_access_secret: env.JWT_ACCESS_SECRET,
  jwt_refresh_secret: env.JWT_REFRESH_SECRET,
  jwt_access_expires_in: env.JWT_ACCESS_EXPIRES_IN,
  jwt_refresh_expires_in: env.JWT_REFRESH_EXPIRES_IN,
  redis_url: env.REDIS_URL,
  smtp_user: env.SMTP_USER,
  smtp_password: env.SMTP_PASSWORD,
  email_sender: env.EMAIL_SENDER,
};
