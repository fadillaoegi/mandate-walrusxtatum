import pg from "pg";

export type Db = pg.Pool;

export function createDb(url: string): Db {
  return new pg.Pool({ connectionString: url, max: 5 });
}

const MIGRATIONS = [
  `create table if not exists requests (
     id text primary key,
     created_at timestamptz not null,
     data jsonb not null)`,
  `create table if not exists memory_log (
     ref text primary key,
     blob_id text,
     status text not null,
     error text,
     namespace text not null,
     store text not null,
     written_by text not null,
     text text not null,
     event jsonb not null,
     created_at timestamptz not null)`,
  // One-off move from the first schema (blob id was the key, writes were synchronous).
  `do $$ begin
     if exists (select from information_schema.tables where table_name = 'memory_index') then
       insert into memory_log (ref, blob_id, status, namespace, store, written_by, text, event, created_at)
         select blob_id, blob_id, 'stored', 'mandate-demo', store, written_by, text, event, created_at from memory_index
         on conflict (ref) do nothing;
       drop table memory_index;
     end if;
   end $$`,
  `create table if not exists demo_run (
     id int primary key default 1 check (id = 1),
     run int not null)`,
  `insert into demo_run (id, run) values (1, 1) on conflict (id) do nothing`,
  `create table if not exists agent_sessions (
     id serial primary key,
     agent_id text not null,
     started_at timestamptz not null default now())`,
  `create table if not exists local_memories (
     id serial primary key,
     blob_id text unique not null,
     namespace text not null,
     text text not null,
     created_at timestamptz not null default now())`,
  `create table if not exists delegate_state (
     delegate_id text primary key,
     active boolean not null,
     changed_at timestamptz not null default now())`,
  "alter table delegate_state add column if not exists revoked_by text",
  `create table if not exists x402_digests (
     digest text primary key,
     created_at timestamptz not null default now())`,
  "alter table delegate_state add column if not exists checked_at timestamptz",
  `create table if not exists local_ledger (
     digest text primary key,
     status text not null,
     amount bigint not null,
     pay_to text not null,
     created_at timestamptz not null default now())`,
  "alter table local_ledger add column if not exists payer text",
];

export async function migrate(db: Db): Promise<void> {
  for (const sql of MIGRATIONS) await db.query(sql);
}
