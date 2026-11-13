import { browser, expect } from '@wdio/globals';
import { ACCESS_KEY, PLUGIN_ID, connectClient, startMcpServer } from '../helpers';

/** Secret id the plugin uses in `app.secretStorage` (src/settings/access-key-store.ts). */
const SECRET_ID = 'vault-mcp-server-access-key';

interface KeyState {
  /** The loaded plugin instance's key. */
  settingsKey: string | null;
  location: string | null;
  secret: string | null;
  /** `accessKey` in data.json on disk; `null` when the field is absent. */
  dataJsonKey: string | null;
}

/** Read the key from the plugin, SecretStorage and data.json on disk. */
async function keyState(): Promise<KeyState> {
  return browser.executeObsidian(
    async ({ app }, pluginId, secretId) => {
      const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins
        .plugins[pluginId] as
        | { settings: { accessKey: string }; accessKeyLocation: string; manifest: { dir?: string } }
        | undefined;
      const storage = (app as unknown as {
        secretStorage?: { getSecret(id: string): string | null };
      }).secretStorage;
      const dir = plugin?.manifest.dir ?? `${app.vault.configDir}/plugins/${pluginId}`;
      const raw = JSON.parse(await app.vault.adapter.read(`${dir}/data.json`)) as {
        accessKey?: string;
      };
      return {
        settingsKey: plugin?.settings.accessKey ?? null,
        location: plugin?.accessKeyLocation ?? null,
        secret: storage?.getSecret(secretId) ?? null,
        dataJsonKey: raw.accessKey ?? null,
      };
    },
    PLUGIN_ID,
    SECRET_ID,
  );
}

/** Disable and enable the plugin, as an update or a restart of Obsidian does. */
async function reloadPlugin(expectedKey: string): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, pluginId) => {
      const plugins = (
        app as unknown as {
          plugins: {
            disablePlugin(id: string): Promise<void>;
            enablePlugin(id: string): Promise<void>;
          };
        }
      ).plugins;
      await plugins.disablePlugin(pluginId);
      await plugins.enablePlugin(pluginId);
    },
    PLUGIN_ID,
  );
  await browser.waitUntil(
    async () => (await keyState()).settingsKey === expectedKey,
    { timeout: 10000, timeoutMsg: 'the reloaded plugin did not load the expected access key' },
  );
}

/**
 * #560: the access key lives in Obsidian's SecretStorage, not in data.json,
 * survives a plugin reload, and a key left in data.json moves over once.
 */
describe('access key in SecretStorage (#560)', function () {
  it('keeps the key in SecretStorage and out of data.json', async function () {
    await startMcpServer();

    const state = await keyState();
    expect(state.location).toBe('secret-storage');
    expect(state.secret).toBe(ACCESS_KEY);
    expect(state.dataJsonKey).toBeNull();
  });

  it('keeps the same key across a plugin reload, and clients still connect', async function () {
    await reloadPlugin(ACCESS_KEY);

    const state = await keyState();
    expect(state.settingsKey).toBe(ACCESS_KEY);
    expect(state.dataJsonKey).toBeNull();

    await startMcpServer();
    const client = await connectClient();
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain('server_info');
    } finally {
      await client.close().catch(() => undefined);
    }
  });

  it('moves a key found in data.json into SecretStorage on load', async function () {
    const legacyKey = 'e2e-legacy-key-not-a-secret';
    // Simulate an install from before #560: no secret yet, key in data.json.
    await browser.executeObsidian(
      async ({ app }, pluginId, secretId, key) => {
        const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } })
          .plugins.plugins[pluginId] as {
          settings: Record<string, unknown>;
          saveData(data: unknown): Promise<void>;
        };
        (app as unknown as {
          secretStorage: { setSecret(id: string, secret: string): void };
        }).secretStorage.setSecret(secretId, '');
        await plugin.saveData({ ...plugin.settings, accessKey: key });
      },
      PLUGIN_ID,
      SECRET_ID,
      legacyKey,
    );

    await reloadPlugin(legacyKey);

    const state = await keyState();
    expect(state.location).toBe('secret-storage');
    expect(state.secret).toBe(legacyKey);
    expect(state.dataJsonKey).toBeNull();

    // Leave the vault as the other specs expect it.
    await startMcpServer();
  });
});
