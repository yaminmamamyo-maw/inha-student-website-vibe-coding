// Search-box debounce/IME-composition guard (web/src/lib/searchSync.ts). Regression tests for the
// bug where committing on every keystroke (via the URL) broke Hangul/Japanese/Chinese IME input.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { createSearchSync } from '../web/src/lib/searchSync.ts';

test('commits the latest value once, after the debounce delay', async () => {
  const calls: string[] = [];
  const sync = createSearchSync((v) => calls.push(v), 20);
  sync.onChange('a');
  sync.onChange('ab');
  await sleep(40);
  assert.deepEqual(calls, ['ab']);
});

test('never commits while an IME composition is in progress, even across several keystrokes', async () => {
  const calls: string[] = [];
  const sync = createSearchSync((v) => calls.push(v), 20);
  sync.onCompositionStart();
  sync.onChange('ㅈ');
  sync.onChange('자');
  sync.onChange('장');
  await sleep(40);
  assert.deepEqual(calls, []);
});

test('commits the final composed value shortly after composition ends', async () => {
  const calls: string[] = [];
  const sync = createSearchSync((v) => calls.push(v), 20);
  sync.onCompositionStart();
  sync.onChange('ㅈ');
  sync.onChange('장');
  sync.onCompositionEnd('장학');
  await sleep(40);
  assert.deepEqual(calls, ['장학']);
});

test('commitNow commits immediately and cancels a pending debounce', async () => {
  const calls: string[] = [];
  const sync = createSearchSync((v) => calls.push(v), 20);
  sync.onChange('abc');
  sync.commitNow('');
  await sleep(40);
  assert.deepEqual(calls, ['']); // not ['abc', '']
});

test('dispose cancels a pending debounce', async () => {
  const calls: string[] = [];
  const sync = createSearchSync((v) => calls.push(v), 20);
  sync.onChange('abc');
  sync.dispose();
  await sleep(40);
  assert.deepEqual(calls, []);
});
