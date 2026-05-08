import { describe, it, expect } from 'vitest';
import { buildMcpConfigJson } from '../src/settings/mcp-config-section';
import { DEFAULT_SETTINGS } from '../src/types';
import type { McpPluginSettings } from '../src/types';
import type McpPlugin from '../src/main';

interface ParsedSnippet {
  obsidian: { type?: string; url?: string; headers?: Record<string, string> };
}

function makePlugin(overrides: Partial<McpPluginSettings> = {}): Pick<McpPlugin, 'settings'> {
  return {
    settings: { ...DEFAULT_SETTINGS, ...overrides },
  };
}

function parseSnippet(snippet: string): ParsedSnippet {
  // buildMcpConfigJson returns the inner fragment; wrap it in braces and parse
  return JSON.parse(`{${snippet}}`) as ParsedSnippet;
}

describe('buildMcpConfigJson', () => {
  it('emits type, url, and Authorization header when auth is on and key is set', () => {
    const plugin = makePlugin({ accessKey: 'secret-key' });
    const snippet = buildMcpConfigJson(plugin as McpPlugin);
    const parsed = parseSnippet(snippet);

    expect(parsed.obsidian.type).toBe('http');
    expect(parsed.obsidian.url).toBe('http://localhost:28741/mcp');
    expect(parsed.obsidian.headers).toEqual({
      Authorization: 'Bearer secret-key',
    });
  });

  it('keeps type:"http" when HTTPS is enabled (transport type, not URL scheme)', () => {
    const plugin = makePlugin({ accessKey: 'k', httpsEnabled: true });
    const snippet = buildMcpConfigJson(plugin as McpPlugin);
    const parsed = parseSnippet(snippet);

    expect(parsed.obsidian.type).toBe('http');
    expect(parsed.obsidian.url).toBe('https://localhost:28741/mcp');
  });

  it('emits type and url but no headers when auth is disabled', () => {
    const plugin = makePlugin({ authEnabled: false, accessKey: 'ignored' });
    const snippet = buildMcpConfigJson(plugin as McpPlugin);
    const parsed = parseSnippet(snippet);

    expect(parsed.obsidian.type).toBe('http');
    expect(parsed.obsidian.url).toBe('http://localhost:28741/mcp');
    expect(parsed.obsidian.headers).toBeUndefined();
  });

  it('omits headers when auth is on but access key is empty', () => {
    const plugin = makePlugin({ authEnabled: true, accessKey: '' });
    const snippet = buildMcpConfigJson(plugin as McpPlugin);
    const parsed = parseSnippet(snippet);

    expect(parsed.obsidian.type).toBe('http');
    expect(parsed.obsidian.headers).toBeUndefined();
  });

  it('reflects custom address and port in the url', () => {
    const plugin = makePlugin({
      serverAddress: '0.0.0.0',
      port: 9000,
      accessKey: 'k',
    });
    const snippet = buildMcpConfigJson(plugin as McpPlugin);
    const parsed = parseSnippet(snippet);

    expect(parsed.obsidian.url).toBe('http://0.0.0.0:9000/mcp');
  });

  it('passes a LAN-style address through literally', () => {
    const plugin = makePlugin({ serverAddress: '192.168.1.10', accessKey: 'k' });
    const snippet = buildMcpConfigJson(plugin as McpPlugin);
    const parsed = parseSnippet(snippet);

    expect(parsed.obsidian.url).toBe('http://192.168.1.10:28741/mcp');
  });
});
