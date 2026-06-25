# my-anime-api (Hono + Vercel)

Scraper API for the Anime Streaming app. Built strictly to `SDD.md`:
Hono v4.12 · Node 22 · Axios · Cheerio · Vercel Hobby. **No database. No auth.**

## Source failover (3 domains)

Requests are served by trying these sources in order until one responds
(see `src/config.ts`):

| Priority | Id          | Default domain              |
| -------- | ----------- | --------------------------- |
| 1        | aniwatch    | https://ww2.aniwatch.fit    |
| 2        | animeplaytv | https://animeplaytv.com     |
| 3        | animepahe   | https://animepahe.ch        |

Override any domain with `SOURCE_*_URL` env vars (see `.env.example`).

**Live-verified (June 2026):** all three domains currently run the same
WordPress "dramastream" theme (a Gogoanime mirror), so the shared parser
`src/scrapers/sources/dramastream.ts` handles them and each source file
(`aniwatch.ts` / `animeplaytv.ts` / `animepahe.ts`) is a thin subclass that
only sets its `id`. If one mirror later changes its theme, override `sel` or a
method in just that subclass — the other two are unaffected. Verified flow:
`/` + `/series/?status=Ongoing` (home), `/?s=` (search), `/series/<slug>/`
(detail, `.episode-item`), `/<episode>/` (`.player-type-link[data-plain-url]`
→ embed → direct `.mp4`/`.m3u8`).

## Layout

```
backend/
├── api/
│   └── index.ts        # Vercel function entry → re-exports the Hono handler
├── src/
│   ├── config.ts       # Env-driven config (sources, cache, rate limit, CORS)
│   ├── index.ts        # Hono app + global middleware + routes
│   ├── routes/         # (Phase 4) GET /home /search /anime/:slug /episode/:slug
│   ├── scrapers/       # (Phase 3) per-source adapters + failover orchestrator
│   ├── middleware/     # (Phase 2) cache, rate-limit, error-handler
│   └── utils/          # (Phase 2) http-client, logger
├── vercel.json         # /api/* rewrite + 60s maxDuration
└── tsconfig.json
```

## Run

```bash
cd backend
npm install
cp .env.example .env      # optional; sensible defaults are built in
npm run typecheck         # tsc --noEmit
npm run dev               # vercel dev  → http://localhost:3000/api/health
```

## Deploy (Vercel Hobby)

```bash
npm i -g vercel
vercel --prod
```
