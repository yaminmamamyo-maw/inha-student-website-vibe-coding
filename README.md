# Inha Insight (인하 인사이트)

**Live site: https://yaminmamamyo-maw.github.io/inha-student-website-vibe-coding/**

Inha University (인하대학교) notices, read by AI and organized by deadline.

The app crawls the official 공지사항 board. Gemini extracts the application period, deadline, event date, eligibility and a plain-language summary (in Korean and English), and the site shows them as a filterable list, a detail page and a monthly calendar.

> This is an unofficial student project. AI-extracted information can be wrong: every notice links to its official source and shows the quote each date came from. Always confirm in the original notice.

## What's on the site

- **Notice list:** category filter, newest or closing-soon sort, D-day badges (Korea time).
- **Notice detail:** 3-line AI summary, plain explanation, eligibility, key dates with their source quotes, "캘린더에 추가" (adds it to the site's calendar under "내 일정 / My events", with an optional `.ics` export for phone calendars), and a link to the original.
- **Calendar:** monthly view that separates application deadlines (black **마감**) from event dates (blue **일정**).
- **Korean / English everywhere:** the 한국어 | English switch on the notice pages changes the whole app and is remembered in the browser. English notice content was written by Gemini together with the Korean analysis. Switching language never calls the AI.
- **Profile and notifications:** an optional profile (department, major, year, interests) puts relevant notices first, and a notifications page lists recent notices, marking the ones that fit you. Nothing is ever hidden, and nothing is sent.

Notices the AI hasn't analyzed yet are shown as "분석 대기" with a link to the original. They are never shown with guessed dates.

## How it works

```
www.inha.ac.kr 공지사항 → crawler → SQLite (original notice) → Gemini (only new/changed notices) → SQLite (analysis) → JSON API → React site
```

- **Change detection:** each notice's text is hashed. Unchanged notices never reach Gemini, and edited notices are re-analyzed. Older analyses are kept and marked stale.
- **AI output is structured JSON, checked in code:** every date must quote the notice text word for word, or a warning is stored with the analysis.
- **Gemini free tier:** fallback models, per-model cooldowns, and the daily-quota limit remembered across runs, so no requests are wasted.

## About the live site

The live site is a **static snapshot** hosted on GitHub Pages. `npm run deploy` exports the local database as JSON and publishes the build. The home page shows when the notices were last checked. The data refreshes when a new snapshot is deployed, not in real time.

**Automatic refresh:** a GitHub Actions workflow ([`refresh-notices.yml`](.github/workflows/refresh-notices.yml)) runs three times a day (08:17, 12:47, 18:17 KST) and can be started by hand from the Actions tab. It takes the database from the `data` branch, fetches only new or still-relevant posts, analyzes at most 20 notices per run with Gemini (the rest show as "분석 대기" until the next run), saves the database back and republishes the site. If a run fails, nothing is deployed and the previous snapshot stays online. Setup: add the repository secret `GEMINI_API_KEY`, set Settings → Pages to deploy from the `gh-pages` branch, and seed the `data` branch once with `bash scripts/data-branch.sh push` (uploads your local `data/poc.db`).

## Run it locally

Requires Node 22.5+ (uses the built-in `node:sqlite`).

```bash
npm install
cp .env.example .env     # set GEMINI_API_KEY (free key: https://aistudio.google.com/apikey)
npm run ingest           # crawl the board → store → analyze new/changed notices
npm run dev              # API on :8787 + site on http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run ingest [-- --pages N] [--no-ai] [--upgrade-prompt] [--max-ai N]` | Crawl, detect new/updated notices, analyze only where needed (at most N AI calls) |
| `npm run dev` | Read-only API + Vite dev server |
| `npm test` / `npm run typecheck` | Tests (node:test) / TypeScript for backend and web |
| `npm run deploy` | Build a static snapshot and publish it to GitHub Pages |

More detail: [`CLAUDE.md`](CLAUDE.md) (architecture), [`docs/ingestion-result.md`](docs/ingestion-result.md) (pipeline verification), [`docs/notice-sources.md`](docs/notice-sources.md) (sources and crawling rules).

## Stack

TypeScript · Node (`node:sqlite`, `node:http`) · cheerio · Gemini (`@google/genai`) with Zod-validated structured output · React 19 + Vite + react-router · Lenis. The design is inspired by [duten.com](https://www.duten.com/en/finish/brushed-stainless-steel/).
