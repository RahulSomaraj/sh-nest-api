export default () => {
  // audit A1: fail fast — never boot with a forgeable default JWT secret.
  if (!process.env.API_SECRET) {
    throw new Error('API_SECRET environment variable must be set (JWT signing secret)');
  }
  return {
  port: parseInt(process.env.PORT, 10) || 3008,
  // Route prefixes are applied per-surface by RouterModule (AppModule), not globally:
  // admin/v2 = extranet + sh-account, api = sh-website customer surface.
  adminPrefix: process.env.API_GLOBAL_PREFIX || 'admin/v2',
  customerPrefix: process.env.API_CUSTOMER_PREFIX || 'api',
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
  // audit C-1: shared secret for HMAC-verifying payment capture/return webhooks.
  // When unset, PaymentWebhookGuard logs a warning and allows (non-breaking rollout).
  paymentWebhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || '',
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
    // Legacy config/default.json recipients used by the customer surface.
    adminEmail: process.env.WEBSITE_ADMIN_EMAIL || 'info@stayhopper.com',
    cancellationEmail: process.env.WEBSITE_CANCELLATION_EMAIL || 'support@stayhopper.com',
    invoiceEmail: process.env.INVOICE_EMAIL || 'accounts@stayhopper.com',
    unpaidEmail: process.env.UNPAID_EMAIL || 'unpaid@stayhopper.com',
  },

  // ---------------------------------------------------------------------------
  // Customer (`/api`) surface — legacy `config` values used by controllers/api/*
  // and services/*. Names mirror the legacy keys so the ported code reads the same.
  // ---------------------------------------------------------------------------

  appName: process.env.APP_NAME || 'StayHopper',
  websiteUrl: process.env.WEBSITE_URL || 'https://www.stayhopper.com/',

  // `countrySelection` middleware default (config.countryId.UAE).
  countryId: {
    UAE: process.env.COUNTRY_ID_UAE || '5b87b5e26ebfc73aed2589f7',
  },
  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'Asia/Dubai',

  // config.pageSize
  pageSize: {
    popularProperties: parseInt(process.env.PAGE_SIZE_POPULAR, 10) || 10,
    cheapestProperties: parseInt(process.env.PAGE_SIZE_CHEAPEST, 10) || 10,
    searchProperties: parseInt(process.env.PAGE_SIZE_SEARCH, 10) || 10,
  },

  // Pricing / booking constants (config.*). Changing these changes money math —
  // they are deliberately identical to legacy config/default.json + production.json.
  bookingCharge: parseFloat(process.env.BOOKING_CHARGE) || 10,
  mamopayCharges: parseFloat(process.env.MAMOPAY_CHARGES) || 6,
  dailyHours: parseInt(process.env.DAILY_HOURS, 10) || 22,
  rebookingAmt: parseFloat(process.env.REBOOKING_AMT) || 10,
  vat: parseFloat(process.env.VAT) || 5,
  maxDistance: parseInt(process.env.MAX_DISTANCE, 10) || 4000,
  dateBlockNumber: parseInt(process.env.DATE_BLOCK_NUMBER, 10) || 30,
  minNumberOfBookingHours:
    parseInt(process.env.MIN_NUMBER_OF_BOOKING_HOURS, 10) || 4,
  testProperty: process.env.TEST_PROPERTY || '5c34612e63b3ad0b1d4602fd',

  /**
   * config.bookingFee — per-country, per-bookingType platform fee.
   * Override wholesale with BOOKING_FEE_JSON (same shape) if the table changes.
   */
  bookingFee: parseJson(process.env.BOOKING_FEE_JSON, {
    // UAE
    '5b87b5e26ebfc73aed2589f7': [
      {
        commentsForAdmin: 'UAE / AED / hourly',
        currency: '5b616c7556fa98278f681e4a',
        bookingType: 'hourly',
        fee: 10,
      },
      {
        commentsForAdmin: 'UAE / AED / monthly',
        currency: '5b616c7556fa98278f681e4a',
        bookingType: 'monthly',
        fee: 25,
      },
    ],
    // India
    '5f0c7437f90937c4c19a1adf': [
      {
        commentsForAdmin: 'India / RS / hourly',
        currency: '5f0cbd9dba4abaf8e4f45892',
        bookingType: 'hourly',
        fee: 300,
      },
      {
        commentsForAdmin: 'India / RS / monthly',
        currency: '5f0cbd9dba4abaf8e4f45892',
        bookingType: 'monthly',
        fee: 450,
      },
    ],
  }),

  // Mailchimp list subscriptions (website subscribe + user signup).
  mailchimp: {
    apiKey: process.env.MAILCHIMP_API_KEY || '',
    listId: process.env.MAILCHIMP_LIST_ID || '',
    adminListId: process.env.MAILCHIMP_ADMIN_LIST_ID || '',
    androidId: process.env.MAILCHIMP_ANDROID_ID || '',
    iosId: process.env.MAILCHIMP_IOS_ID || '',
  },

  /**
   * Google Maps Geocoding — MIGRATION.md 2g#4: the legacy key was committed in
   * `controllers/api/v2/main.js:18`. It must come from the environment and the old
   * one must be rotated. Empty => the geocode redirect route returns its error path.
   */
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',

  /**
   * Push notifications. Legacy used the decommissioned FCM *legacy* HTTP API with a
   * committed server key; ported jobs use FCM HTTP v1 with a service-account JSON.
   * Pushes are no-ops unless ENABLE_PUSH=true and the credentials resolve.
   */
  push: {
    enabled: process.env.ENABLE_PUSH === 'true',
    // Path to (or inline JSON of) the Firebase service-account credentials.
    serviceAccountPath: process.env.FCM_SERVICE_ACCOUNT_PATH || '',
    serviceAccountJson: process.env.FCM_SERVICE_ACCOUNT_JSON || '',
    projectId: process.env.FCM_PROJECT_ID || '',
  },

  /**
   * Background jobs (phase 3). Must be true on EXACTLY ONE PM2 instance — the jobs
   * mutate slot/booking state and send pushes; double-running double-fires them.
   */
  enableCron: process.env.ENABLE_CRON === 'true',

  /**
   * HyperGuest B2B supplier integration (phase 4, HYPERGUEST_PLAN.md).
   * Disabled by default — with HG_ENABLED unset, no HyperGuest code runs at all
   * (no outbound calls, no sync cron, no search merge) and every customer
   * envelope is byte-identical to pre-integration behaviour.
   *
   * CERTIFICATION MODE (default true): every outbound call is asserted against
   * `certPropertyId` (19912) and booking creation always sends charge:false —
   * the charge:false part is hard-coded in the client regardless of config.
   * Set HG_CERTIFICATION=false only after HyperGuest certifies the integration
   * and a LIVE token is issued.
   */
  hyperguest: {
    enabled: process.env.HG_ENABLED === 'true',
    token: process.env.HG_TOKEN || '',
    searchUrl: process.env.HG_SEARCH_URL || 'https://search-api.hyperguest.io/2.0/',
    bookUrl: process.env.HG_BOOK_URL || 'https://book-api.hyperguest.com/2.0/',
    staticUrl: process.env.HG_STATIC_URL || 'https://hg-static.hyperguest.com/',
    certification: process.env.HG_CERTIFICATION !== 'false',
    certPropertyId: parseInt(process.env.HG_CERT_PROPERTY_ID, 10) || 19912,
    // `reference.agency` sent on booking create; also the reconciliation list filter.
    agencyReference: process.env.HG_AGENCY_REFERENCE || 'stayhopper',
    timeoutMs: parseInt(process.env.HG_TIMEOUT_MS, 10) || 15_000,
    /**
     * Owner ObjectId stamped on materialized HyperGuest properties
     * (property.administrator is a required ref). Deliberately a dangling,
     * reserved id — HG properties belong to no extranet admin, owner-scoped
     * admin queries never match them, and populate() yields null (tolerated
     * everywhere `company: null` already is).
     */
    systemAdminId: process.env.HG_SYSTEM_ADMIN_ID || 'ffffffffffff000000004847',
  },
  };
};

/** Parse a JSON env override, falling back to the built-in default when unset/invalid. */
function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error('BOOKING_FEE_JSON is not valid JSON');
  }
}
