export default () => {
  // audit A1: fail fast — never boot with a forgeable default JWT secret.
  if (!process.env.API_SECRET) {
    throw new Error('API_SECRET environment variable must be set (JWT signing secret)');
  }
  return {
  port: parseInt(process.env.PORT, 10) || 3008,
  globalPrefix: process.env.API_GLOBAL_PREFIX || 'admin/v2',
  apiSecret: process.env.API_SECRET,
  // JWT lifetime for newly issued tokens (e.g. '7d', '12h'). Legacy tokens
  // never expired; new logins now get a bounded lifetime.
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  // CORS: comma-separated allowlist (e.g. "https://account.stayhopper.com,https://extranet.stayhopper.com").
  // Empty => reflect the request origin (permissive but credential-safe).
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  mongo: {
    url: process.env.MONGO_URL,
    username: process.env.MONGO_USERNAME,
    password: process.env.MONGO_PASSWORD,
    authSource: process.env.MONGO_AUTH_SOURCE || 'admin',
    replicaSet: process.env.MONGO_REPLICASET || undefined,
  },
  // Public base URL used when building absolute asset paths (legacy config.api_url).
  apiUrl: process.env.API_URL || '',
  // App base URL (legacy config.app_url) for payment return URLs.
  appUrl: process.env.APP_URL || 'https://account.stayhopper.com/',
  extranetUrl: process.env.EXTRANET_URL || 'https://extranet.stayhopper.com/',
  paymentWebsiteUrl: process.env.PAYMENT_WEBSITE_URL || 'https://stayhopper.com/',
  paymentContainerUrl: process.env.PAYMENT_CONTAINER_URL || '',
  telr: {
    api: process.env.TELR_API || '',
    storeId: process.env.TELR_STORE_ID || '',
  },
  // Default commission shown for properties without an explicit agreement (config.commission).
  commission: {
    hourly: parseInt(process.env.COMMISSION_HOURLY, 10) || 15,
    monthly: parseInt(process.env.COMMISSION_MONTHLY, 10) || 15,
  },
  mail: {
    sendgridApiKey: process.env.SENDGRID_API_KEY,
    fromEmail: process.env.WEBSITE_ADMIN_FROM_EMAIL || 'noreply@stayhopper.com',
    fromName: process.env.WEBSITE_ADMIN_FROM_NAME || 'Stayhopper',
    bccEmail: process.env.WEBSITE_ADMIN_BCC_EMAIL,
    contactusEmail: process.env.WEBSITE_CONTACTUS_EMAIL || 'support@stayhopper.com',
    appUrl: process.env.APP_URL || 'https://account.stayhopper.com/',
    extranetUrl: process.env.EXTRANET_URL || 'https://extranet.stayhopper.com/',
    // Directories holding the legacy HTML templates (reuse the sh-api files or copy them in).
    emailsDir: process.env.EMAILS_DIR || 'emails',
    publicDir: process.env.PUBLIC_DIR || 'public',
  },
  };
};
