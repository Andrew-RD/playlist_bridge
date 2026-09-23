begin;

alter table public.room_participants
  add constraint room_participants_room_id_id_unique unique (room_id, id);

create table public.spotify_oauth_states (
  id uuid primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  participant_id uuid not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint spotify_oauth_states_room_participant_fk
    foreign key (room_id, participant_id)
    references public.room_participants(room_id, id) on delete cascade,
  constraint spotify_oauth_states_expiry check (expires_at > created_at)
);

create table public.spotify_connections (
  id uuid primary key default gen_random_uuid(),
  room_id uuid unique not null references public.rooms(id) on delete cascade,
  participant_id uuid unique not null,
  spotify_account_id text not null,
  spotify_user_id text,
  spotify_display_name text,
  encrypted_access_token text not null,
  encrypted_refresh_token text not null,
  token_expires_at timestamptz not null,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint spotify_connections_room_participant_fk
    foreign key (room_id, participant_id)
    references public.room_participants(room_id, id) on delete cascade
);

create table public.room_spotify_playlists (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  participant_id uuid not null,
  spotify_playlist_id text not null,
  playlist_name text not null,
  owner_display_name text,
  spotify_url text,
  is_public boolean,
  collaborative boolean not null default false,
  selected_at timestamptz not null default now(),
  constraint room_spotify_playlists_room_participant_fk
    foreign key (room_id, participant_id)
    references public.room_participants(room_id, id) on delete cascade,
  constraint room_spotify_playlists_id_length
    check (length(spotify_playlist_id) between 1 and 128),
  constraint room_spotify_playlists_name_length
    check (length(playlist_name) between 1 and 500)
);

create index spotify_oauth_states_participant_idx
  on public.spotify_oauth_states(participant_id);

create index spotify_oauth_states_expires_idx
  on public.spotify_oauth_states(expires_at)
  where consumed_at is null;

create index spotify_connections_account_idx
  on public.spotify_connections(spotify_account_id);

create index room_spotify_playlists_participant_idx
  on public.room_spotify_playlists(participant_id);

alter table public.spotify_oauth_states enable row level security;
alter table public.spotify_connections enable row level security;
alter table public.room_spotify_playlists enable row level security;

revoke all on table public.spotify_oauth_states from public, anon, authenticated;
revoke all on table public.spotify_connections from public, anon, authenticated;
revoke all on table public.room_spotify_playlists from public, anon, authenticated;

grant select, insert, update, delete on table public.spotify_oauth_states to service_role;
grant select, insert, update, delete on table public.spotify_connections to service_role;
grant select, insert, update, delete on table public.room_spotify_playlists to service_role;

create function public.resolve_spotify_participant(
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
  returning rp.id into v_participant_id;

  if v_participant_id is null then
    return query select 'not_participant'::text, v_room_id, null::uuid;
    return;
  end if;

  return query select 'ok'::text, v_room_id, v_participant_id;
end;
$$;

create function public.begin_spotify_oauth(
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
  returning rp.id into v_participant_id;

  if v_participant_id is null then
    return query select 'not_participant'::text;
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

create function public.consume_spotify_oauth_state(p_state uuid)
returns table (
  result_status text,
  room_code text,
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
  v_room_code text;
begin
  update public.spotify_oauth_states as sos
  set consumed_at = now()
  where sos.id = p_state
    and sos.consumed_at is null
    and sos.expires_at > now()
  returning sos.room_id, sos.participant_id
  into v_room_id, v_participant_id;

  if v_room_id is null then
    return query
    select 'invalid'::text, null::text, null::uuid, null::uuid;
    return;
  end if;

  select r.code
  into v_room_code
  from public.rooms as r
  where r.id = v_room_id;

  if v_room_code is null then
    return query
    select 'invalid'::text, null::text, null::uuid, null::uuid;
    return;
  end if;

  return query
  select 'consumed'::text, v_room_code, v_room_id, v_participant_id;
end;
$$;

create function public.save_spotify_connection(
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
begin
  perform 1
  from public.rooms as r
  where r.id = p_room_id
  for update;

  if not found then
    return query select 'not_found'::text;
    return;
  end if;

  if not exists (
    select 1
    from public.room_participants as rp
    where rp.id = p_participant_id
      and rp.room_id = p_room_id
  ) then
    return query select 'not_participant'::text;
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

create function public.get_spotify_room_state(
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

  select rp.id
  into v_participant_id
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
    v_connection_participant_id = v_participant_id,
    v_display_name,
    v_playlist_id,
    v_playlist_name,
    v_owner_name,
    v_spotify_url,
    v_is_public,
    v_collaborative;
end;
$$;

create function public.select_spotify_playlist(
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
  returning rp.id into v_participant_id;

  if v_participant_id is null then
    return query select 'not_participant'::text;
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

revoke execute on function public.resolve_spotify_participant(text, uuid)
  from public, anon, authenticated;
revoke execute on function public.begin_spotify_oauth(text, uuid, uuid, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.consume_spotify_oauth_state(uuid)
  from public, anon, authenticated;
revoke execute on function public.save_spotify_connection(
  uuid, uuid, text, text, text, text, text, timestamptz, text[]
) from public, anon, authenticated;
revoke execute on function public.get_spotify_room_state(text, uuid)
  from public, anon, authenticated;
revoke execute on function public.select_spotify_playlist(
  text, uuid, text, text, text, text, boolean, boolean
) from public, anon, authenticated;

grant execute on function public.resolve_spotify_participant(text, uuid)
  to service_role;
grant execute on function public.begin_spotify_oauth(text, uuid, uuid, timestamptz)
  to service_role;
grant execute on function public.consume_spotify_oauth_state(uuid)
  to service_role;
grant execute on function public.save_spotify_connection(
  uuid, uuid, text, text, text, text, text, timestamptz, text[]
) to service_role;
grant execute on function public.get_spotify_room_state(text, uuid)
  to service_role;
grant execute on function public.select_spotify_playlist(
  text, uuid, text, text, text, text, boolean, boolean
) to service_role;

commit;
