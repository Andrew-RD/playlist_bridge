begin;

create table public.apple_sync_items (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  spotify_playlist_id text not null,
  spotify_uri text not null,
  spotify_track_id text,
  title text not null,
  artists text[] not null,
  primary_artist text not null,
  album text,
  duration_ms integer,
  spotify_url text,
  search_query text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  synced_at timestamptz,
  last_attempt_at timestamptz,
  constraint apple_sync_items_source_unique
    unique (room_id, spotify_playlist_id, spotify_uri),
  constraint apple_sync_items_status_check
    check (status in ('pending', 'added', 'not_found')),
  constraint apple_sync_items_attempts_check
    check (attempts >= 0),
  constraint apple_sync_items_duration_check
    check (duration_ms is null or duration_ms >= 0),
  constraint apple_sync_items_playlist_id_check
    check (length(spotify_playlist_id) between 1 and 128),
  constraint apple_sync_items_uri_check
    check (length(spotify_uri) between 1 and 500),
  constraint apple_sync_items_title_check
    check (length(title) between 1 and 1000),
  constraint apple_sync_items_artists_check
    check (cardinality(artists) > 0),
  constraint apple_sync_items_primary_artist_check
    check (length(primary_artist) between 1 and 500),
  constraint apple_sync_items_album_check
    check (album is null or length(album) <= 1000),
  constraint apple_sync_items_url_check
    check (spotify_url is null or length(spotify_url) <= 2048),
  constraint apple_sync_items_search_query_check
    check (length(search_query) between 1 and 2000)
);

create index apple_sync_items_status_idx
  on public.apple_sync_items(room_id, spotify_playlist_id, status);

create index apple_sync_items_pending_idx
  on public.apple_sync_items(room_id, spotify_playlist_id, created_at, id)
  where status = 'pending';

alter table public.apple_sync_items enable row level security;
revoke all on table public.apple_sync_items from public, anon, authenticated;
grant select, insert, update, delete on table public.apple_sync_items
  to service_role;

create function public.resolve_apple_sync_context(p_token_hash text)
returns table (
  result_status text,
  room_code text,
  resolved_room_id uuid,
  apple_participant_id uuid,
  spotify_participant_id uuid,
  spotify_playlist_id text,
  spotify_playlist_name text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_apple_participant_id uuid;
  v_verified_at timestamptz;
  v_room_code text;
  v_spotify_participant_id uuid;
  v_playlist_id text;
  v_playlist_name text;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return query
    select 'invalid'::text, null::text, null::uuid, null::uuid,
      null::uuid, null::text, null::text;
    return;
  end if;

  select ascx.room_id, ascx.participant_id, ascx.verified_at
  into v_room_id, v_apple_participant_id, v_verified_at
  from public.apple_shortcut_connections as ascx
  join public.room_participants as apple_rp
    on apple_rp.id = ascx.participant_id
    and apple_rp.room_id = ascx.room_id
    and apple_rp.platform_role = 'apple_music'
  where ascx.token_hash = p_token_hash
  for update of ascx;

  if v_room_id is null then
    return query
    select 'invalid'::text, null::text, null::uuid, null::uuid,
      null::uuid, null::text, null::text;
    return;
  end if;

  if v_verified_at is null then
    return query
    select 'shortcut_not_verified'::text, null::text, v_room_id,
      v_apple_participant_id, null::uuid, null::text, null::text;
    return;
  end if;

  update public.apple_shortcut_connections as ascx
  set last_used_at = now()
  where ascx.room_id = v_room_id;

  select r.code
  into v_room_code
  from public.rooms as r
  where r.id = v_room_id;

  if v_room_code is null then
    return query
    select 'invalid'::text, null::text, null::uuid, null::uuid,
      null::uuid, null::text, null::text;
    return;
  end if;

  select sc.participant_id
  into v_spotify_participant_id
  from public.spotify_connections as sc
  join public.room_participants as spotify_rp
    on spotify_rp.id = sc.participant_id
    and spotify_rp.room_id = sc.room_id
    and spotify_rp.platform_role = 'spotify'
  where sc.room_id = v_room_id;

  if v_spotify_participant_id is null then
    return query
    select 'spotify_not_connected'::text, v_room_code, v_room_id,
      v_apple_participant_id, null::uuid, null::text, null::text;
    return;
  end if;

  select rsp.spotify_playlist_id, rsp.playlist_name
  into v_playlist_id, v_playlist_name
  from public.room_spotify_playlists as rsp
  where rsp.room_id = v_room_id
    and rsp.participant_id = v_spotify_participant_id;

  if v_playlist_id is null then
    return query
    select 'playlist_not_selected'::text, v_room_code, v_room_id,
      v_apple_participant_id, v_spotify_participant_id,
      null::text, null::text;
    return;
  end if;

  return query
  select 'ready'::text, v_room_code, v_room_id,
    v_apple_participant_id, v_spotify_participant_id,
    v_playlist_id, v_playlist_name;
end;
$$;

create function public.upsert_apple_sync_items(
  p_room_id uuid,
  p_spotify_playlist_id text,
  p_items jsonb
)
returns table (
  result_status text,
  affected_count integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_affected_count integer;
begin
  if p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) > 250 then
    raise exception 'Invalid sync item batch' using errcode = '22023';
  end if;

  perform 1
  from public.rooms as r
  where r.id = p_room_id
  for update;

  if not found then
    return query select 'not_found'::text, 0;
    return;
  end if;

  if not exists (
    select 1
    from public.room_spotify_playlists as rsp
    where rsp.room_id = p_room_id
      and rsp.spotify_playlist_id = p_spotify_playlist_id
  ) then
    return query select 'playlist_changed'::text, 0;
    return;
  end if;

  insert into public.apple_sync_items (
    room_id,
    spotify_playlist_id,
    spotify_uri,
    spotify_track_id,
    title,
    artists,
    primary_artist,
    album,
    duration_ms,
    spotify_url,
    search_query
  )
  select distinct on (item.spotify_uri)
    p_room_id,
    p_spotify_playlist_id,
    item.spotify_uri,
    item.spotify_track_id,
    item.title,
    item.artists,
    item.primary_artist,
    item.album,
    item.duration_ms,
    item.spotify_url,
    item.search_query
  from jsonb_to_recordset(p_items) as item (
    spotify_uri text,
    spotify_track_id text,
    title text,
    artists text[],
    primary_artist text,
    album text,
    duration_ms integer,
    spotify_url text,
    search_query text
  )
  where item.spotify_uri is not null
    and item.title is not null
    and cardinality(item.artists) > 0
    and item.primary_artist is not null
    and item.search_query is not null
  order by item.spotify_uri
  on conflict (room_id, spotify_playlist_id, spotify_uri) do update
  set spotify_track_id = excluded.spotify_track_id,
      title = excluded.title,
      artists = excluded.artists,
      primary_artist = excluded.primary_artist,
      album = excluded.album,
      duration_ms = excluded.duration_ms,
      spotify_url = excluded.spotify_url,
      search_query = excluded.search_query,
      updated_at = now();

  get diagnostics v_affected_count = row_count;
  return query select 'refreshed'::text, v_affected_count;
end;
$$;

create function public.report_apple_sync_result(
  p_token_hash text,
  p_sync_item_id uuid,
  p_result_status text
)
returns table (
  result_status text,
  item_status text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_verified_at timestamptz;
  v_current_status text;
begin
  if p_result_status is null
    or p_result_status not in ('added', 'not_found') then
    raise exception 'Invalid sync result status' using errcode = '22023';
  end if;

  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return query select 'invalid'::text, null::text;
    return;
  end if;

  select ascx.room_id, ascx.verified_at
  into v_room_id, v_verified_at
  from public.apple_shortcut_connections as ascx
  join public.room_participants as rp
    on rp.id = ascx.participant_id
    and rp.room_id = ascx.room_id
    and rp.platform_role = 'apple_music'
  where ascx.token_hash = p_token_hash
  for update of ascx;

  if v_room_id is null then
    return query select 'invalid'::text, null::text;
    return;
  end if;

  if v_verified_at is null then
    return query select 'shortcut_not_verified'::text, null::text;
    return;
  end if;

  update public.apple_shortcut_connections as ascx
  set last_used_at = now()
  where ascx.room_id = v_room_id;

  select asi.status
  into v_current_status
  from public.apple_sync_items as asi
  where asi.id = p_sync_item_id
    and asi.room_id = v_room_id
  for update;

  if v_current_status is null then
    return query select 'item_not_found'::text, null::text;
    return;
  end if;

  if v_current_status = p_result_status then
    return query select 'already_reported'::text, v_current_status;
    return;
  end if;

  if v_current_status <> 'pending' then
    return query select 'status_conflict'::text, v_current_status;
    return;
  end if;

  update public.apple_sync_items as asi
  set status = p_result_status,
      attempts = asi.attempts + 1,
      updated_at = now(),
      last_attempt_at = now(),
      synced_at = case
        when p_result_status = 'added' then now()
        else asi.synced_at
      end
  where asi.id = p_sync_item_id
    and asi.room_id = v_room_id;

  return query select 'reported'::text, p_result_status;
end;
$$;

create function public.get_spotify_apple_sync_status(
  p_code text,
  p_participant_token uuid
)
returns table (
  result_status text,
  pending_count integer,
  added_count integer,
  not_found_count integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_playlist_id text;
  v_pending integer := 0;
  v_added integer := 0;
  v_not_found integer := 0;
begin
  select r.id
  into v_room_id
  from public.rooms as r
  where r.code = p_code;

  if v_room_id is null then
    return query select 'not_found'::text, 0, 0, 0;
    return;
  end if;

  if not exists (
    select 1
    from public.room_participants as rp
    where rp.room_id = v_room_id
      and rp.participant_token = p_participant_token
  ) then
    return query select 'not_participant'::text, 0, 0, 0;
    return;
  end if;

  select rsp.spotify_playlist_id
  into v_playlist_id
  from public.room_spotify_playlists as rsp
  where rsp.room_id = v_room_id;

  if v_playlist_id is null then
    return query select 'ok'::text, 0, 0, 0;
    return;
  end if;

  select
    count(*) filter (where asi.status = 'pending')::integer,
    count(*) filter (where asi.status = 'added')::integer,
    count(*) filter (where asi.status = 'not_found')::integer
  into v_pending, v_added, v_not_found
  from public.apple_sync_items as asi
  where asi.room_id = v_room_id
    and asi.spotify_playlist_id = v_playlist_id;

  return query
  select 'ok'::text, coalesce(v_pending, 0), coalesce(v_added, 0),
    coalesce(v_not_found, 0);
end;
$$;

revoke execute on function public.resolve_apple_sync_context(text)
  from public, anon, authenticated;
revoke execute on function public.upsert_apple_sync_items(uuid, text, jsonb)
  from public, anon, authenticated;
revoke execute on function public.report_apple_sync_result(text, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.get_spotify_apple_sync_status(text, uuid)
  from public, anon, authenticated;

grant execute on function public.resolve_apple_sync_context(text)
  to service_role;
grant execute on function public.upsert_apple_sync_items(uuid, text, jsonb)
  to service_role;
grant execute on function public.report_apple_sync_result(text, uuid, text)
  to service_role;
grant execute on function public.get_spotify_apple_sync_status(text, uuid)
  to service_role;

commit;
