import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const migrationsDirectory = path.join(projectRoot, "supabase", "migrations");

const database = new PGlite({
  extensions: {
    pgcrypto,
  },
});

async function bootstrapSupabaseCompatibility() {
  await database.exec(`
    create role anon;
    create role authenticated;
    create role service_role;

    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );

    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select null::uuid
    $$;
  `);
}

async function applyMigrations() {
  const migrations = (await readdir(migrationsDirectory))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();

  assert.ok(migrations.length > 0, "Nie znaleziono migracji SQL.");

  for (const filename of migrations) {
    const sql = await readFile(path.join(migrationsDirectory, filename), "utf8");
    try {
      await database.exec(sql);
      process.stdout.write(`  OK ${filename}\n`);
    } catch (error) {
      error.message = `Migracja ${filename} nie przeszła:\n${error.message}`;
      throw error;
    }
  }

  return migrations.length;
}

async function verifySchemaAndCriticalRpcs() {
  const requiredRelations = [
    "public.organizations",
    "public.organization_members",
    "public.source_connectors",
    "public.delivery_accounts",
    "public.messages",
    "public.automations",
    "public.api_keys",
    "public.outbound_messages",
    "public.outbound_recipients",
  ];

  const relationResult = await database.query(
    `
      select relation_name
      from unnest($1::text[]) relation_name
      where to_regclass(relation_name) is not null
    `,
    [requiredRelations],
  );

  assert.equal(
    relationResult.rows.length,
    requiredRelations.length,
    "Nie wszystkie krytyczne relacje zostały utworzone.",
  );

  const organizationResult = await database.query(
    `
      insert into public.organizations (name, slug)
      values ('Migration Test', 'migration-test')
      returning id
    `,
  );
  const organizationId = organizationResult.rows[0].id;

  const accountResult = await database.query(
    `
      insert into public.delivery_accounts (
        organization_id,
        provider,
        name,
        from_email,
        status
      )
      values ($1, 'resend', 'Test account', 'sender@example.com', 'active')
      returning id
    `,
    [organizationId],
  );
  const accountId = accountResult.rows[0].id;

  const outboundResult = await database.query(
    `
      select *
      from public.create_outbound_with_recipients(
        $1::uuid,
        $2::uuid,
        null,
        null,
        'Test transakcyjnej wysyłki',
        'Treść testowa',
        '<p>Treść testowa</p>',
        '{"source":"migration-check"}'::jsonb,
        'pending',
        null,
        null,
        $3::jsonb
      )
    `,
    [
      organizationId,
      accountId,
      JSON.stringify([
        {
          email: "recipient@example.com",
          name: "Pierwszy rekord",
          variables: { language: "pl" },
        },
        {
          email: "RECIPIENT@example.com",
          name: "Duplikat",
          variables: {},
        },
      ]),
    ],
  );

  assert.equal(outboundResult.rows.length, 1);
  assert.equal(outboundResult.rows[0].recipient_count, 1);

  const recipientsResult = await database.query(
    `
      select count(*)::integer as count
      from public.outbound_recipients
      where outbound_message_id = $1
    `,
    [outboundResult.rows[0].id],
  );
  assert.equal(recipientsResult.rows[0].count, 1);

  const outboundCountBeforeFailure = await database.query(
    "select count(*)::integer as count from public.outbound_messages",
  );
  assert.equal(
    outboundCountBeforeFailure.rows[0].count,
    1,
    "Poprawne RPC utworzyło inną liczbę kampanii niż oczekiwano.",
  );

  await assert.rejects(
    database.query(
      `
        select public.create_outbound_with_recipients(
          $1::uuid,
          $2::uuid,
          null,
          null,
          'Niepoprawna wysyłka',
          null,
          null,
          '{}'::jsonb,
          'pending',
          null,
          null,
          '[{"email":"niepoprawny-adres"}]'::jsonb
        )
      `,
      [organizationId, accountId],
    ),
    /valid email address/,
  );

  const outboundCountAfterFailure = await database.query(
    "select count(*)::integer as count from public.outbound_messages",
  );
  assert.equal(
    outboundCountAfterFailure.rows[0].count,
    outboundCountBeforeFailure.rows[0].count,
    "Niepoprawna kampania pozostawiła częściowy zapis.",
  );

  const apiHash = "a".repeat(64);
  await database.query(
    `
      insert into public.api_keys (
        organization_id,
        name,
        key_prefix,
        key_hash,
        scopes,
        rate_limit_per_minute
      )
      values ($1, 'Migration test', 'mfs_test_abcdef', $2, $3, 2)
    `,
    [organizationId, apiHash, ["messages:read"]],
  );

  const authorizationResult = await database.query(
    `
      select *
      from public.authorize_api_key(
        $1,
        'messages:read',
        '203.0.113.10'::inet
      )
    `,
    [apiHash],
  );
  assert.equal(authorizationResult.rows[0].authorized, true);
  assert.equal(authorizationResult.rows[0].remaining, 1);

  const reportResult = await database.query(
    "select public.get_organization_report($1::uuid, 14) as report",
    [organizationId],
  );
  const directCampaignCount = await database.query(
    `
      select count(*)::integer as count
      from public.outbound_messages
      where organization_id = $1
    `,
    [organizationId],
  );
  assert.equal(reportResult.rows[0].report.range.days, 14);
  assert.equal(
    reportResult.rows[0].report.outbound.campaigns,
    directCampaignCount.rows[0].count,
    `Raport zwrócił niespójny licznik: ${JSON.stringify(
      reportResult.rows[0].report.outbound,
    )}`,
  );

  const seededRolesResult = await database.query(
    `
      select count(*)::integer as count
      from public.organization_roles
      where organization_id = $1
    `,
    [organizationId],
  );
  assert.equal(
    seededRolesResult.rows[0].count,
    5,
    "Nowa organizacja nie otrzymała kompletu ról wbudowanych.",
  );
}

try {
  process.stdout.write("Sprawdzanie migracji Supabase na pustym PostgreSQL...\n");
  await bootstrapSupabaseCompatibility();
  const migrationCount = await applyMigrations();
  await verifySchemaAndCriticalRpcs();
  process.stdout.write(
    `Migracje poprawne: ${migrationCount}. Krytyczne RPC i atomowość zweryfikowane.\n`,
  );
} finally {
  await database.close();
}
