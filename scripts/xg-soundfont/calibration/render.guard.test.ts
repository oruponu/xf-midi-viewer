import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test } from 'bun:test';

// A fresh process, because Bun shares modules across test files and another file may
// already have awaited sf3DecoderReady().
test('renderMessages throws before sf3DecoderReady() is awaited', () => {
  const renderPath = join(import.meta.dir, 'render.ts');
  const code = `
try {
  const { renderMessages } = await import(${JSON.stringify(renderPath)});
  renderMessages(undefined, [], 1);
  console.log('rendered');
} catch (error) {
  console.log(error.message);
}
`;
  const result = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('SF3 decoder is not ready; await sf3DecoderReady() first');
});
