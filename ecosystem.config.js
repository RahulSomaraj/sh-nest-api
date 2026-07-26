/**
 * PM2 process configuration for sh-api-nest.
 *
 * Deploy sequence:
 *   npm ci
 *   npm run build                 # compile TypeScript -> dist/
 *   npm run indexes:sync          # build DB indexes (production runs autoIndex off)
 *   pm2 start ecosystem.config.js --env production
 *
 * Zero-downtime redeploy:
 *   npm run build && npm run indexes:sync
 *   pm2 reload ecosystem.config.js --env production
 *   # `wait_ready` makes PM2 hold the old instance until the new one emits 'ready'
 *   # (main.ts calls process.send('ready') after app.listen).
 *
 * One-time log rotation setup (PM2 module, not part of this file):
 *   pm2 install pm2-logrotate
 *   pm2 set pm2-logrotate:max_size 10M
 *   pm2 set pm2-logrotate:retain 14
 *   pm2 set pm2-logrotate:compress true
 *
 * Scaling: set PM2_INSTANCES=max (or a number) to run cluster mode across cores.
 * The app is stateless (no in-process session/state that isn't in Mongo), so cluster
 * mode is safe; the API-usage buffer is per-worker but each flushes to Mongo with $inc.
 */
module.exports = {
  apps: [
    {
      name: 'sh-api-nest',
      script: 'dist/main.js',
      cwd: __dirname,

      // --- Scaling ---
      // Default: single fork. PM2_INSTANCES=max|<n> switches to cluster mode.
      instances: process.env.PM2_INSTANCES || 1,
      exec_mode:
        process.env.PM2_INSTANCES && process.env.PM2_INSTANCES !== '1'
          ? 'cluster'
          : 'fork',

      // --- Restart policy ---
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      // Recycle a worker that leaks past this threshold (audit: memory restart threshold).
      max_memory_restart: '512M',

      // --- Graceful shutdown (pairs with app.enableShutdownHooks in main.ts) ---
      // On stop/reload PM2 sends SIGINT; give in-flight requests time to drain and the
      // Mongo connection time to close before PM2 escalates to SIGKILL.
      kill_timeout: 10000,
      // Hold the previous instance during a reload until the new one is actually listening.
      wait_ready: true,
      listen_timeout: 10000,

      // --- Logs (rotate via pm2-logrotate; see header) ---
      time: true,
      merge_logs: true,
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // NODE_ENV drives CORS lockout + autoIndex behaviour. Real secrets (API_SECRET,
      // MONGO_URL, CORS_ORIGINS, PAYMENT_WEBHOOK_SECRET, ...) come from the server's
      // environment / .env — do not commit them here.
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
