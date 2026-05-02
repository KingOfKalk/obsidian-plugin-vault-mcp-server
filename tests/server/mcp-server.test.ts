import { describe, it, expect, vi, beforeEach } from 'vitest';
import manifest from '../../manifest.json';
import { Logger } from '../../src/utils/logger';
import { ModuleRegistry } from '../../src/registry/module-registry';

interface CapturedServerInfo {
  name: string;
  version: string;
}

interface CapturedOptions {
  capabilities?: { tools?: unknown };
}

const capturedConstructorArgs: Array<{
  serverInfo: CapturedServerInfo;
  options: CapturedOptions;
}> = [];

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  class FakeMcpServer {
    public server = {};
    constructor(serverInfo: CapturedServerInfo, options: CapturedOptions) {
      capturedConstructorArgs.push({ serverInfo, options });
    }
    registerTool(): void {
      // no-op — createMcpServer registers active tools, but our test
      // registry is empty.
    }
  }
  return { McpServer: FakeMcpServer };
});

function makeLogger(): Logger {
  return new Logger('test', { debugMode: false, accessKey: '' });
}

describe('createMcpServer', () => {
  beforeEach(() => {
    capturedConstructorArgs.length = 0;
  });

  it('advertises the server as "obsidian-mcp-server" per the {service}-mcp-server convention', async () => {
    const { createMcpServer } = await import('../../src/server/mcp-server');
    const registry = new ModuleRegistry(makeLogger());

    createMcpServer(registry, makeLogger());

    expect(capturedConstructorArgs).toHaveLength(1);
    expect(capturedConstructorArgs[0].serverInfo.name).toBe('obsidian-mcp-server');
  });

  it('reports the version from manifest.json (not a hardcoded placeholder)', async () => {
    const { createMcpServer } = await import('../../src/server/mcp-server');
    const registry = new ModuleRegistry(makeLogger());

    createMcpServer(registry, makeLogger());

    expect(capturedConstructorArgs).toHaveLength(1);
    expect(capturedConstructorArgs[0].serverInfo.version).toBe(manifest.version);
    // Sanity: don't let a future regression silently re-introduce '0.0.0'
    // by also asserting it isn't the historical placeholder.
    expect(capturedConstructorArgs[0].serverInfo.version).not.toBe('0.0.0');
  });

  it('declares tool capabilities on the server', async () => {
    const { createMcpServer } = await import('../../src/server/mcp-server');
    const registry = new ModuleRegistry(makeLogger());

    createMcpServer(registry, makeLogger());

    expect(capturedConstructorArgs[0].options.capabilities?.tools).toBeDefined();
  });
});
