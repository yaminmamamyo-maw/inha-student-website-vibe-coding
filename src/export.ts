import './env.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { allNoticeIds, getNoticeDetail, listNotices } from './api/notices.ts';
import { DB_PATH, openDb } from './db.ts';

// Writes the read API's responses as static JSON for hosting without a server
// (GitHub Pages). Same shapes as src/server.ts; read-only; never calls the AI.
//   <out>/api/notices.json        = GET /api/notices
//   <out>/api/notices/<id>.json   = GET /api/notices/:id

const out = process.argv[2] ?? 'dist/web';
const db = openDb();
const notices = listNotices(db);

mkdirSync(join(out, 'api', 'notices'), { recursive: true });
writeFileSync(join(out, 'api', 'notices.json'), JSON.stringify(notices));
// Every stored copy gets a detail file (a cross-posted copy's file holds its canonical notice).
for (const id of allNoticeIds(db)) {
  writeFileSync(join(out, 'api', 'notices', `${id}.json`), JSON.stringify(getNoticeDetail(db, id)));
}

const analyzed = notices.filter((n) => n.analysis).length;
console.log(`[EXPORT] ${notices.length} notices (${analyzed} analyzed) from ${DB_PATH} -> ${out}/api/`);
