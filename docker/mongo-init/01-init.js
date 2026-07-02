/**
 * Runs ONCE on first MongoDB startup (empty /data/db), authenticated as the
 * root user. Creates the application DB user and seeds the minimum data the
 * admin API needs to accept a login.
 *
 * Re-run: `docker compose down -v` wipes the volume so this executes again.
 */

const DB_NAME = 'stayhopper';
const appDb = db.getSiblingDB(DB_NAME);

// ---- Application DB user (matches MONGO_URL authSource=stayhopper) ----
appDb.createUser({
  user: 'stayhopper',
  pwd: 'stayhopper123',
  roles: [{ role: 'readWrite', db: DB_NAME }],
});

// ---- Seed a role (collection: "roles") ----
const roleId = ObjectId();
appDb.roles.insertOne({
  _id: roleId,
  name: 'Super Admin',
  permissions: ['*'],
  createdAt: new Date(),
  updatedAt: new Date(),
});

// ---- Seed an administrator (collection: "administrators") ----
// email is unique in the schema; password is a bcrypt hash of "admin123".
appDb.administrators.createIndex({ email: 1 }, { unique: true });
appDb.administrators.insertOne({
  name: 'Admin',
  email: 'admin@stayhopper.com',
  password: '$2b$10$KD2a6fU/bl22kwx7pv08f.Wyd9D0B4qzY0.vKl7DkyuXl50EBHQTi',
  status: true,
  role: roleId,
  createdAt: new Date(),
  updatedAt: new Date(),
});

print('[mongo-init] Seeded DB "' + DB_NAME + '": app user + role + admin (admin@stayhopper.com / admin123)');
