# sh-api-nest

NestJS + Mongoose rewrite of the StayHopper admin API (the `admin/v2/*` surface
currently served by the legacy Express app in `sh-api/stayhopper`).

The migration is incremental: each legacy module under
`sh-api/stayhopper/admin/controllers/v2/<module>.js` is ported to a NestJS module
under `src/modules/<module>/`, reusing the existing MongoDB database and the same
`API_SECRET`, so the new service can run side-by-side with the old one during cutover.

## Stack
- NestJS 10, `@nestjs/mongoose` (Mongoose 8), `@nestjs/passport` + `@nestjs/jwt`
- MongoDB (existing StayHopper database — schemas mirror `stayhopper/db/models/*`)
- Global route prefix `admin/v2` (matches `sh-account` `config.apiUrl`)

## Setup
```bash
npm install
cp .env.example .env   # fill in MONGO_* , API_SECRET , SENDGRID_API_KEY
npm run start:dev
```
The server listens on `http://localhost:3008/admin/v2`.

> `API_SECRET` must equal the legacy backend's value so tokens issued by either
> service validate on both during the transition.

## Implemented modules
- **auth** — `POST /auth/login`, `POST /auth/auto-login`, `POST /auth/authorized`,
  `POST /auth/reset-password`, `POST /auth/change-password`, `POST /auth/logout`,
  `GET /auth/ping`. JWT (`jwt-administrator`) + local (`local-administrator-login`)
  strategies, ported 1:1 from `middleware/passport.js` and `v2/auth.js`.

See `MIGRATION.md` for the full module checklist and the porting pattern to follow
for the remaining modules.

## Project layout
```
src/
  main.ts                      # bootstrap, global prefix, validation, CORS
  app.module.ts                # root module (add ported modules here)
  config/configuration.ts      # env-backed config
  database/database.module.ts  # Mongoose connection (mirrors db/mongodb.js)
  common/mail/mail.service.ts  # SendGrid wrapper (reset-password email)
  modules/
    administrators/schemas/    # Administrator + Role schemas (shared by auth)
    auth/                       # controller, service, strategies, guards, dto
```
