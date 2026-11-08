/**
 * Headless eval server (#393): the real createMcpServer + HttpMcpServer on
 * the fixture vault, without Obsidian. Every module and every tool is
 * enabled, exactly as a user who turned everything on would see it. The
 * eval questions only need read tools; write tools act on the in-memory
 * copy of the fixture, never on the files on disk.
 *
 * Run standalone with `npx tsx evals/harness.ts` to poke at it with any MCP
 * client; it prints the URL and token and runs until Ctrl+C.
 */
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { HttpMcpServer } from '../src/server/http-server';
import { createMcpServer } from '../src/server/mcp-server';
import { ModuleRegistry, type ModuleStateMap } from '../src/registry/module-registry';
import { discoverModules } from '../src/tools';
import { DEFAULT_SETTINGS } from '../src/types';
import { Logger } from '../src/utils/logger';
import { loadFixtureVault, type FixtureAdapter } from './fixture-adapter';

/** Fixed bearer token for the local eval server. Not a secret. */
export const EVAL_TOKEN = 'eval-fixture-token';
export const DEFAULT_VAULT_DIR = resolve(process.cwd(), 'evals', 'fixture-vault');

export interface Harness {
  url: string;
  token: string;
  adapter: FixtureAdapter;
  close: () => Promise<void>;
}

export interface HarnessOptions {
  vaultDir?: string;
  /** 0 or omitted picks a free port. */
  port?: number;
  /** Print the server's info/debug log lines to stderr. */
  verbose?: boolean;
}

/** Logger that keeps info/debug quiet unless asked, so eval output stays readable. */
class EvalLogger extends Logger {
  constructor(private readonly verbose: boolean) {
    super('eval', { debugMode: false, accessKey: EVAL_TOKEN });
  }

  override debug(message: string, data?: unknown): void {
    if (this.verbose) super.debug(message, data);
  }

  override info(message: string, data?: unknown): void {
    if (this.verbose) super.info(message, data);
  }
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      srv.close(() => resolvePort(port));
    });
  });
}

export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const adapter = loadFixtureVault(options.vaultDir ?? DEFAULT_VAULT_DIR);
  const logger = new EvalLogger(options.verbose ?? false);
  const registry = new ModuleRegistry(logger);
  for (const m of discoverModules(adapter, { getExecuteCommandAllowlist: () => [] })) {
    registry.registerModule(m);
  }
  const state: ModuleStateMap = {};
  for (const r of registry.getModules()) {
    const toolStates: Record<string, boolean> = {};
    for (const t of r.module.tools()) toolStates[t.name] = true;
    state[r.module.metadata.id] = { enabled: true, toolStates };
  }
  registry.applyState(state);

  const settings = { ...DEFAULT_SETTINGS, accessKey: EVAL_TOKEN };
  const port = options.port && options.port > 0 ? options.port : await freePort();
  const http = new HttpMcpServer(
    () => createMcpServer(registry, adapter, settings, logger),
    logger,
    { host: '127.0.0.1', port, authEnabled: true, accessKey: EVAL_TOKEN },
  );
  await http.start();
  return {
    url: `http://127.0.0.1:${String(port)}/mcp`,
    token: EVAL_TOKEN,
    adapter,
    close: () => http.stop(),
  };
}

/** Connect an SDK v2 MCP client to the harness over authenticated Streamable HTTP. */
export async function connectClient(harness: Harness): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(harness.url), {
    requestInit: { headers: { Authorization: `Bearer ${harness.token}` } },
  });
  const client = new Client({ name: 'vault-mcp-eval', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

async function main(): Promise<void> {
  const port = Number(process.env.EVAL_PORT ?? '0');
  const harness = await startHarness({ port, verbose: true });
  process.stdout.write(`Eval MCP server: ${harness.url}\nBearer token: ${harness.token}\n`);
  const shutdown = (): void => {
    void harness.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1]?.endsWith('harness.ts')) {
  void main();
}
