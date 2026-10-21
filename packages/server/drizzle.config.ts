import { defineConfig } from 'drizzle-kit';

// One config for both dialects; the scheme of DATABASE_URL picks the schema file and output folder:
//   DATABASE_URL=sqlite::memory: bun run db:generate
//   DATABASE_URL=postgres://x bun run db:generate
const url = process.env.DATABASE_URL ?? 'sqlite::memory:';
const isPg = /^postgres(ql)?:/.test(url);

export default defineConfig(
  isPg
    ? { dialect: 'postgresql', schema: './src/db/schema.pg.ts', out: './src/db/migrations/postgres' }
    : { dialect: 'sqlite', schema: './src/db/schema.ts', out: './src/db/migrations/sqlite' },
);
