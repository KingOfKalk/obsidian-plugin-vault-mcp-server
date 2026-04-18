import type { App } from 'obsidian';
import type { McpPluginSettings } from '../types';
import type { ModuleRegistration } from '../registry/types';
import { readLogFile } from './log-file';

/**
 * Builds the plain-text "Copy debug info" bundle (CR22 / NFR33).
 *
 * Sections: Environment, Server, Settings (redacted), Modules,
 * Recent log. The bundle never contains the access key or TLS PEM.
 */

const RECENT_LOG_LINES = 200;

interface ServerSnapshot {
  isRunning: boolean;
  scheme: 'http' | 'https';
  connectedClients: number;
  activeSessions: number;
  port: number;
}

export interface DebugInfoPluginRef {
  app: App & { appVersion?: string };
  manifest: { id: string; version: string };
  settings: McpPluginSettings;
  httpServer: ServerSnapshot | null;
  registry: { getModules: () => ModuleRegistration[] };
}

export async function collectDebugInfo(
  plugin: DebugInfoPluginRef,
): Promise<string> {
  const sections: string[] = [
    section('Environment', renderEnvironment(plugin)),
    section('Server', renderServer(plugin)),
    section('Settings (redacted)', renderSettings(plugin.settings)),
    section('Modules', renderModules(plugin.registry.getModules())),
    section(
      `Recent log (last ${String(RECENT_LOG_LINES)} lines)`,
      await renderRecentLog(plugin),
    ),
  ];
  return sections.join('\n\n') + '\n';
}

function section(title: string, body: string): string {
  return `=== ${title} ===\n${body}`;
}

function renderEnvironment(plugin: DebugInfoPluginRef): string {
  const obsidianVersion = plugin.app.appVersion ?? 'unknown';
  const lines = [
    `Plugin: ${plugin.manifest.id} ${plugin.manifest.version}`,
    `Obsidian: ${obsidianVersion}`,
    `Platform: ${process.platform} ${process.arch}`,
    `Node: ${process.version}`,
  ];
  return lines.join('\n');
}

function renderServer(plugin: DebugInfoPluginRef): string {
  const server = plugin.httpServer;
  if (!server) {
    return 'Status: stopped';
  }
  const lines = [
    `Status: ${server.isRunning ? 'running' : 'stopped'}`,
    `Scheme: ${server.scheme}`,
    `Address: ${plugin.settings.serverAddress}`,
    `Port: ${String(server.port)}`,
    `Connected clients: ${String(server.connectedClients)}`,
    `Active sessions: ${String(server.activeSessions)}`,
  ];
  return lines.join('\n');
}

function renderSettings(settings: McpPluginSettings): string {
  const lines = [
    `schemaVersion: ${String(settings.schemaVersion)}`,
    `serverAddress: ${settings.serverAddress}`,
    `port: ${String(settings.port)}`,
    `accessKey: ${settings.accessKey.length > 0 ? '<set>' : '<empty>'}`,
    `httpsEnabled: ${String(settings.httpsEnabled)}`,
    `tlsCertificate: ${settings.tlsCertificate ? '<present>' : '<absent>'}`,
    `debugMode: ${String(settings.debugMode)}`,
    `autoStart: ${String(settings.autoStart)}`,
  ];
  return lines.join('\n');
}

function renderModules(modules: ModuleRegistration[]): string {
  if (modules.length === 0) {
    return '(none registered)';
  }
  const lines: string[] = [];
  for (const reg of modules) {
    const { id, group } = reg.module.metadata;
    if (group === 'extras') {
      lines.push(`- ${id} (extras)`);
      const tools = reg.module.tools();
      if (tools.length === 0) {
        lines.push('    (no tools)');
        continue;
      }
      for (const tool of tools) {
        const enabled = reg.toolStates[tool.name] ?? false;
        lines.push(`    - ${tool.name} (${enabled ? 'enabled' : 'disabled'})`);
      }
    } else {
      lines.push(`- ${id} (${reg.enabled ? 'enabled' : 'disabled'})`);
    }
  }
  return lines.join('\n');
}

async function renderRecentLog(plugin: DebugInfoPluginRef): Promise<string> {
  const contents = await readLogFile(plugin);
  if (contents.length === 0) {
    return '(log is empty)';
  }
  const lines = contents.split('\n');
  // split on '\n' for a trailing newline produces an empty final element; drop it.
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.slice(-RECENT_LOG_LINES).join('\n');
}
