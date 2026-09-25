// Offline checks for the failure modes that can't be triggered on demand
// against the live site. The real-data run is `npm run poc`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProvider } from '../src/ai/index.ts';
import type { AiProvider, JsonResponse } from '../src/ai/provider.ts';
import { analyzeNotice } from '../src/analyze.ts';
import { insertNotice, openDb } from '../src/db.ts';
import { AiApiError, DuplicateNoticeError, EmptyContentError, InvalidAiJsonError, NetworkError } from '../src/errors.ts';
import { fetchNotice, parseNoticeHtml } from '../src/sources/inhaMainNotice.ts';
import type { RawNotice } from '../src/types.ts';

const URL = 'https://www.inha.ac.kr/bbs/kr/8/1/artclView.do';
const ids = { sourceNoticeId: '1', canonicalUrl: URL };
const page = (body: string) =>
  `<div class="artclViewHead"><dl><dt>작성일</dt><dd>2026.09.22.</dd></dl></div>` +
  `<h2 class="artclViewTitle">제목</h2><div class="artclView">${body}</div>`;

const sample: RawNotice = parseNoticeHtml(page('<p>[모집기간] 2026.09.28(월) ~ 2026.10.16(금) 학부생 대상 장학금 신청 안내입니다.</p>'), ids);

test('network failure -> NetworkError', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed');
  });
  await assert.rejects(fetchNotice(URL), NetworkError);
});

test('empty body -> EmptyContentError', () => {
  assert.throws(() => parseNoticeHtml(page('<p><img src="/poster.png"></p>'), ids), EmptyContentError);
});

test('duplicate notice -> DuplicateNoticeError, still one row', () => {
  const db = openDb(':memory:');
  const id = insertNotice(db, sample);
  assert.throws(() => insertNotice(db, sample), (e) => e instanceof DuplicateNoticeError && e.noticeId === id && !e.contentChanged);
  assert.throws(() => insertNotice(db, { ...sample, originalContent: sample.originalContent + ' (수정)' }), (e) => e instanceof DuplicateNoticeError && e.contentChanged);
  assert.equal((db.prepare('SELECT count(*) AS c FROM notices').get() as { c: number }).c, 1);
});

// Any provider only has to return raw text; analyze.ts does all validation.
const fakeProvider = (impl: () => Partial<JsonResponse>): AiProvider => ({
  name: 'fake',
  model: 'fake-1',
  generateJson: async () => ({ text: '', model: 'fake-1', incomplete: false, stopReason: 'stop', ...impl() }),
});

test('provider selection: missing key / unknown provider -> AiApiError', () => {
  assert.throws(() => createProvider({}), (e) => e instanceof AiApiError && /GEMINI_API_KEY/.test(e.message));
  assert.throws(() => createProvider({ AI_PROVIDER: 'nope' }), AiApiError);
  assert.equal(createProvider({ GEMINI_API_KEY: 'x' }).name, 'gemini');
  const p = createProvider({ AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'x' });
  assert.equal(p.name, 'openrouter');
  assert.equal(p.model, 'openrouter/free');
  assert.equal(createProvider({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'x' }).name, 'anthropic');
});

test('AI API failure -> AiApiError propagates', async () => {
  const provider = fakeProvider(() => {
    throw new AiApiError('OpenRouter error 429');
  });
  await assert.rejects(analyzeNotice(sample, provider), AiApiError);
});

test('non-JSON reply -> InvalidAiJsonError with raw text kept', async () => {
  const provider = fakeProvider(() => ({ text: 'Sure! Here is the JSON: {' }));
  await assert.rejects(analyzeNotice(sample, provider), (e) => e instanceof InvalidAiJsonError && e.rawResponse.startsWith('Sure!'));
});

test('JSON not matching schema -> InvalidAiJsonError', async () => {
  const provider = fakeProvider(() => ({ text: JSON.stringify({ category: 'scholarship' }) }));
  await assert.rejects(analyzeNotice(sample, provider), InvalidAiJsonError);
});

test('truncated output -> InvalidAiJsonError', async () => {
  const provider = fakeProvider(() => ({ text: '{"category":', incomplete: true, stopReason: 'MAX_TOKENS' }));
  await assert.rejects(analyzeNotice(sample, provider), (e) => e instanceof InvalidAiJsonError && /MAX_TOKENS/.test(e.message));
});

test('date without verbatim evidence -> validation warning', async () => {
  const analysis = {
    category: '장학금', applicationStart: '2026-09-28', applicationEnd: '2026-10-31', deadline: '2026-10-31', eventDate: null,
    target: '학부생', summary: [], easyExplanation: '', uncertain: [],
    en: { title: 'Title', summary: [], easyExplanation: '', target: 'Undergraduates', eventInfo: null },
    evidence: { applicationStart: '2026.09.28(월)', applicationEnd: '2026.10.31(토)', deadline: null, eventDate: null },
  };
  const r = await analyzeNotice(sample, fakeProvider(() => ({ text: JSON.stringify(analysis) })));
  assert.deepEqual(r.validationWarnings, [
    'applicationEnd evidence "2026.10.31(토)" not found verbatim in notice',
    'deadline has a date but no evidence quote',
    'summary has 0 bullets (expected 3-6)',
  ]);
});

test('eventDate: needs verbatim evidence; event before deadline is flagged', async () => {
  const notice = parseNoticeHtml(page('<p>[모집기간] 2026.09.28(월) ~ 2026.10.16(금)</p><p>행사일: 2026.09.30(수) 14시</p>'), ids);
  const base = {
    category: '행사/특강', applicationStart: '2026-09-28', applicationEnd: '2026-10-16', deadline: '2026-10-16',
    target: '학부생', summary: ['a', 'b', 'c'], easyExplanation: '', uncertain: [],
    en: { title: 'Fair', summary: ['a', 'b', 'c'], easyExplanation: '', target: 'Undergraduates', eventInfo: 'Job fair at the lobby' },
    evidence: { applicationStart: '[모집기간] 2026.09.28(월) ~ 2026.10.16(금)', applicationEnd: '[모집기간] 2026.09.28(월) ~ 2026.10.16(금)', deadline: '[모집기간] 2026.09.28(월) ~ 2026.10.16(금)' },
  };
  const good = { ...base, eventDate: '2026-09-30T14:00', evidence: { ...base.evidence, eventDate: '행사일: 2026.09.30(수) 14시' } };
  const r1 = await analyzeNotice(notice, fakeProvider(() => ({ text: JSON.stringify(good) })));
  assert.equal(r1.analysis.eventDate, '2026-09-30T14:00');
  assert.deepEqual(r1.validationWarnings, ['eventDate 2026-09-30T14:00 is before the deadline 2026-10-16; check which is which']);

  const invented = { ...base, eventDate: '2026-11-01', evidence: { ...base.evidence, eventDate: '행사일: 2026.11.01' } };
  const r2 = await analyzeNotice(notice, fakeProvider(() => ({ text: JSON.stringify(invented) })));
  assert.ok(r2.validationWarnings.includes('eventDate evidence "행사일: 2026.11.01" not found verbatim in notice'));

  const missing = { ...base, evidence: { ...base.evidence, eventDate: null } }; // no eventDate key at all
  await assert.rejects(analyzeNotice(notice, fakeProvider(() => ({ text: JSON.stringify(missing) }))), InvalidAiJsonError);
});

// OpenRouter adapter: request shape, model reporting, and error mapping, with fetch stubbed.
const orReply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

test('openrouter: sends json_schema + require_parameters, reports routed model', async (t) => {
  const { OpenRouterProvider } = await import('../src/ai/openrouter.ts');
  let sent: any;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ model: 'vendor/some-model:free', choices: [{ finish_reason: 'stop', message: { content: '{}' } }] }));
  });
  const r = await new OpenRouterProvider('k', 'openrouter/free').generateJson({ system: 's', user: 'u', jsonSchema: { type: 'object' } });
  assert.equal(sent.model, 'openrouter/free');
  assert.equal(sent.response_format.type, 'json_schema');
  assert.equal(sent.response_format.json_schema.strict, true);
  assert.equal(sent.provider.require_parameters, true);
  assert.deepEqual(r, { text: '{}', model: 'vendor/some-model:free', incomplete: false, stopReason: 'stop' });
});

test('openrouter: 401 and error-in-200-body -> AiApiError; truncated -> incomplete', async (t) => {
  const { OpenRouterProvider } = await import('../src/ai/openrouter.ts');
  const p = new OpenRouterProvider('k', 'openrouter/free');
  const req = { system: '', user: '', jsonSchema: {} };
  const fetchMock = t.mock.method(globalThis, 'fetch', orReply(401, { error: { code: 401, message: 'No auth credentials found' } }));
  await assert.rejects(p.generateJson(req), (e) => e instanceof AiApiError && /401/.test(e.message));
  fetchMock.mock.mockImplementation(orReply(200, { error: { code: 400, message: 'Provider returned error' } }));
  await assert.rejects(p.generateJson(req), (e) => e instanceof AiApiError && /Provider returned error/.test(e.message));
  fetchMock.mock.mockImplementation(orReply(200, { model: 'm', choices: [{ finish_reason: 'length', message: { content: '{"a":' } }] }));
  assert.equal((await p.generateJson(req)).incomplete, true);
  assert.equal(p.requestCount, 3, 'one HTTP request per call (401/400 are not retried)');
});

test('anthropic: counts messages.create calls, failed ones included', async () => {
  const { AnthropicProvider } = await import('../src/ai/anthropic.ts');
  const p = new AnthropicProvider('k', 'claude-sonnet-5');
  let fail = false;
  (p as unknown as { client: { messages: { create: () => Promise<unknown> } } }).client.messages.create = async () => {
    if (fail) throw new Error('boom');
    return { content: [{ type: 'text', text: '{}' }], model: 'claude-sonnet-5', stop_reason: 'end_turn' };
  };
  const req = { system: '', user: '', jsonSchema: {} };
  assert.equal(p.requestCount, 0);
  await p.generateJson(req);
  fail = true;
  await assert.rejects(p.generateJson(req), AiApiError);
  assert.equal(p.requestCount, 2);
});

// Gemini adapter with `call` stubbed: fallback, cooldown and request counting.
function stubGemini(behavior: (model: string) => JsonResponse | Error, cooldownFile?: string) {
  return import('../src/ai/gemini.ts').then(({ GeminiProvider }) => {
    const lines: string[] = [];
    const waits: number[] = [];
    const p = new GeminiProvider('x', 'primary', { fallbackModels: ['backup'], log: (l) => lines.push(l), sleep: async (ms) => void waits.push(ms), cooldownFile });
    const calls: string[] = [];
    (p as unknown as { call: (m: string) => Promise<JsonResponse> }).call = async (model: string) => {
      calls.push(model);
      const r = behavior(model);
      if (r instanceof Error) throw r;
      return r;
    };
    return { p, calls, lines, waits };
  });
}
const ok = (model: string): JsonResponse => ({ text: '{}', model, incomplete: false, stopReason: 'STOP' });
const req = { system: '', user: '', jsonSchema: {} };

test('gemini: 503 falls back; overloaded model is skipped on the next call (no repeat requests)', async () => {
  const { ApiError } = await import('@google/genai');
  const { p, calls, lines } = await stubGemini((m) => (m === 'primary' ? new ApiError({ message: 'high demand', status: 503 }) : ok(m)));
  assert.equal((await p.generateJson(req)).model, 'backup');
  assert.equal((await p.generateJson(req)).model, 'backup');
  assert.deepEqual(calls, ['primary', 'backup', 'backup'], 'primary not retried while cooling down');
  assert.equal(p.requestCount, 3);
  assert.equal(lines.filter((l) => l.startsWith('[AI] Gemini request made')).length, 3);
});

test('gemini: all models rate-limited -> waits once using retryDelay, then retries', async () => {
  const { ApiError } = await import('@google/genai');
  let limited = true;
  const { p, calls, waits } = await stubGemini((m) =>
    limited ? ((limited = m !== 'backup'), new ApiError({ message: '{"retryDelay": "2s"}', status: 429 })) : ok(m),
  );
  assert.equal((await p.generateJson(req)).model, 'primary');
  assert.deepEqual(calls, ['primary', 'backup', 'primary']);
  assert.equal(waits.length, 1);
  assert.ok(waits[0] > 0 && waits[0] <= 3000, `waited ${waits[0]}ms`);
});

test('gemini: daily quota -> no waiting, AiApiError 429, model stays benched', async () => {
  const { ApiError } = await import('@google/genai');
  const daily = await stubGemini(() => new ApiError({ message: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', status: 429 }));
  await assert.rejects(daily.p.generateJson(req), (e) => e instanceof AiApiError && e.status === 429 && /DAILY/.test(e.message));
  assert.deepEqual(daily.waits, []);
  await assert.rejects(daily.p.generateJson(req), (e) => e instanceof AiApiError && e.status === 429, 'still benched, no new request');
  assert.equal(daily.p.requestCount, 2);
});

test('gemini: daily-quota cooldown persists to file, so the next run makes zero requests', async () => {
  const { ApiError } = await import('@google/genai');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const file = `${mkdtempSync(`${tmpdir()}/gemini-cd-`)}/cooldown.json`;
  const quota = () => new ApiError({ message: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', status: 429 });
  const run1 = await stubGemini(quota, file);
  await assert.rejects(run1.p.generateJson(req), AiApiError);
  assert.equal(run1.p.requestCount, 2);

  const run2 = await stubGemini(quota, file); // fresh provider = next CLI run
  await assert.rejects(run2.p.generateJson(req), (e) => e instanceof AiApiError && e.status === 429);
  assert.equal(run2.p.requestCount, 0);
  assert.ok(run2.lines.some((l) => l.includes('benched until')));
});

test('gemini: non-retryable 400 fails fast without fallback', async () => {
  const { ApiError } = await import('@google/genai');
  const bad = await stubGemini(() => new ApiError({ message: 'bad key', status: 400 }));
  await assert.rejects(bad.p.generateJson(req), (e) => e instanceof AiApiError && e.status === 400);
  assert.deepEqual(bad.calls, ['primary']);
});

test('gemini: daily quota bench ends at the next midnight Pacific time', async () => {
  const { msUntilPacificMidnight } = await import('../src/ai/gemini.ts');
  // 2026-09-23 23:30 PDT (UTC-7) = 2026-09-24 06:30 UTC -> 30 minutes left
  assert.equal(msUntilPacificMidnight(new Date('2026-09-24T06:30:00Z')), 30 * 60_000);
  // 2026-09-23 00:00 PDT -> a full day
  assert.equal(msUntilPacificMidnight(new Date('2026-09-23T07:00:00Z')), 24 * 3600_000);
});
