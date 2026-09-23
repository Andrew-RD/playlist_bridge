begin;

alter table public.room_participants
  add column platform_role text,
  add constraint room_participants_platform_role_check
    check (platform_role in ('spotify', 'apple_music'));

update public.room_participants as rp
set platform_role = 'spotify'
from public.spotify_connections as sc
where sc.room_id = rp.room_id
  and sc.participant_id = rp.id;

update public.room_participants as rp
set platform_role = 'apple_music'
where rp.platform_role is null
  and exists (
    select 1
    from public.spotify_connections as sc
    where sc.room_id = rp.room_id
      and sc.participant_id <> rp.id
  );

create unique index room_participants_one_spotify_role_idx
  on public.room_participants(room_id)
  where platform_role = 'spotify';

create unique index room_participants_one_apple_role_idx
  on public.room_participants(room_id)
  where platform_role = 'apple_music';

create table public.apple_shortcut_connections (
  id uuid primary key default gen_random_uuid(),
  room_id uuid unique not null references public.rooms(id) on delete cascade,
  participant_id uuid unique not null,
  token_hash text unique not null,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  last_used_at timestamptz,
  constraint apple_shortcut_connections_room_participant_fk
    foreign key (room_id, participant_id)
    references public.room_participants(room_id, id) on delete cascade,
  constraint apple_shortcut_connections_token_hash_check
    check (token_hash ~ '^[0-9a-f]{64}$')
);

alter table public.apple_shortcut_connections enable row level security;
revoke all on table public.apple_shortcut_connections
  from public, anon, authenticated;
grant select, insert, update, delete on table public.apple_shortcut_connections
  to service_role;

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
  v_existing_role text;
  v_new_role text;
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

  select rp.platform_role
  into v_existing_role
  from public.room_participants as rp
  where rp.room_id = v_room_id
  limit 1;

  v_new_role := case v_existing_role
    when 'spotify' then 'apple_music'
    when 'apple_music' then 'spotify'
    else null
  end;

  begin
    insert into public.room_participants (
      room_id,
      participant_token,
      platform_role
    ) values (
      v_room_id,
      p_participant_token,
      v_new_role
    );
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

create function public.claim_platform_role(
  p_code text,
  p_participant_token uuid,
  p_platform_role text
)
returns table (
  result_status text,
  "current_role" text,
  partner_role text,
  roles_assigned boolean,
  apple_configured boolean,
  apple_verified boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_participant_id uuid;
  v_current_role text;
  v_partner_role text;
  v_participant_count integer;
  v_roles_count integer;
  v_apple_configured boolean := false;
  v_apple_verified boolean := false;
  v_complementary_role text;
begin
  if p_platform_role is null
    or p_platform_role not in ('spotify', 'apple_music') then
    raise exception 'Invalid platform role' using errcode = '22023';
  end if;

  select r.id
  into v_room_id
  from public.rooms as r
  where r.code = p_code
  for update;

  if v_room_id is null then
    return query
    select 'not_found'::text, null::text, null::text, false, false, false;
    return;
  end if;

  update public.room_participants as rp
  set last_seen = now()
  where rp.room_id = v_room_id
    and rp.participant_token = p_participant_token
  returning rp.id, rp.platform_role
  into v_participant_id, v_current_role;

  if v_participant_id is null then
    return query
    select 'not_participant'::text, null::text, null::text, false, false, false;
    return;
  end if;

  delete from public.room_participants as rp
  where rp.room_id = v_room_id
    and rp.id <> v_participant_id
    and rp.last_seen < now() - interval '5 minutes';

  if v_current_role is not null and v_current_role <> p_platform_role then
    return query
    select 'role_locked'::text, v_current_role, null::text, false, false, false;
    return;
  end if;

  if v_current_role is null and exists (
    select 1
    from public.room_participants as rp
    where rp.room_id = v_room_id
      and rp.id <> v_participant_id
      and rp.platform_role = p_platform_role
  ) then
    return query
    select 'role_taken'::text, null::text, p_platform_role, false, false, false;
    return;
  end if;

  if v_current_role is null then
    update public.room_participants as rp
    set platform_role = p_platform_role
    where rp.id = v_participant_id;

    v_current_role := p_platform_role;
    v_complementary_role := case p_platform_role
      when 'spotify' then 'apple_music'
      else 'spotify'
    end;

    update public.room_participants as rp
    set platform_role = v_complementary_role
    where rp.room_id = v_room_id
      and rp.id <> v_participant_id
      and rp.platform_role is null;
  end if;

  select rp.platform_role
  into v_partner_role
  from public.room_participants as rp
  where rp.room_id = v_room_id
    and rp.id <> v_participant_id
  limit 1;

  select count(*)::integer, count(rp.platform_role)::integer
  into v_participant_count, v_roles_count
  from public.room_participants as rp
  where rp.room_id = v_room_id;

  select true, ascx.verified_at is not null
  into v_apple_configured, v_apple_verified
  from public.apple_shortcut_connections as ascx
  where ascx.room_id = v_room_id;

  return query
  select
    case when v_current_role = p_platform_role then 'claimed' else 'ok' end::text,
    v_current_role,
    v_partner_role,
    v_participant_count = 2 and v_roles_count = 2,
    coalesce(v_apple_configured, false),
    coalesce(v_apple_verified, false);
end;
$$;

create function public.get_platform_room_state(
  p_code text,
  p_participant_token uuid
)
returns table (
  result_status text,
  "current_role" text,
  partner_role text,
  roles_assigned boolean,
  apple_configured boolean,
  apple_verified boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_participant_id uuid;
  v_current_role text;
  v_partner_role text;
  v_participant_count integer;
  v_roles_count integer;
  v_apple_configured boolean := false;
  v_apple_verified boolean := false;
begin
  select r.id
  into v_room_id
  from public.rooms as r
  where r.code = p_code;

  if v_room_id is null then
    return query
    select 'not_found'::text, null::text, null::text, false, false, false;
    return;
  end if;

  select rp.id, rp.platform_role
  into v_participant_id, v_current_role
  from public.room_participants as rp
  where rp.room_id = v_room_id
    and rp.participant_token = p_participant_token;

  if v_participant_id is null then
    return query
    select 'not_participant'::text, null::text, null::text, false, false, false;
    return;
  end if;

  select rp.platform_role
  into v_partner_role
  from public.room_participants as rp
  where rp.room_id = v_room_id
    and rp.id <> v_participant_id
  limit 1;

  select count(*)::integer, count(rp.platform_role)::integer
  into v_participant_count, v_roles_count
  from public.room_participants as rp
  where rp.room_id = v_room_id;

  select true, ascx.verified_at is not null
  into v_apple_configured, v_apple_verified
  from public.apple_shortcut_connections as ascx
  where ascx.room_id = v_room_id;

  return query
  select
    'ok'::text,
    v_current_role,
    v_partner_role,
    v_participant_count = 2 and v_roles_count = 2,
    coalesce(v_apple_configured, false),
    coalesce(v_apple_verified, false);
end;
$$;

create function public.configure_apple_shortcut(
  p_code text,
  p_participant_token uuid,
  p_token_hash text
)
returns table (
  result_status text,
  room_code text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_participant_id uuid;
  v_platform_role text;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid bridge token hash' using errcode = '22023';
  end if;

  select r.id
  into v_room_id
  from public.rooms as r
  where r.code = p_code
  for update;

  if v_room_id is null then
    return query select 'not_found'::text, null::text;
    return;
  end if;

  update public.room_participants as rp
  set last_seen = now()
  where rp.room_id = v_room_id
    and rp.participant_token = p_participant_token
  returning rp.id, rp.platform_role
  into v_participant_id, v_platform_role;

  if v_participant_id is null then
    return query select 'not_participant'::text, null::text;
    return;
  end if;

  if v_platform_role is distinct from 'apple_music' then
    return query select 'wrong_role'::text, p_code;
    return;
  end if;

  insert into public.apple_shortcut_connections (
    room_id,
    participant_id,
    token_hash
  ) values (
    v_room_id,
    v_participant_id,
    p_token_hash
  )
  on conflict (room_id) do update
  set participant_id = excluded.participant_id,
      token_hash = excluded.token_hash,
      created_at = now(),
      verified_at = null,
      last_used_at = null;

  return query select 'configured'::text, p_code;
end;
$$;

create function public.verify_apple_shortcut(p_token_hash text)
returns table (
  result_status text,
  room_code text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_room_code text;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return query select 'invalid'::text, null::text;
    return;
  end if;

  update public.apple_shortcut_connections as ascx
  set verified_at = coalesce(ascx.verified_at, now()),
      last_used_at = now()
  from public.room_participants as rp
  where ascx.token_hash = p_token_hash
    and rp.id = ascx.participant_id
    and rp.room_id = ascx.room_id
    and rp.platform_role = 'apple_music'
  returning ascx.room_id into v_room_id;

  if v_room_id is null then
    return query select 'invalid'::text, null::text;
    return;
  end if;

  select r.code
  into v_room_code
  from public.rooms as r
  where r.id = v_room_id;

  if v_room_code is null then
    return query select 'invalid'::text, null::text;
    return;
  end if;

  return query select 'verified'::text, v_room_code;
end;
$$;

create or replace function public.resolve_spotify_participant(
  p_code text,
  p_participant_token uuid
)
returns table (
  result_status text,
  resolved_room_id uuid,
  resolved_participant_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_participant_id uuid;
  v_platform_role text;
begin
  select r.id
  into v_room_id
  from public.rooms as r
  where r.code = p_code
  for update;

  if v_room_id is null then
    return query select 'not_found'::text, null::uuid, null::uuid;
    return;
  end if;

  update public.room_participants as rp
  set last_seen = now()
  where rp.room_id = v_room_id
    and rp.participant_token = p_participant_token
  returning rp.id, rp.platform_role
  into v_participant_id, v_platform_role;

  if v_participant_id is null then
    return query select 'not_participant'::text, v_room_id, null::uuid;
    return;
  end if;

  if v_platform_role is distinct from 'spotify' then
    return query select 'wrong_role'::text, v_room_id, v_participant_id;
    return;
  end if;

  return query select 'ok'::text, v_room_id, v_participant_id;
end;
$$;

create or replace function public.begin_spotify_oauth(
  p_code text,
  p_participant_token uuid,
  p_state uuid,
  p_expires_at timestamptz
)
returns table (result_status text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_participant_id uuid;
  v_platform_role text;
  v_connection_participant_id uuid;
begin
  if p_expires_at <= now() or p_expires_at > now() + interval '15 minutes' then
    raise exception 'Invalid OAuth state expiration' using errcode = '22023';
  end if;

  select r.id
  into v_room_id
  from public.rooms as r
  where r.code = p_code
  for update;

  if v_room_id is null then
    return query select 'not_found'::text;
    return;
  end if;

  update public.room_participants as rp
  set last_seen = now()
  where rp.room_id = v_room_id
    and rp.participant_token = p_participant_token
  returning rp.id, rp.platform_role
  into v_participant_id, v_platform_role;

  if v_participant_id is null then
    return query select 'not_participant'::text;
    return;
  end if;

  if v_platform_role is distinct from 'spotify' then
    return query select 'wrong_role'::text;
    return;
  end if;

  select sc.participant_id
  into v_connection_participant_id
  from public.spotify_connections as sc
  where sc.room_id = v_room_id;

  if v_connection_participant_id is not null
    and v_connection_participant_id <> v_participant_id then
    return query select 'already_connected'::text;
    return;
  end if;

  delete from public.spotify_oauth_states as sos
  where sos.expires_at <= now()
    or (
      sos.participant_id = v_participant_id
      and sos.consumed_at is null
    );

  insert into public.spotify_oauth_states (
    id,
    room_id,
    participant_id,
    expires_at
  ) values (
    p_state,
    v_room_id,
    v_participant_id,
    p_expires_at
  );

  return query select 'created'::text;
end;
$$;

create or replace function public.save_spotify_connection(
  p_room_id uuid,
  p_participant_id uuid,
  p_spotify_account_id text,
  p_spotify_user_id text,
  p_spotify_display_name text,
  p_encrypted_access_token text,
  p_encrypted_refresh_token text,
  p_token_expires_at timestamptz,
  p_scopes text[]
)
returns table (result_status text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing_participant_id uuid;
  v_existing_account_id text;
  v_platform_role text;
begin
  perform 1
  from public.rooms as r
  where r.id = p_room_id
  for update;

  if not found then
    return query select 'not_found'::text;
    return;
  end if;

  select rp.platform_role
  into v_platform_role
  from public.room_participants as rp
  where rp.id = p_participant_id
    and rp.room_id = p_room_id;

  if not found then
    return query select 'not_participant'::text;
    return;
  end if;

  if v_platform_role is distinct from 'spotify' then
    return query select 'wrong_role'::text;
    return;
  end if;

  select sc.participant_id, sc.spotify_account_id
  into v_existing_participant_id, v_existing_account_id
  from public.spotify_connections as sc
  where sc.room_id = p_room_id
  for update;

  if v_existing_participant_id is not null
    and v_existing_participant_id <> p_participant_id then
    return query select 'already_connected'::text;
    return;
  end if;

  if v_existing_account_id is not null
    and v_existing_account_id <> p_spotify_account_id then
    delete from public.room_spotify_playlists as rsp
    where rsp.room_id = p_room_id;
  end if;

  insert into public.spotify_connections (
    room_id,
    participant_id,
    spotify_account_id,
    spotify_user_id,
    spotify_display_name,
    encrypted_access_token,
    encrypted_refresh_token,
    token_expires_at,
    scopes
  ) values (
    p_room_id,
    p_participant_id,
    p_spotify_account_id,
    p_spotify_user_id,
    p_spotify_display_name,
    p_encrypted_access_token,
    p_encrypted_refresh_token,
    p_token_expires_at,
    coalesce(p_scopes, '{}'::text[])
  )
  on conflict (room_id) do update
  set participant_id = excluded.participant_id,
      spotify_account_id = excluded.spotify_account_id,
      spotify_user_id = excluded.spotify_user_id,
      spotify_display_name = excluded.spotify_display_name,
      encrypted_access_token = excluded.encrypted_access_token,
      encrypted_refresh_token = excluded.encrypted_refresh_token,
      token_expires_at = excluded.token_expires_at,
      scopes = excluded.scopes,
      updated_at = now();

  return query select 'connected'::text;
end;
$$;

create or replace function public.get_spotify_room_state(
  p_code text,
  p_participant_token uuid
)
returns table (
  result_status text,
  connected boolean,
  can_manage boolean,
  spotify_display_name text,
  spotify_playlist_id text,
  playlist_name text,
  owner_display_name text,
  spotify_url text,
  playlist_is_public boolean,
  playlist_collaborative boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_participant_id uuid;
  v_current_role text;
  v_connection_participant_id uuid;
  v_display_name text;
  v_playlist_id text;
  v_playlist_name text;
  v_owner_name text;
  v_spotify_url text;
  v_is_public boolean;
  v_collaborative boolean;
begin
  select r.id
  into v_room_id
  from public.rooms as r
  where r.code = p_code;

  if v_room_id is null then
    return query
    select 'not_found'::text, false, false, null::text, null::text,
      null::text, null::text, null::text, null::boolean, null::boolean;
    return;
  end if;

  select rp.id, rp.platform_role
  into v_participant_id, v_current_role
  from public.room_participants as rp
  where rp.room_id = v_room_id
    and rp.participant_token = p_participant_token;

  if v_participant_id is null then
    return query
    select 'not_participant'::text, false, false, null::text, null::text,
      null::text, null::text, null::text, null::boolean, null::boolean;
    return;
  end if;

  select sc.participant_id, sc.spotify_display_name
  into v_connection_participant_id, v_display_name
  from public.spotify_connections as sc
  where sc.room_id = v_room_id;

  select
    rsp.spotify_playlist_id,
    rsp.playlist_name,
    rsp.owner_display_name,
    rsp.spotify_url,
    rsp.is_public,
    rsp.collaborative
  into
    v_playlist_id,
    v_playlist_name,
    v_owner_name,
    v_spotify_url,
    v_is_public,
    v_collaborative
  from public.room_spotify_playlists as rsp
  where rsp.room_id = v_room_id;

  return query
  select
    'ok'::text,
    v_connection_participant_id is not null,
    v_current_role = 'spotify',
    v_display_name,
    v_playlist_id,
    v_playlist_name,
    v_owner_name,
    v_spotify_url,
    v_is_public,
    v_collaborative;
end;
$$;

create or replace function public.select_spotify_playlist(
  p_code text,
  p_participant_token uuid,
  p_spotify_playlist_id text,
  p_playlist_name text,
  p_owner_display_name text,
  p_spotify_url text,
  p_is_public boolean,
  p_collaborative boolean
)
returns table (result_status text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_participant_id uuid;
  v_platform_role text;
  v_connection_participant_id uuid;
begin
  select r.id
  into v_room_id
  from public.rooms as r
  where r.code = p_code
  for update;

  if v_room_id is null then
    return query select 'not_found'::text;
    return;
  end if;

  update public.room_participants as rp
  set last_seen = now()
  where rp.room_id = v_room_id
    and rp.participant_token = p_participant_token
  returning rp.id, rp.platform_role
  into v_participant_id, v_platform_role;

  if v_participant_id is null then
    return query select 'not_participant'::text;
    return;
  end if;

  if v_platform_role is distinct from 'spotify' then
    return query select 'wrong_role'::text;
    return;
  end if;

  select sc.participant_id
  into v_connection_participant_id
  from public.spotify_connections as sc
  where sc.room_id = v_room_id;

  if v_connection_participant_id is null then
    return query select 'not_connected'::text;
    return;
  end if;

  if v_connection_participant_id <> v_participant_id then
    return query select 'not_spotify_participant'::text;
    return;
  end if;

  insert into public.room_spotify_playlists (
    room_id,
    participant_id,
    spotify_playlist_id,
    playlist_name,
    owner_display_name,
    spotify_url,
    is_public,
    collaborative,
    selected_at
  ) values (
    v_room_id,
    v_participant_id,
    p_spotify_playlist_id,
    p_playlist_name,
    p_owner_display_name,
    p_spotify_url,
    p_is_public,
    coalesce(p_collaborative, false),
    now()
  )
  on conflict (room_id) do update
  set participant_id = excluded.participant_id,
      spotify_playlist_id = excluded.spotify_playlist_id,
      playlist_name = excluded.playlist_name,
      owner_display_name = excluded.owner_display_name,
      spotify_url = excluded.spotify_url,
      is_public = excluded.is_public,
      collaborative = excluded.collaborative,
      selected_at = now();

  return query select 'selected'::text;
end;
$$;

revoke execute on function public.claim_platform_role(text, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.get_platform_room_state(text, uuid)
  from public, anon, authenticated;
revoke execute on function public.configure_apple_shortcut(text, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.verify_apple_shortcut(text)
  from public, anon, authenticated;

grant execute on function public.claim_platform_role(text, uuid, text)
  to service_role;
grant execute on function public.get_platform_room_state(text, uuid)
  to service_role;
grant execute on function public.configure_apple_shortcut(text, uuid, text)
  to service_role;
grant execute on function public.verify_apple_shortcut(text)
  to service_role;

commit;
