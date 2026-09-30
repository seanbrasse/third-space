-- Supabase target blueprint: NOT an applied migration.
-- Generate an actual migration with `supabase migration new third_space_initial`,
-- copy/review this SQL, and validate an empty local DB + RLS tests before deployment.
-- The running local application uses SQLite; this is its production-provider roadmap.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check(char_length(display_name) between 1 and 96),
  avatar_config jsonb not null,
  preferences jsonb not null default '{}'::jsonb,
  revision bigint not null default 1 check(revision>0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.homes (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(user_id) on delete restrict,
  name text not null check(char_length(name) between 1 and 60), capacity integer not null default 4 check(capacity between 2 and 8),
  default_voice_mode text not null default 'proximity' check(default_voice_mode in ('proximity','room')),
  discord_url text, settings_revision bigint not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index homes_owner_idx on public.homes(owner_id);
create table public.home_members (
  home_id uuid not null references public.homes(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete restrict,
  role text not null check(role in ('owner','moderator','member')),
  status text not null default 'active' check(status in ('active','banned','left')),
  created_at timestamptz not null default now(), revoked_at timestamptz,
  primary key(home_id,user_id)
);
create index home_members_subject_idx on public.home_members(user_id,status,home_id);
create table private.invites (
  id uuid primary key default gen_random_uuid(), home_id uuid not null references public.homes(id) on delete cascade,
  token_hash text not null unique, expires_at timestamptz not null, revoked_at timestamptz,
  max_uses integer not null check(max_uses>0), use_count integer not null default 0 check(use_count>=0),
  created_by uuid not null references public.profiles(user_id), created_at timestamptz not null default now()
);
create index invites_home_idx on private.invites(home_id,created_at);
create table private.pin_credentials (
  home_id uuid primary key references public.homes(id) on delete cascade,
  verifier text not null, pin_version bigint not null default 1, enabled boolean not null default true,
  rotated_at timestamptz not null default now()
);
create table private.access_grants (
  id uuid primary key default gen_random_uuid(), home_id uuid not null references public.homes(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete restrict,
  type text not null check(type in ('owner','manual','invite','pin')),
  invite_id uuid references private.invites(id), pin_version bigint,
  revoked_at timestamptz, created_at timestamptz not null default now(),
  check ((type='invite' and invite_id is not null) or (type<>'invite' and invite_id is null)),
  check ((type='pin' and pin_version is not null) or (type<>'pin' and pin_version is null))
);
create index access_grants_member_idx on private.access_grants(home_id,user_id,revoked_at);
create index access_grants_invite_idx on private.access_grants(invite_id);
create table private.join_tickets (
  token_hash text primary key, user_id uuid not null references public.profiles(user_id),
  home_id uuid not null references public.homes(id) on delete cascade,
  instance_id text not null, generation bigint not null, process_epoch uuid not null,
  expires_at timestamptz not null, consumed_at timestamptz
);
create index join_tickets_expiry_idx on private.join_tickets(expires_at);
create table private.active_sessions (
  home_id uuid not null references public.homes(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id), session_id uuid not null unique,
  generation bigint not null, instance_id text not null, process_epoch uuid not null,
  lease_expires_at timestamptz not null, primary key(home_id,user_id)
);
create index active_sessions_lease_idx on private.active_sessions(lease_expires_at);
create table public.board_notes (
  id uuid primary key default gen_random_uuid(), home_id uuid not null references public.homes(id) on delete cascade,
  author_id uuid references public.profiles(user_id) on delete set null, author_label text not null,
  text text not null check(octet_length(text)<=16000), link text,
  x double precision not null check(x between 0 and 1), y double precision not null check(y between 0 and 1),
  revision bigint not null default 1 check(revision>0), deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index board_notes_home_idx on public.board_notes(home_id,updated_at,id);
create table private.board_requests (
  home_id uuid not null references public.homes(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id), request_id text not null,
  payload_hash text not null, note_id uuid not null references public.board_notes(id),
  primary key(home_id,user_id,request_id)
);
create table private.control_outbox (
  event_id uuid primary key default gen_random_uuid(), home_id uuid not null references public.homes(id) on delete cascade,
  type text not null, payload jsonb not null, created_at timestamptz not null default now(),
  processed_at timestamptz, attempt_count integer not null default 0
);
create index control_outbox_pending_idx on private.control_outbox(created_at) where processed_at is null;
create table private.rate_limits (
  key_hash text not null, window_start timestamptz not null, count integer not null check(count>=0),
  expires_at timestamptz not null, primary key(key_hash,window_start)
);
create index rate_limits_expiry_idx on private.rate_limits(expires_at);
create table private.audit_events (
  id uuid primary key default gen_random_uuid(), home_id uuid references public.homes(id) on delete set null,
  actor_id uuid references public.profiles(user_id) on delete set null, action text not null,
  target_id text, outcome text not null, created_at timestamptz not null default now()
);
create index audit_events_home_idx on private.audit_events(home_id,created_at);

-- Privileged server writes must implement the same transactional admission/CAS checks
-- as LocalStore; RLS alone does not authorize a service-role request.
alter table public.profiles enable row level security;
alter table public.homes enable row level security;
alter table public.home_members enable row level security;
alter table public.board_notes enable row level security;
alter table private.invites enable row level security;
alter table private.pin_credentials enable row level security;
alter table private.access_grants enable row level security;
alter table private.join_tickets enable row level security;
alter table private.active_sessions enable row level security;
alter table private.board_requests enable row level security;
alter table private.control_outbox enable row level security;
alter table private.rate_limits enable row level security;
alter table private.audit_events enable row level security;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

-- Narrow private helper prevents recursive home_members policies. No user_id argument;
-- subject always comes from verified auth.uid(). Its owner must be a migration-only role.
create function private.has_home_access(target_home uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.home_members m
    join private.access_grants g on g.home_id=m.home_id and g.user_id=m.user_id
    left join private.invites i on i.id=g.invite_id
    left join private.pin_credentials p on p.home_id=m.home_id
    where m.home_id=target_home and m.user_id=auth.uid() and m.status='active' and g.revoked_at is null
      and (g.type in ('owner','manual')
        or (g.type='invite' and i.revoked_at is null)
        or (g.type='pin' and p.enabled and p.pin_version=g.pin_version))
  );
$$;
revoke all on function private.has_home_access(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.has_home_access(uuid) to authenticated;
grant select on public.profiles, public.homes, public.home_members, public.board_notes to authenticated;
create policy profile_self_read on public.profiles for select to authenticated using ((select auth.uid())=user_id);
create policy homes_authorized_read on public.homes for select to authenticated using (private.has_home_access(id));
create policy members_authorized_read on public.home_members for select to authenticated using (private.has_home_access(home_id));
create policy board_authorized_read on public.board_notes for select to authenticated using (private.has_home_access(home_id));
-- All writes remain through authenticated backend repositories, avoiding exposed
-- generic SECURITY DEFINER mutation functions. API server checks OAuth identity,
-- active grants, role hierarchy, revisions, sizes, and rate limits on every write.
commit;
