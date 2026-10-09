# NivoTalk

A cute, character-filled messenger with a photobooth built in. Chat with stickers, then hop into a
booth together — side by side on live video, from anywhere — and take one shared photo strip that
everyone can decorate, keep and share.

- **Web** (mobile-first + desktop) and an **Android** app (Capacitor shell around the live site)
- **Render** web service serves the API, the Socket.IO real-time layer and the built website
- **Neon** Postgres holds everything, including images

## Project layout

```
server/            Express 5 + Socket.IO API (TypeScript)
  migrations/      numbered SQL files, applied automatically at boot
  src/routes/      auth, users, friends, conversations, rooms, chill, photos
  src/realtime/    presence, typing, the photobooth engine and the Chill Room sync engine
  src/songs.ts     finds the full YouTube version of an Apple Music track (or reads a pasted link)
client/            React 19 + Vite + Tailwind v4 single-page app
  src/pages/booth/ live booth room, WebRTC mesh, strip compositor + editor (loaded on demand)
  src/pages/together/ Together tab, Chill Room (cover carousel, synced YouTube player, room chat, songs & queue)
  public/stickers/ 187 WebP stickers sliced from the sheets in assets/stickers
  android/         Capacitor Android project
tools/             sticker slicer, icon generator, local test DB, end-to-end smoke test
assets/            original logo, sticker sheets and design mockups
render.yaml        Render Blueprint
```

## Run locally

```bash
npm install
cp .env.example .env      # put your Neon DATABASE_URL and a long random JWT_SECRET in .env
npm run dev               # API on :4000, website on :5173 (proxies /api and /socket.io)
```

No Neon handy? `npm run localdb` starts a Postgres-compatible PGlite server on :5433, which is the
default `DATABASE_URL` in development.

If port 4000 is taken, run the API elsewhere and point Vite at it:

```bash
PORT=4100 npm run dev:server
API_PORT=4100 npm run dev:client
```

## Production build

```bash
npm run build && npm start          # serves API + site on :4000
node tools/smoke.mjs http://localhost:4000   # 38 end-to-end API/socket checks (creates test users)
```

## Deploy to Render

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, pick the repo. `render.yaml` creates the `nivotalk` web service
   (free plan, Singapore, health check `/api/health`).
3. When asked, paste your Neon connection string into `DATABASE_URL`. `JWT_SECRET` is generated.
4. Every push to `main` rebuilds and redeploys. Migrations run automatically on boot.

Optional: `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` add a TURN relay for strict networks
(otherwise Google STUN is used and video is peer-to-peer).

## Android app

The app loads the live site, so web deploys update it without reinstalling. If your Render URL is not
`https://nivotalk01.onrender.com`, set it when syncing:

```bash
NIVOTALK_URL=https://your-app.onrender.com npm run android:apk -w client
```

The debug APK lands in `client/android/app/build/outputs/apk/debug/`. Building needs a JDK (Android
Studio's bundled `jbr` works via `JAVA_HOME`) and the Android SDK. A signed release build is needed for
the Play Store.

## Phone notifications (Firebase)

New messages and friend adds always pop up inside the app with the NivoTalk chime. To also get phone
notifications while the Android app is closed or in the background:

1. In the [Firebase console](https://console.firebase.google.com) create a project, add an **Android app**
   with package name `com.nivotalk.app`, and download `google-services.json` into `client/android/app/`.
2. In **Project settings → Service accounts**, generate a new private key. Paste the whole JSON file (or
   its base64) into `FIREBASE_SERVICE_ACCOUNT` on Render.
3. Rebuild and reinstall the APK (`npm run android:apk -w client`). Don't build a new APK without
   `google-services.json` — the push plugin crashes when Firebase isn't set up.

The server only pushes to people who don't have NivoTalk on screen, and skips muted chats.

## Together: Chill Room (listen in sync)

The **Together** tab (centre of the tab bar) holds the Photobooth and the **Chill Room**: friends play full-length
songs in sync, see each song's cover, and chat while they listen. You can open a room from Together or with the 🎵
button in any chat. That chat gets a "Chill Room is live · Join" strip while people are listening.

- Search uses Apple Music for titles and covers. Each song plays in full through YouTube's official embedded player.
- The server keeps the queue and the play position. Every phone follows it and gets nudged back if it drifts more
  than about a second. Anyone in the room can play, pause, seek, skip, shuffle or add songs.
- Rooms and their chat are saved in Postgres, so a redeploy doesn't lose the queue.

To turn on song search, set `YOUTUBE_API_KEY` on Render:

1. In the [Google Cloud console](https://console.cloud.google.com), create a project and enable **YouTube Data API v3**.
2. Go to **APIs & Services → Credentials → Create credentials → API key**. Restrict the key to the YouTube Data API v3.
3. Paste the key into `YOUTUBE_API_KEY` on Render.

The free quota covers about 100 *new* songs a day. Each song is looked up once and then remembered (`song_videos`
table). Without a key, people can still paste a YouTube link into the Songs search.

## Assets

```bash
npm run stickers   # re-slice assets/stickers/*.png → client/public/stickers + stickers.json
npm run icons      # rebuild favicon, PWA icons, in-app badge, Android icons + splash from assets/logo.png
```

## Known limitations

- Google/Apple sign-in and password reset are placeholders ("coming soon").
- Presence and live booth sessions live in server memory, so run a single instance.
- Images are stored in Postgres; move to object storage as usage grows.
- Render's free plan sleeps when idle; the app shows a branded "waking up" loader and retries.
