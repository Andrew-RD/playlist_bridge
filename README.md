# Playlist Bridge

A two-person room experience for bridging Spotify and Apple Music playlists. Rooms are backed by Supabase PostgreSQL, all privileged operations run in Netlify Functions, and every room has one Spotify side plus one Apple Music Shortcut side.

## Architecture

- React + Vite frontend
- Netlify Functions under `netlify/functions`
- Supabase PostgreSQL room schema in `supabase/schema.sql`, plus additive Spotify and platform-role migrations
- Server-only Spotify Authorization Code Flow, encrypted token storage, and automatic access-token refresh
- Server-authoritative platform roles and a hashed Apple Shortcut bridge token
- `SUPABASE_SECRET_KEY`, `SPOTIFY_CLIENT_SECRET`, and `TOKEN_ENCRYPTION_KEY` are read only by Netlify Functions and never included in the Vite client bundle
- The browser stores only its participant token for each room; room, Spotify connection, and playlist selection state remain authoritative in PostgreSQL

## Supabase setup

1. Create or open the target Supabase project.
2. Open **SQL Editor** in the Supabase dashboard.
3. For a new database, run [`supabase/schema.sql`](supabase/schema.sql) once.
4. Run [`supabase/002_spotify.sql`](supabase/002_spotify.sql) once.
5. Run [`supabase/003_platform_roles.sql`](supabase/003_platform_roles.sql) once. For an existing Playlist Bridge database that already has Spotify support, this is the only new SQL required for this milestone.
6. Copy `.env.example` to `.env` if a local `.env` does not already exist.
7. Set the server-only values:

   ```dotenv
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SECRET_KEY=your-secret-key
   SPOTIFY_CLIENT_ID=your-client-id
   SPOTIFY_CLIENT_SECRET=your-client-secret
   SPOTIFY_REDIRECT_URI=http://localhost:8888/.netlify/functions/spotify-callback
   TOKEN_ENCRYPTION_KEY=base64-encoded-32-byte-key
   ```

Generate a stable encryption key with `openssl rand -base64 32`. Keep that value unchanged after connections exist: changing it makes existing encrypted Spotify tokens unreadable. Do not prefix any server variable with `VITE_`.

The migrations enable RLS and restrict their tables/RPCs to `service_role`. Spotify OAuth state is short-lived and single-use, only the Spotify-role participant can manage Spotify, and access/refresh tokens are encrypted with AES-256-GCM before storage. Apple Shortcut bridge tokens use 256 bits of secure randomness; only their SHA-256 hashes are stored in Supabase.

## Spotify app setup

In the Spotify developer dashboard, register the exact callback URLs used by each environment:

- Local: `http://localhost:8888/.netlify/functions/spotify-callback`
- Production: `https://your-site.example/.netlify/functions/spotify-callback`

Set `SPOTIFY_REDIRECT_URI` to the matching exact value in local and Netlify environments. The app requests private/collaborative playlist read access plus public/private playlist modification scopes for the later sync milestone. No Spotify token is returned to or stored by the browser.

## Local development

Install dependencies, then run the frontend through Netlify Dev so relative Function URLs are available:

```bash
npm install
npx netlify dev
```

Open the URL printed by Netlify CLI, normally `http://localhost:8888`. Running `npm run dev` by itself starts Vite but does not provide the `/.netlify/functions/*` endpoints.

## Test the Apple Shortcut bridge

The Apple Music participant selects **Set Up Apple Music** in the room and copies the generated verification endpoint and bridge token. The raw token is returned only when it is generated. Creating another token immediately invalidates the previous one.

Use the deployed HTTPS site when testing from a physical iPhone. An endpoint beginning with `http://localhost:8888` points back to the iPhone itself, not the computer running Netlify Dev.

On iPhone:

1. Open **Shortcuts** and create a shortcut named **Playlist Bridge Verify**.
2. Add a **URL** action and paste the verification endpoint.
3. Add **Get Contents of URL** below it.
4. Expand its options and set the method to **GET**.
5. Under **Headers**, add `Authorization` as the key.
6. Set its value to `Bearer YOUR_BRIDGE_TOKEN`, replacing `YOUR_BRIDGE_TOKEN` with the copied token and keeping the space after `Bearer`.
7. Optionally add **Show Result** after the request, then run the Shortcut.
8. The response should say `Playlist Bridge Shortcut connected.` The room UI should show **Shortcut ready** within about three seconds.

The bridge token is separate from the browser participant token. Treat it like a password and do not place it in the URL or share it with the Spotify participant.

## Netlify deployment

The build and Functions directories are configured in `netlify.toml`.

In the Netlify site settings, add these environment variables with Functions access:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_REDIRECT_URI`
- `TOKEN_ENCRYPTION_KEY`

Redeploy after adding or changing them. Never add the secret key to the repository or a `VITE_` environment variable.

## Test the two-device flow

### Deployed site

1. Open the deployed site on device A and create a room.
2. Copy the six-character code.
3. Open the same deployed site on device B and join with that code.
4. Choose Spotify on one device. The other participant is automatically assigned Apple Music.
5. Confirm both devices show the same complementary role assignment.
6. On the Spotify device, select **Connect Spotify**, authorize the app, and choose an owned or collaborative playlist.
7. On the Apple Music device, generate the Shortcut credentials and run the verification Shortcut described above.
8. Confirm the selected Spotify playlist and **Shortcut ready** state appear on both devices within about three seconds.
9. Leave from device B. Device A should return to `1 of 2` within about three seconds.
10. Close a participant tab without leaving. Its slot should be released after the five-minute stale timeout once the room is read or joined again.

### One computer

Use two different browser profiles or two different browsers. Regular and private windows may share or isolate storage differently depending on the browser, so separate profiles are the clearest simulation of two devices.

## Presence behavior

- Room state polls every 3 seconds.
- Active room pages heartbeat every 25 seconds.
- Participant rows become stale after five minutes.
- Explicit Leave Room removes the participant immediately.
- Stale rows are removed transactionally before room counts and joins.
