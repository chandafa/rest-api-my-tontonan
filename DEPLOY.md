# Deploy the AniStream API to Vercel

Production-ready Hono serverless API. **Build cannot fail** — there is no
compile step required (Vercel bundles the function itself), the entry point
bundles cleanly, and `tsc --noEmit` passes.

---

## Option A — Vercel Dashboard (recommended)

1. Push this repo to GitHub/GitLab.
2. On vercel.com → **Add New… → Project** → import the repo.
3. **IMPORTANT — set Root Directory to `backend`** (the repo also contains the
   Flutter `app/`, so Vercel must point at `backend`).
4. Framework Preset: **Other**. Leave **Build Command** and **Output Directory**
   empty (Vercel auto-builds the `api/` function).
5. (Optional) add Environment Variables — see below. You can skip this entirely;
   sensible defaults are baked in.
6. **Deploy.**

After deploy, test:

```
https://<your-app>.vercel.app/api/health      -> {"status":"ok",...}
https://<your-app>.vercel.app/api/home        -> anime home
https://<your-app>.vercel.app/api/donghua/home
https://<your-app>.vercel.app/api/film/home
```

## Option B — Vercel CLI

```bash
cd backend
npm i -g vercel
vercel            # first run links the project — set root to "backend"
vercel --prod     # production deploy
```

---

## Environment Variables (ALL optional)

Everything has a built-in default, so you can deploy with **zero** env vars.
Set one only to override a domain or a limit. In the Vercel dashboard:
**Settings → Environment Variables** (apply to Production).

| Variable | Default |
| --- | --- |
| `SOURCE_ANIWATCH_URL` | `https://ww2.aniwatch.fit` |
| `SOURCE_ANIMEPLAYTV_URL` | `https://animeplaytv.com` |
| `SOURCE_ANIMEPAHE_URL` | `https://animepahe.ch` |
| `SOURCE_SANKAVOLLEREI_URL` | `https://www.sankavollerei.web.id` |
| `SOURCE_NINEANIME_URL` | `https://9anime.org.lv` |
| `SOURCE_ANIXPL_URL` | `https://anix.com.pl` |
| `SOURCE_DONGHUB_URL` | `https://donghub.vip` |
| `SOURCE_ANICHIN_URL` | `https://anichin.moe` |
| `SOURCE_ANICHINRO_URL` | `https://anichin.ro` |
| `SOURCE_BIOSKOPKEREN_URL` | `https://bioskop-keren.com` |
| `CORS_ORIGINS` | (empty = allow all `*`) |
| `CACHE_TTL_SECONDS` | `300` |
| `RATE_LIMIT_MAX` | `60` |
| `RATE_LIMIT_WINDOW_SECONDS` | `60` |
| `HTTP_TIMEOUT_MS` | `15000` |

The full copy-paste list is in `.env.example`.

---

## Point the app at your deployed API

After the API is live, rebuild the APK against it:

```bash
cd ../app
flutter build apk --release --split-per-abi --target-platform android-arm64 \
  --dart-define=API_BASE_URL=https://<your-app>.vercel.app/api
```

---

## Notes / limits (Vercel Hobby)

- Function timeout is set to **60s** (`vercel.json`) — fine for scraping.
- Cold starts can add ~1s on the first request.
- In-memory cache/rate-limit reset on cold start (by design — no paid KV).
- `local-server.ts` + `npm run serve` are **local dev only**; they are not part
  of the Vercel build (the dev-only file is excluded from the typecheck).
