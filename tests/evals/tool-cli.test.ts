/**
 * Command-line MCP client for the eval harness (#483), run in-process
 * against the real harness: no network beyond 127.0.0.1, no model.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/client';
import { connectClient, startHarness, type Harness } from '../../evals/harness';
import { firstSentence, runCli } from '../../evals/tool-cli';

let harness: Harness;
let client: Client;

beforeAll(async () => {
  harness = await startHarness();
  client = await connectClient(harness);
});

afterAll(async () => {
  await client.close();
  await harness.close();
});

async function cli(...argv: string[]): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const code = await runCli(argv, client, (text) => lines.push(text));
  return { code, out: lines.join('\n') };
}

describe('eval tool CLI', () => {
  it('cuts a description to its first sentence', () => {
    expect(firstSentence('Read a note. Pages with offset.')).toBe('Read a note.');
    expect(firstSentence('No full stop\nsecond line')).toBe('No full stop');
    expect(firstSentence('Version 1.2 is here. More.')).toBe('Version 1.2 is here.');
  });

  it('prints the server instructions', async () => {
    const { code, out } = await cli('instructions');
    expect(code).toBe(0);
    expect(out.length).toBeGreaterThan(100);
  });

  it('lists every tool on one line each', async () => {
    const { code, out } = await cli('tools');
    expect(code).toBe(0);
    const lines = out.split('\n');
    expect(lines.length).toBe((await client.listTools()).tools.length);
    expect(lines.some((l) => l.startsWith('search_by_frontmatter: '))).toBe(true);
  });

  it('shows the full schema of one tool and rejects unknown names', async () => {
    const schema = await cli('schema', 'vault_get_aspect');
    expect(schema.code).toBe(0);
    expect(schema.out).toContain('input schema:');
    expect(schema.out).toContain('"aspect"');
    const unknown = await cli('schema', 'no_such_tool');
    expect(unknown.code).toBe(2);
  });

  it('calls a tool and prints the result as the runner shows it', async () => {
    const { code, out } = await cli('call', 'vault_get_aspect', '{"path":"projects/Atlas.md","aspect":"backlinks"}');
    expect(code).toBe(0);
    expect(out).toContain('Home.md');
  });

  it('marks tool errors and bad arguments', async () => {
    const failed = await cli('call', 'vault_read', '{"path":"does/not/exist.md"}');
    expect(failed.code).toBe(1);
    expect(failed.out).toMatch(/^Error: /);
    const bad = await cli('call', 'vault_read', '[1]');
    expect(bad.code).toBe(2);
    expect(bad.out).toContain('JSON object');
  });

  it('prints usage for unknown commands', async () => {
    const { code, out } = await cli('nope');
    expect(code).toBe(2);
    expect(out).toContain('Usage:');
  });
});
