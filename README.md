# Playlist Bridge

A two-person room experience for bridging Spotify and Apple Music playlists. This milestone includes shared room state backed by Supabase PostgreSQL and a server-only Netlify Functions API. Playlist integrations are not implemented yet.

## Architecture

- React + Vite frontend
- Netlify Functions under `netlify/functions`
- Supabase PostgreSQL schema and transactional room RPCs in `supabase/schema.sql`
- `SUPABASE_SECRET_KEY` is read only by Netlify Functions and is never included in the Vite client bundle
- The browser stores only its participant token for each room; room membership remains authoritative in PostgreSQL

## Supabase setup

1. Create or open the target Supabase project.
2. Open **SQL Editor** in the Supabase dashboard.
3. Run the complete contents of [`supabase/schema.sql`](supabase/schema.sql) once.
4. Copy `.env.example` to `.env` if a local `.env` does not already exist.
5. Set the server-only values:

   ```dotenv
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SECRET_KEY=your-secret-key
   ```

Do not prefix either variable with `VITE_`. The schema enables RLS, grants table/RPC access only to `service_role`, serializes concurrent joins with a room-row lock, and enforces the two-participant limit with a database trigger.

## Local development

Install dependencies, then run the frontend through Netlify Dev so relative Function URLs are available:

```bash
npm install
npx netlify dev
```

Open the URL printed by Netlify CLI, normally `http://localhost:8888`. Running `npm run dev` by itself starts Vite but does not provide the `/.netlify/functions/*` endpoints.

## Netlify deployment

The build and Functions directories are configured in `netlify.toml`.

In the Netlify site settings, add these environment variables with Functions access:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`

Redeploy after adding or changing them. Never add the secret key to the repository or a `VITE_` environment variable.

## Test the two-device flow

### Deployed site

1. Open the deployed site on device A and create a room.
2. Copy the six-character code.
3. Open the same deployed site on device B and join with that code.
4. Both room pages should update to `2 of 2` within about three seconds.
5. Leave from device B. Device A should return to `1 of 2` within about three seconds.
6. Close a participant tab without leaving. Its slot should be released after the 90-second stale timeout once the room is read or joined again.

### One computer

Use two different browser profiles or two different browsers. Regular and private windows may share or isolate storage differently depending on the browser, so separate profiles are the clearest simulation of two devices.

## Presence behavior

- Room state polls every 3 seconds.
- Active room pages heartbeat every 25 seconds.
- Participant rows become stale after 90 seconds.
- Explicit Leave Room removes the participant immediately.
- Stale rows are removed transactionally before room counts and joins.
