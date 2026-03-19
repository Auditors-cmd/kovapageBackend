const { sequelize } = require('../config/database');

const statements = [
  `CREATE EXTENSION IF NOT EXISTS pgcrypto;`,
  `
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typname = 'enum_audit_plan_team_members_role'
        AND n.nspname = 'public'
    ) THEN
      CREATE TYPE public.enum_audit_plan_team_members_role AS ENUM ('lead', 'member', 'observer');
    END IF;
  END
  $$;
  `,
  `
  ALTER TABLE public.audit_plan_team_members
    ADD COLUMN IF NOT EXISTS "id" uuid,
    ADD COLUMN IF NOT EXISTS "role" public.enum_audit_plan_team_members_role DEFAULT 'member',
    ADD COLUMN IF NOT EXISTS "assignedAt" timestamptz DEFAULT NOW();
  `,
  `UPDATE public.audit_plan_team_members SET "id" = gen_random_uuid() WHERE "id" IS NULL;`,
  `UPDATE public.audit_plan_team_members SET "role" = 'member' WHERE "role" IS NULL;`,
  `UPDATE public.audit_plan_team_members SET "assignedAt" = COALESCE("createdAt", NOW()) WHERE "assignedAt" IS NULL;`,
  `ALTER TABLE public.audit_plan_team_members ALTER COLUMN "id" SET DEFAULT gen_random_uuid();`,
  `ALTER TABLE public.audit_plan_team_members ALTER COLUMN "id" SET NOT NULL;`,
  `ALTER TABLE public.audit_plan_team_members ALTER COLUMN "role" SET DEFAULT 'member';`,
  `ALTER TABLE public.audit_plan_team_members ALTER COLUMN "role" SET NOT NULL;`,
  `ALTER TABLE public.audit_plan_team_members ALTER COLUMN "assignedAt" SET DEFAULT NOW();`,
  `ALTER TABLE public.audit_plan_team_members ALTER COLUMN "assignedAt" SET NOT NULL;`,
  `
  DO $$
  DECLARE pk_name text;
  BEGIN
    SELECT tc.constraint_name
    INTO pk_name
    FROM information_schema.table_constraints tc
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'audit_plan_team_members'
      AND tc.constraint_type = 'PRIMARY KEY'
    LIMIT 1;

    IF pk_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.audit_plan_team_members DROP CONSTRAINT %I', pk_name);
    END IF;
  END
  $$;
  `,
  `
  ALTER TABLE public.audit_plan_team_members
    ADD CONSTRAINT audit_plan_team_members_pkey PRIMARY KEY ("id");
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS audit_plan_team_members_userid_auditplanid_key
  ON public.audit_plan_team_members ("userId", "auditPlanId");
  `,
  `
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typname = 'enum_dashboard_shares_permissions'
        AND n.nspname = 'public'
    ) THEN
      CREATE TYPE public.enum_dashboard_shares_permissions AS ENUM ('view', 'edit', 'admin');
    END IF;
  END
  $$;
  `,
  `
  ALTER TABLE public.dashboard_shares
    ADD COLUMN IF NOT EXISTS "id" uuid,
    ADD COLUMN IF NOT EXISTS "permissions" public.enum_dashboard_shares_permissions DEFAULT 'view',
    ADD COLUMN IF NOT EXISTS "sharedAt" timestamptz DEFAULT NOW();
  `,
  `UPDATE public.dashboard_shares SET "id" = gen_random_uuid() WHERE "id" IS NULL;`,
  `UPDATE public.dashboard_shares SET "permissions" = 'view' WHERE "permissions" IS NULL;`,
  `UPDATE public.dashboard_shares SET "sharedAt" = COALESCE("createdAt", NOW()) WHERE "sharedAt" IS NULL;`,
  `ALTER TABLE public.dashboard_shares ALTER COLUMN "id" SET DEFAULT gen_random_uuid();`,
  `ALTER TABLE public.dashboard_shares ALTER COLUMN "id" SET NOT NULL;`,
  `ALTER TABLE public.dashboard_shares ALTER COLUMN "permissions" SET DEFAULT 'view';`,
  `ALTER TABLE public.dashboard_shares ALTER COLUMN "permissions" SET NOT NULL;`,
  `ALTER TABLE public.dashboard_shares ALTER COLUMN "sharedAt" SET DEFAULT NOW();`,
  `ALTER TABLE public.dashboard_shares ALTER COLUMN "sharedAt" SET NOT NULL;`,
  `
  DO $$
  DECLARE pk_name text;
  BEGIN
    SELECT tc.constraint_name
    INTO pk_name
    FROM information_schema.table_constraints tc
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'dashboard_shares'
      AND tc.constraint_type = 'PRIMARY KEY'
    LIMIT 1;

    IF pk_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.dashboard_shares DROP CONSTRAINT %I', pk_name);
    END IF;
  END
  $$;
  `,
  `
  ALTER TABLE public.dashboard_shares
    ADD CONSTRAINT dashboard_shares_pkey PRIMARY KEY ("id");
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS dashboard_shares_dashboardid_userid_key
  ON public.dashboard_shares ("dashboardId", "userId");
  `
];

async function alignSchema() {
  try {
    await sequelize.authenticate();
    console.log('Connected. Starting schema alignment...');

    for (const statement of statements) {
      await sequelize.query(statement);
    }

    console.log('Schema alignment completed successfully.');
    process.exitCode = 0;
  } catch (error) {
    console.error('Schema alignment failed:', error);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

alignSchema();
