# Notice sources

Sources the crawler is allowed to read. One module per source in `src/sources/`. Every board below runs on the same K2Web CMS, so parsing and fetching are shared in [`src/sources/k2web.ts`](../src/sources/k2web.ts). The registry and `--source` names are in [`src/sources/index.ts`](../src/sources/index.ts), and UI metadata (kind, college, major) is in [`src/sourceMeta.ts`](../src/sourceMeta.ts).

| `--source` | Source key | Kind | Board | Default per run |
|---|---|---|---|---|
| `main` | `inha-main-notice` | 본교 (main) | 인하대학교 공지사항 | list page 1 |
| `aicc` | `inha-aicc-notice` | 단과대 (college) | AI융합대학 공지사항 | latest 10 |
| `cse` | `inha-cse-notice` | 학과 (department) | 컴퓨터공학과 공지사항 | latest 10 |
| `ai` | `inha-doai-notice` | 학과 (department) | 인공지능공학과 공지사항 | latest 10 |
| `ds` | `inha-datascience-notice` | 학과 (department) | 데이터사이언스학과 공지사항 | latest 10 |
| `dt` | `inha-designtech-notice` | 학과 (department) | 디자인테크놀로지학과 공지사항 | latest 10 |
| `sme` | `inha-sme-notice` | 학과 (department) | 스마트모빌리티공학과 공지사항 | latest 10 |

`npm run ingest` runs all boards in this order. `--source cse,aicc` picks boards, and `--limit N` overrides the per-run default. The limit counts regular posts only; pinned posts come on top of it (see [Incremental crawling](#incremental-crawling)). A board that fails (even its list page) never stops the others.

With these boards, every AI융합대학 major in `src/inhaCatalog.ts` has its department board collected.

## `inha-main-notice` — 인하대학교 대표 홈페이지 공지사항

| | |
|---|---|
| Board (list) | https://www.inha.ac.kr/kr/950/subview.do (rows: `https://www.inha.ac.kr/bbs/kr/8/artclList.do?page=N`) |
| Article URL pattern | `https://www.inha.ac.kr/bbs/kr/8/{articleId}/artclView.do` |
| Module | [`src/sources/inhaMainNotice.ts`](../src/sources/inhaMainNotice.ts) |
| Access | Public, no login, server-rendered HTML (no JavaScript needed) |
| robots.txt | `User-agent: *` / `Allow: /` (checked 2026-09-23) |
| Dedup key | `(source, articleId)`: the `articleId` in the URL is the board's own article number |
| Status | **Ingested** (list page 1 per run) |

### Notice used for the POC

- **URL:** https://www.inha.ac.kr/bbs/kr/8/45601/artclView.do
- **Title:** [창업지원단][대학혁신지원사업] 창업꿈나무 장학금 접수 안내(학부)
- **Board category:** 모집/채용, **작성일:** 2026.09.22
- **Why this one:** scholarship deadlines are a core use case. The body is real text (not only a poster), and it has an application period plus other dates (review and announcement) that must *not* be taken as the deadline.

### Page structure relied on

| Field | Selector |
|---|---|
| List rows | `table.artclTable tbody tr`; link `a.artclLinkView` (title = the link's own text); `._artclTdRdate`; `tr.headline` = pinned |
| Title | `.artclViewTitle` |
| Body | `.artclView` |
| Metadata | `.artclViewHead dl` → `<dt>작성일/분류/작성자</dt><dd>…</dd>` |
| Attachments | `a[href*="/download.do"]`, and `<img>` inside the body |

If the notice is deleted, the site returns HTTP 200 with a page that doesn't have these selectors. The crawler reports that as `InvalidResponseError`.

## `inha-aicc-notice` — AI융합대학 공지사항

AI융합대학 is the college 컴퓨터공학과 belongs to. It was renamed from 소프트웨어융합대학: the official page https://www.inha.ac.kr/kr/3907/subview.do is titled "AI융합대학", and `swcc.inha.ac.kr` now redirects to `aicc.inha.ac.kr` (checked 2026-09-25). `src/inhaCatalog.ts` keeps the old name as a `formerNames` entry.

| | |
|---|---|
| Board (list) | `https://aicc.inha.ac.kr/bbs/act/716/artclList.do?page=N` (the "공지사항 더보기" link on https://aicc.inha.ac.kr/act/index.do) |
| Article URL pattern | `https://aicc.inha.ac.kr/bbs/act/716/{articleId}/artclView.do` |
| Module | [`src/sources/inhaAiccNotice.ts`](../src/sources/inhaAiccNotice.ts) |
| Access | Public, no login, server-rendered HTML (same K2Web CMS as the main site) |
| robots.txt | Only `User-agent: Yeti` (Naver's crawler) / `Disallow: /bbs/*`. There is no rule for other user agents, so this crawler is allowed (checked 2026-09-25) |
| Dedup key | `(source, articleId)` |
| Status | **Ingested** (latest 10 per run) |

## `inha-cse-notice` — 컴퓨터공학과 공지사항

| | |
|---|---|
| Board (list) | `https://cse.inha.ac.kr/bbs/cse/242/artclList.do?page=N` (the "공지사항 더보기" link on https://cse.inha.ac.kr/cse/index.do) |
| Article URL pattern | `https://cse.inha.ac.kr/bbs/cse/242/{articleId}/artclView.do` |
| Module | [`src/sources/inhaCseNotice.ts`](../src/sources/inhaCseNotice.ts) |
| Access | Public, no login, server-rendered HTML (same K2Web CMS as the main site) |
| robots.txt | Only `User-agent: Yeti` / `Disallow: /bbs/*`. No rule for other user agents, so allowed (checked 2026-09-25) |
| Dedup key | `(source, articleId)` |
| Status | **Ingested** (latest 10 per run) |

`https://cse.inha.ac.kr/` itself is only a JavaScript redirect ("site move") to `/cse/index.do`, so the module uses the board URLs above directly. Other CSE boards are not collected (yet): 243 졸업예정자 공지 and 244 취업정보.

## `inha-doai-notice` — 인공지능공학과 공지사항

인공지능공학과 is in AI융합대학. The same name is used in `src/inhaCatalog.ts`, on the official page https://www.inha.ac.kr/kr/3907/subview.do and in the department site title. The site was found through the department link on https://aicc.inha.ac.kr/act/index.do (checked 2026-09-25).

| | |
|---|---|
| Board (list) | `https://doai.inha.ac.kr/bbs/doai/731/artclList.do?page=N` (the "공지사항 더보기" link on https://doai.inha.ac.kr/doai/index.do) |
| Article URL pattern | `https://doai.inha.ac.kr/bbs/doai/731/{articleId}/artclView.do` |
| Module | [`src/sources/inhaDoaiNotice.ts`](../src/sources/inhaDoaiNotice.ts) |
| Access | Public, no login, server-rendered HTML (same K2Web CMS; `k2web.ts` parses it unchanged) |
| robots.txt | Only `User-agent: Yeti` / `Disallow: /bbs/*`. No rule for other user agents, so allowed (checked 2026-09-25) |
| Dedup key | `(source, articleId)` |
| Status | **Registered** (latest 10 per run); not ingested yet |

`https://doai.inha.ac.kr/` itself is only a JavaScript redirect ("site move") to `/doai/index.do`, so the module uses the board URLs above directly. The other board on the front page, 729 취업/이벤트, is not collected.

## 데이터사이언스학과 · 디자인테크놀로지학과 · 스마트모빌리티공학과 (AI융합대학)

The remaining AI융합대학 departments. They were found through the department links on https://aicc.inha.ac.kr/act/index.do, and the names match `src/inhaCatalog.ts`. Each board is the "공지사항더보기" link on the department's front page (checked 2026-09-25).

| Source key | Module | Board (list) | Article URL pattern |
|---|---|---|---|
| `inha-datascience-notice` | [`inhaDatascienceNotice.ts`](../src/sources/inhaDatascienceNotice.ts) | `https://datascience.inha.ac.kr/bbs/datascience/746/artclList.do?page=N` | `…/bbs/datascience/746/{articleId}/artclView.do` |
| `inha-designtech-notice` | [`inhaDesigntechNotice.ts`](../src/sources/inhaDesigntechNotice.ts) | `https://designtech.inha.ac.kr/bbs/designtech/742/artclList.do?page=N` | `…/bbs/designtech/742/{articleId}/artclView.do` |
| `inha-sme-notice` | [`inhaSmeNotice.ts`](../src/sources/inhaSmeNotice.ts) | `https://sme.inha.ac.kr/bbs/sme/703/artclList.do?page=N` | `…/bbs/sme/703/{articleId}/artclView.do` |

- **Access:** public, no login, server-rendered K2Web. `k2web.ts` parses them unchanged. Each site root is the same JavaScript "site move" redirect as cse/doai.
- **robots.txt:** only `User-agent: Yeti` / `Disallow: /bbs/*`, so this crawler is allowed (checked 2026-09-25).
- **Dedup key:** `(source, articleId)`. **Status:** Registered (latest 10 per run); not ingested yet.
- **작성자:** commented out in these sites' HTML, so `author` is `null`.
- **Not collected:**
  - 취업/이벤트 boards: datascience 753, designtech 743, sme 3119.
  - sme 700 (학과소식: news and awards, not notices).

### Page structure (college and department boards)

Same as the main board, with three differences:

| | Main board | College/department boards |
|---|---|---|
| List title | the link's own text | `<strong>` inside `a.artclLinkView`, next to a `span.newArtcl` "새글" badge |
| Metadata `dl` | 작성일, 분류, 작성자 | 작성일, 수정일, 작성자, 조회수 (AI융합대학 also has 글번호). **No 분류** → `boardCategory` is `null` |
| Body images | relative or main-site URLs | may point to another Inha host (e.g. `swcc.inha.ac.kr/CrossEditor/...`); resolved against the board's origin |

Poster-only posts (the body is an image and has no text, e.g. aicc 191375, cse 191227 and 190971, doai 191467) fail with `EmptyContentError` and are not stored, just like on the main board.

A recent pinned post is often listed twice: once as a pinned `tr.headline` row and once in the normal flow (e.g. designtech 191870, sme 191962). `uniqueListed()` in `k2web.ts` keeps one row and treats it as regular.

Offline parser tests use real pages saved on 2026-09-25 in `test/fixtures/sources/` (`test/sources.test.ts`).

## Cross-source duplicates

The same notice is often posted on the main, college and department boards, e.g. main 45574 "2026학년도 2학기 수강신청 포기 안내" (09-21) = CSE 191991 "[학부]2026학년도 2학기 수강신청 포기 안내" (09-22). The rule is in `src/dedup.ts` and is deterministic, with no AI:

- **Same notice** = a different source + the same normalized title + 작성일 at most 3 days apart. Copies are often posted a day apart.
- **Normalized title:**
  - Leading tags (`[학부]`, `(학부)`, `[인재개발팀]`, `★`) are dropped, plus spaces, punctuation and case.
  - A `[대학원]` tag is kept, so a graduate notice never merges with the undergraduate one.
  - Keys shorter than 6 characters are never merged.
- **Not merged:** copies whose wording differs (e.g. 직무박람회: main "[인재개발팀] 2026 하반기 인하대학교 직무박람회 개최 안내!" vs college "2026년 하반기 인하대학교 직무박람회"). They show up as two notices, rather than risking a false merge.
- **Storage:** every copy is its own `notices` row. `notices.dup_of` points to the first stored copy (the canonical one; main is ingested first).
- **One analysis per notice:** ingest skips Gemini for a copy when any copy in its group already has a current analysis (`[DUP]` log).
- **API:** a group is returned once, as its canonical copy, with every board in `sources`. Opening a duplicate's id returns the canonical detail.

## Incremental crawling

`npm run ingest` requests an article page only when needed (`fetchReason()` in `src/ingest.ts`):

| Listed post | Article requested? |
|---|---|
| Not in the DB | yes (`new`) |
| In the DB, 작성일 within the last 7 days (`RECENT_DAYS`) | yes, re-checked for edits (`[RECHECK]`) |
| In the DB, extracted `deadline`, `application_end` or `event_date` today or later (newest analysis of any copy in its dedup group) | yes, re-checked for edits (`[RECHECK]`) |
| Anything else | **no**: logged `[KNOWN]`; the stored copy is reused |
| any post, with `--full` | yes (the old behavior: re-check everything) |

- A known post that is not re-fetched but still has no current analysis (an earlier deferral or failure, or `--upgrade-prompt`) is analyzed from the stored copy, with no HTTP request. AI calls follow the same rules as before.
- Edits to an old post whose dates have all passed are not noticed without `--full`.
- **Pinned posts:** `--limit` counts regular rows only (`selectListed()`). Every pinned row on the list page is processed on top of it: fetched if new, otherwise only under the rules above.
- `[DONE]` prints each board's HTTP requests, e.g. `http=3 (list 1, article 2)`. The counts come from `BoardSource.requests`.

## Crawling etiquette

- The crawler identifies itself with the `User-Agent` `inha-notice-poc/0.1`. Requests are sequential, with a 300 ms pause between article requests, and boards are crawled one after another.
- Per run: one list page per board. Articles are requested only for new or still-relevant posts (see above): at most 10 regular posts per college/department board, plus pinned ones.
- Posters (images) and `.hwp` attachments are recorded in the database but not downloaded or parsed.

## Not used (and why)

- `eng.inha.ac.kr` Notice board: rows link through JavaScript form posts, so there's no stable per-notice URL (see `inha-university-student-info-research.md` §2).
- `portal.inha.ac.kr`: requires login. Out of scope.
