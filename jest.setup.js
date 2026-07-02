// Jest global setup.
// 1) Decorated Nest classes (@Injectable, @Controller, @InjectModel...) call
//    Reflect.defineMetadata at import time — load the polyfill first.
require('reflect-metadata');

// 2) config/configuration.ts fails fast without API_SECRET (audit A1),
//    so provide a test secret for any spec that loads configuration.
process.env.API_SECRET = process.env.API_SECRET || 'test-secret';
