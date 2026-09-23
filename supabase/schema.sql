begin;

create extension if not exists pgcrypto;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code varchar(6) unique not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rooms_code_format check (code ~ '^[A-Z0-9]{6}$')
);

create table if not exists public.room_participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  participant_token uuid unique not null,
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  constraint room_participants_room_token_unique unique (room_id, participant_token)
);

create index if not exists room_participants_room_id_idx
  on public.room_participants(room_id);

create index if not exists room_participants_last_seen_idx
  on public.room_participants(last_seen);

alter table public.rooms enable row level security;
alter table public.room_participants enable row level security;

revoke all on table public.rooms from public, anon, authenticated;
revoke all on table public.room_participants from public, anon, authenticated;
grant select, insert, update, delete on table public.rooms to service_role;
grant select, insert, update, delete on table public.room_participants to service_role;

create or replace function public.enforce_room_participant_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1
  from public.rooms as r
  where r.id = new.room_id
  for update;

  if (
    select count(*)
    from public.room_participants as rp
    where rp.room_id = new.room_id
  ) >= 2 then
    raise exception 'A room cannot have more than two participants'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_room_participant_limit_trigger
  on public.room_participants;

create trigger enforce_room_participant_limit_trigger
before insert on public.room_participants
for each row execute function public.enforce_room_participant_limit();

create or replace function public.create_playlist_room(
  p_code text,
  p_participant_token uuid
)
returns table (
  result_status text,
  room_code text,
  participants_count integer,
  max_participants integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
begin
  if p_code !~ '^[A-Z0-9]{6}$' then
    raise exception 'Invalid room code' using errcode = '22023';
  end if;

  insert into public.rooms (code)
  values (p_code)
  returning id into v_room_id;

  insert into public.room_participants (room_id, participant_token)
  values (v_room_id, p_participant_token);

  return query
  select 'created'::text, p_code, 1, 2;
end;
$$;

create or replace function public.join_playlist_room(
  p_code text,
  p_participant_token uuid
)
returns table (
  result_status text,
  room_code text,
  participants_count integer,
  max_participants integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_count integer;
  v_is_member boolean;
begin
  select r.id
  into v_room_id
  from public.rooms as r
  where r.code = p_code
  for update;

  if v_room_id is null then
    return query select 'not_found'::text, p_code, 0, 2;
    return;
  end if;

  delete from public.room_participants as rp
  where rp.room_id = v_room_id
    and rp.last_seen < now() - interval '5 minutes';

  select exists (
    select 1
    from public.room_participants as rp
    where rp.room_id = v_room_id
      and rp.participant_token = p_participant_token
  ) into v_is_member;

  if v_is_member then
    update public.room_participants as rp
    set last_seen = now()
    where rp.room_id = v_room_id
      and rp.participant_token = p_participant_token;

    select count(*)::integer
    into v_count
    from public.room_participants as rp
    where rp.room_id = v_room_id;

    return query select 'reconnected'::text, p_code, v_count, 2;
    return;
  end if;

  select count(*)::integer
  into v_count
  from public.room_participants as rp
  where rp.room_id = v_room_id;

  if v_count >= 2 then
    return query select 'full'::text, p_code, v_count, 2;
    return;
  end if;

  begin
    insert into public.room_participants (room_id, participant_token)
    values (v_room_id, p_participant_token);
  exception
    when unique_violation then
      return query select 'token_conflict'::text, p_code, v_count, 2;
      return;
  end;

  update public.rooms as r
  set updated_at = now()
  where r.id = v_room_id;

  return query select 'joined'::text, p_code, v_count + 1, 2;
end;
$$;

create or replace function public.get_playlist_room(
  p_code text,
  p_participant_token uuid
)
returns table (
  result_status text,
  room_code text,
  participants_count integer,
  max_participants integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_count integer;
  v_is_member boolean;
begin
  select r.id
  into v_room_id
  from public.rooms as r
  where r.code = p_code
  for update;

  if v_room_id is null then
    return query select 'not_found'::text, p_code, 0, 2;
    return;
  end if;

  delete from public.room_participants as rp
  where rp.room_id = v_room_id
    and rp.last_seen < now() - interval '5 minutes';

  select count(*)::integer
  into v_count
  from public.room_participants as rp
  where rp.room_id = v_room_id;

  select exists (
    select 1
    from public.room_participants as rp
    where rp.room_id = v_room_id
      and rp.participant_token = p_participant_token
  ) into v_is_member;

  if v_count = 0 then
    delete from public.rooms as r where r.id = v_room_id;
  end if;

  if not v_is_member then
    return query select 'not_participant'::text, p_code, v_count, 2;
    return;
  end if;

  return query select 'ok'::text, p_code, v_count, 2;
end;
$$;

create or replace function public.leave_playlist_room(
  p_code text,
  p_participant_token uuid
)
returns table (
  result_status text,
  room_code text,
  participants_count integer,
  max_participants integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_count integer;
  v_deleted_count integer;
begin
  select r.id
  into v_room_id
  from public.rooms as r
  where r.code = p_code
  for update;

  if v_room_id is null then
    return query select 'not_found'::text, p_code, 0, 2;
    return;
  end if;

  delete from public.room_participants as rp
  where rp.room_id = v_room_id
    and rp.last_seen < now() - interval '5 minutes';

  delete from public.room_participants as rp
  where rp.room_id = v_room_id
    and rp.participant_token = p_participant_token;

  get diagnostics v_deleted_count = row_count;

  select count(*)::integer
  into v_count
  from public.room_participants as rp
  where rp.room_id = v_room_id;

  if v_count = 0 then
    delete from public.rooms as r where r.id = v_room_id;
  else
    update public.rooms as r
    set updated_at = now()
    where r.id = v_room_id;
  end if;

  return query
  select
    case when v_deleted_count > 0 then 'left' else 'not_participant' end::text,
    p_code,
    v_count,
    2;
end;
$$;

create or replace function public.heartbeat_playlist_room(
  p_code text,
  p_participant_token uuid
)
returns table (
  result_status text,
  room_code text,
  participants_count integer,
  max_participants integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_count integer;
  v_updated_count integer;
begin
  select r.id
  into v_room_id
  from public.rooms as r
  where r.code = p_code
  for update;

  if v_room_id is null then
    return query select 'not_found'::text, p_code, 0, 2;
    return;
  end if;

  update public.room_participants as rp
  set last_seen = now()
  where rp.room_id = v_room_id
    and rp.participant_token = p_participant_token;

  get diagnostics v_updated_count = row_count;

  delete from public.room_participants as rp
  where rp.room_id = v_room_id
    and rp.participant_token <> p_participant_token
    and rp.last_seen < now() - interval '5 minutes';

  select count(*)::integer
  into v_count
  from public.room_participants as rp
  where rp.room_id = v_room_id;

  if v_updated_count = 0 then
    if v_count = 0 then
      delete from public.rooms as r where r.id = v_room_id;
    end if;

    return query select 'not_participant'::text, p_code, v_count, 2;
    return;
  end if;

  update public.rooms as r
  set updated_at = now()
  where r.id = v_room_id;

  return query select 'ok'::text, p_code, v_count, 2;
end;
$$;

revoke execute on function public.create_playlist_room(text, uuid) from public, anon, authenticated;
revoke execute on function public.join_playlist_room(text, uuid) from public, anon, authenticated;
revoke execute on function public.get_playlist_room(text, uuid) from public, anon, authenticated;
revoke execute on function public.leave_playlist_room(text, uuid) from public, anon, authenticated;
revoke execute on function public.heartbeat_playlist_room(text, uuid) from public, anon, authenticated;
revoke execute on function public.enforce_room_participant_limit() from public, anon, authenticated;

grant execute on function public.create_playlist_room(text, uuid) to service_role;
grant execute on function public.join_playlist_room(text, uuid) to service_role;
grant execute on function public.get_playlist_room(text, uuid) to service_role;
grant execute on function public.leave_playlist_room(text, uuid) to service_role;
grant execute on function public.heartbeat_playlist_room(text, uuid) to service_role;
grant execute on function public.enforce_room_participant_limit() to service_role;

commit;
