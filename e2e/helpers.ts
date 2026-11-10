import { browser } from '@wdio/globals';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { CallToolResult } from '@modelcontextprotocol/client';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

export const PLUGIN_ID = 'vault-mcp-server';

/**
 * Port the plugin listens on during the E2E run. Not the default 28741, so a
 * developer's own Obsidian with the plugin running does not answer instead.
 * E2E_MCP_PORT overrides it.
 */
export const MCP_PORT = Number(process.env.E2E_MCP_PORT ?? '28749');

/** Bearer access key the specs configure; only valid for the throwaway vault. */
export const ACCESS_KEY = 'e2e-access-key-not-a-secret';

/** The plugin fields the specs touch, read through `app.plugins`. */
interface McpPluginHandle {
  settings: {
    serverAddress: string;
    port: number;
    authEnabled: boolean;
    accessKey: string;
    httpsEnabled: boolean;
    autoStart: boolean;
  };
  saveSettings(): Promise<void>;
  restartServer(): Promise<void>;
  lastStartError: { port: number; message: string } | null;
}

/**
 * Configure the plugin for the test (127.0.0.1, fixed port, Bearer auth with
 * a known key, plain HTTP) and (re)start its server through the plugin's own
 * start path. Throws with the plugin's start error if the bind fails.
 */
export async function startMcpServer(): Promise<void> {
  const error = await browser.executeObsidian(
    async ({ app }, pluginId, port, accessKey) => {
      const plugins = (app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins
        .plugins;
      const plugin = plugins[pluginId] as McpPluginHandle | undefined;
      if (!plugin) return `plugin ${pluginId} is not loaded`;
      Object.assign(plugin.settings, {
        serverAddress: '127.0.0.1',
        port,
        authEnabled: true,
        accessKey,
        httpsEnabled: false,
        autoStart: false,
      });
      await plugin.saveSettings();
      await plugin.restartServer();
      return plugin.lastStartError?.message ?? null;
    },
    PLUGIN_ID,
    MCP_PORT,
    ACCESS_KEY,
  );
  if (error !== null) throw new Error(`MCP server did not start: ${error}`);
}

/**
 * Connect an MCP SDK client to the plugin over Streamable HTTP.
 * `onToolsListChanged` runs on each `notifications/tools/list_changed`.
 */
export async function connectClient(onToolsListChanged?: () => void): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${String(MCP_PORT)}/mcp`),
    { requestInit: { headers: { Authorization: `Bearer ${ACCESS_KEY}` } } },
  );
  const client = new Client({ name: 'vault-mcp-e2e', version: '1.0.0' });
  if (onToolsListChanged) {
    client.setNotificationHandler('notifications/tools/list_changed', onToolsListChanged);
  }
  await client.connect(transport);
  return client;
}

/**
 * Switch modules on and save, as their settings toggles do. Editor,
 * workspace and ui are off in a new install since 5.0 (#469), and each spec
 * file starts from a fresh vault.
 */
export async function enableModules(...ids: string[]): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, pluginId, moduleIds) => {
      const plugins = (app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins
        .plugins;
      const plugin = plugins[pluginId] as {
        registry: { enableModule(id: string): void; getState(): unknown };
        settings: { moduleStates: unknown };
        saveSettings(): Promise<void>;
      };
      for (const id of moduleIds) plugin.registry.enableModule(id);
      plugin.settings.moduleStates = plugin.registry.getState();
      await plugin.saveSettings();
    },
    PLUGIN_ID,
    ids,
  );
}

/** Call a tool; fail with its text when the tool reports an error. */
export async function callToolRaw(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<CallToolResult> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError === true) {
    const text = result.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
    throw new Error(`${name} failed: ${text}`);
  }
  return result;
}

/**
 * Call a data tool (#467): returns its structuredContent, after checking
 * that the one text block is the same data as compact JSON.
 */
export async function callTool<T = Record<string, unknown>>(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const result = await callToolRaw(client, name, args);
  if (result.structuredContent === undefined) {
    throw new Error(`${name} returned no structuredContent`);
  }
  const text = result.content.length === 1 && result.content[0].type === 'text' ? result.content[0].text : '';
  if (text !== JSON.stringify(result.structuredContent)) {
    throw new Error(`${name}: the text is not the structuredContent as JSON: ${text.slice(0, 200)}`);
  }
  return result.structuredContent as T;
}

/** A document tool's text (#467): its `key: value` header and the body after it. */
export interface DocumentResult {
  meta: Record<string, string>;
  body: string;
}

/**
 * Call a document tool (vault_read, editor_get_content, …; #467): one text
 * block, no structuredContent. Splits the header off at the first blank
 * line.
 */
export async function callDocument(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<DocumentResult> {
  const result = await callToolRaw(client, name, args);
  if (result.structuredContent !== undefined || result.content.length !== 1) {
    throw new Error(`${name} is not a document result: ${JSON.stringify(result).slice(0, 200)}`);
  }
  const block = result.content[0];
  const text = block.type === 'text' ? block.text : '';
  const end = text.indexOf('\n\n');
  const head = end === -1 ? text : text.slice(0, end);
  const meta: Record<string, string> = {};
  for (const line of head.split('\n')) {
    const i = line.indexOf(': ');
    meta[line.slice(0, i)] = line.slice(i + 2);
  }
  return { meta, body: end === -1 ? '' : text.slice(end + 2) };
}

/** Absolute path of the (temporary) vault Obsidian has open. */
export async function vaultBasePath(): Promise<string> {
  return browser.executeObsidian(({ app }) =>
    (app.vault.adapter as unknown as { getBasePath(): string }).getBasePath(),
  );
}

/** Read a vault file from disk, bypassing Obsidian. `null` when missing. */
export async function readFromDisk(vaultPath: string): Promise<string | null> {
  try {
    return await readFile(path.join(await vaultBasePath(), vaultPath), 'utf8');
  } catch {
    return null;
  }
}

/** Set a vault config key (`.obsidian/app.json`), e.g. alwaysUpdateLinks. */
export async function setVaultConfig(key: string, value: unknown): Promise<void> {
  await browser.executeObsidian(
    ({ app }, k, v) => {
      (app.vault as unknown as { setConfig(key: string, value: unknown): void }).setConfig(k, v);
    },
    key,
    value,
  );
}

/** Create (or overwrite) notes through Obsidian, creating parent folders. */
export async function writeNotes(notes: Record<string, string>): Promise<void> {
  await browser.executeObsidian(async ({ app }, files) => {
    for (const [filePath, content] of Object.entries(files)) {
      const folder = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
      if (folder !== '' && app.vault.getAbstractFileByPath(folder) === null) {
        await app.vault.createFolder(folder);
      }
      const existing = app.vault.getAbstractFileByPath(filePath);
      if (existing) {
        await app.vault.adapter.write(filePath, content);
      } else {
        await app.vault.create(filePath, content);
      }
    }
  }, notes);
}

/**
 * Wait until the metadata cache has indexed every given note and resolved
 * the expected link counts (`source -> target -> count`).
 */
export async function waitForLinks(
  expected: Record<string, Record<string, number>>,
): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.executeObsidian(({ app }, want) => {
        const resolved = app.metadataCache.resolvedLinks;
        return Object.entries(want).every(([source, targets]) =>
          Object.entries(targets).every(([target, n]) => resolved[source]?.[target] === n),
        );
      }, expected),
    { timeout: 30000, timeoutMsg: `links not resolved: ${JSON.stringify(expected)}` },
  );
}

/** Wait until the metadata cache has an entry for each path. */
export async function waitForCache(paths: string[]): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.executeObsidian(({ app }, notePaths) => {
        return notePaths.every((p) => {
          const file = app.vault.getAbstractFileByPath(p);
          return file !== null && app.metadataCache.getCache(p) !== null;
        });
      }, paths),
    { timeout: 30000, timeoutMsg: `no metadata cache for ${paths.join(', ')}` },
  );
}

/**
 * Fail if Obsidian has a modal open (e.g. the "Update links" prompt, #445).
 * Waits briefly first, because a modal opened by a rename can appear just
 * after the tool call returned.
 */
export async function expectNoModal(): Promise<void> {
  await browser.pause(1000);
  const open = await browser.executeObsidian(
    () => document.querySelectorAll('.modal-container').length,
  );
  if (open !== 0) {
    const text = await browser.executeObsidian(
      () => document.querySelector('.modal-container')?.textContent ?? '',
    );
    throw new Error(`expected no open modal, found ${String(open)}: ${text}`);
  }
}

/** Call a tool that must fail; returns its error text. */
export async function callToolError(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError !== true) {
    throw new Error(`${name} succeeded, expected an error: ${JSON.stringify(result.structuredContent)}`);
  }
  return result.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
}
