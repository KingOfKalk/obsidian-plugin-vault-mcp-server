import { describe, it, expect } from 'vitest';
import {
  migrateV0ToV1,
  migrateV1ToV2,
  migrateV2ToV3,
  migrateV3ToV4,
  migrateV4ToV5,
  migrateV5ToV6,
  migrateV6ToV7,
  migrateV7ToV8,
  migrateV8ToV9,
  migrateV9ToV10,
  migrateV10ToV11,
  migrateSettings,
  CURRENT_SCHEMA_VERSION,
} from '../../src/settings/migrations';

describe('settings migrations — per-version hops', () => {
  it('V0 -> V1 fills in required fields', () => {
    const data: Record<string, unknown> = {};
    migrateV0ToV1(data);
    expect(data.port).toBe(28741);
    expect(data.accessKey).toBe('');
    expect(data.httpsEnabled).toBe(false);
    expect(data.debugMode).toBe(false);
    expect(data.moduleStates).toEqual({});
  });

  it('V0 -> V1 preserves existing non-default values', () => {
    const data: Record<string, unknown> = {
      port: 9999,
      accessKey: 'keep-me',
      httpsEnabled: true,
      debugMode: true,
      moduleStates: { vault: { enabled: true } },
    };
    migrateV0ToV1(data);
    expect(data.port).toBe(9999);
    expect(data.accessKey).toBe('keep-me');
    expect(data.httpsEnabled).toBe(true);
    expect(data.debugMode).toBe(true);
  });

  it('V1 -> V2 adds serverAddress', () => {
    const data: Record<string, unknown> = {};
    migrateV1ToV2(data);
    expect(data.serverAddress).toBe('127.0.0.1');
  });

  it('V1 -> V2 preserves a custom serverAddress', () => {
    const data: Record<string, unknown> = { serverAddress: '0.0.0.0' };
    migrateV1ToV2(data);
    expect(data.serverAddress).toBe('0.0.0.0');
  });

  it('V2 -> V3 adds autoStart=false on upgrade', () => {
    const data: Record<string, unknown> = {};
    migrateV2ToV3(data);
    expect(data.autoStart).toBe(false);
  });

  it('V3 -> V4 strips per-module readOnly flags', () => {
    const data: Record<string, unknown> = {
      moduleStates: {
        vault: { enabled: true, readOnly: false },
      },
    };
    migrateV3ToV4(data);
    expect(data.moduleStates).toEqual({ vault: { enabled: true } });
  });

  it('V3 -> V4 preserves get_date when extras was enabled', () => {
    const data: Record<string, unknown> = {
      moduleStates: { extras: { enabled: true } },
    };
    migrateV3ToV4(data);
    expect(data.moduleStates).toEqual({
      extras: { enabled: true, toolStates: { get_date: true } },
    });
  });

  it('V3 -> V4 leaves get_date off when extras was disabled', () => {
    const data: Record<string, unknown> = {
      moduleStates: { extras: { enabled: false } },
    };
    migrateV3ToV4(data);
    expect(data.moduleStates).toEqual({
      extras: { enabled: false, toolStates: {} },
    });
  });

  it('V4 -> V5 seeds tlsCertificate as null', () => {
    const data: Record<string, unknown> = {};
    migrateV4ToV5(data);
    expect(data.tlsCertificate).toBeNull();
  });

  it('V5 -> V6 defaults authEnabled off', () => {
    const data: Record<string, unknown> = {};
    migrateV5ToV6(data);
    expect(data.authEnabled).toBe(false);
  });

  it('V6 -> V7 seeds custom TLS fields as off/null', () => {
    const data: Record<string, unknown> = {};
    migrateV6ToV7(data);
    expect(data.useCustomTls).toBe(false);
    expect(data.customTlsCertPath).toBeNull();
    expect(data.customTlsKeyPath).toBeNull();
  });

  it('V7 -> V8 seeds executeCommandAllowlist as empty', () => {
    const data: Record<string, unknown> = {};
    migrateV7ToV8(data);
    expect(data.executeCommandAllowlist).toEqual([]);
  });

  it('V7 -> V8 preserves a user-supplied allowlist', () => {
    const data: Record<string, unknown> = {
      executeCommandAllowlist: ['app:reload'],
    };
    migrateV7ToV8(data);
    expect(data.executeCommandAllowlist).toEqual(['app:reload']);
  });

  it('V8 -> V9 seeds DNS-rebind allowlists with loopback defaults', () => {
    const data: Record<string, unknown> = {};
    migrateV8ToV9(data);
    expect(data.allowedOrigins).toEqual([
      'http://127.0.0.1',
      'http://localhost',
      'https://127.0.0.1',
      'https://localhost',
    ]);
    expect(data.allowedHosts).toEqual(['127.0.0.1', 'localhost']);
    expect(data.allowNullOrigin).toBe(false);
    expect(data.requireOrigin).toBe(false);
  });

  it('V8 -> V9 preserves user-supplied allowlists', () => {
    const data: Record<string, unknown> = {
      allowedOrigins: ['http://my.example'],
      allowedHosts: ['my.example'],
      allowNullOrigin: true,
      requireOrigin: true,
    };
    migrateV8ToV9(data);
    expect(data.allowedOrigins).toEqual(['http://my.example']);
    expect(data.allowedHosts).toEqual(['my.example']);
    expect(data.allowNullOrigin).toBe(true);
    expect(data.requireOrigin).toBe(true);
  });

  it('V9 -> V10 grandfathers default-insecure installs to iAcceptInsecureMode: true', () => {
    // Pre-v10 default was authEnabled: false + accessKey: ''. Those
    // installs would refuse to bind on the new posture; preserve their
    // behaviour by setting iAcceptInsecureMode: true so the server
    // keeps starting after upgrade. The plugin will surface a one-time
    // notice on next load (gated by seenInsecureWarning).
    const data: Record<string, unknown> = {
      authEnabled: false,
      accessKey: '',
    };
    migrateV9ToV10(data);
    expect(data.iAcceptInsecureMode).toBe(true);
    expect(data.seenInsecureWarning).toBe(false);
  });

  it('V9 -> V10 leaves iAcceptInsecureMode: false when the user explicitly set authEnabled: true', () => {
    const data: Record<string, unknown> = {
      authEnabled: true,
      accessKey: 'real-key',
    };
    migrateV9ToV10(data);
    expect(data.iAcceptInsecureMode).toBe(false);
    expect(data.seenInsecureWarning).toBe(false);
  });

  it('V9 -> V10 leaves iAcceptInsecureMode: false when auth was off but the user had set an access key', () => {
    // The "auth off + key present" shape implies the user toggled auth
    // off deliberately at some point — not the historical default.
    // Keep them on the strict posture so they hit the insecure-mode
    // notice and choose explicitly.
    const data: Record<string, unknown> = {
      authEnabled: false,
      accessKey: 'a-key',
    };
    migrateV9ToV10(data);
    expect(data.iAcceptInsecureMode).toBe(false);
  });

  it('V9 -> V10 renames extras.toolStates.get_date to extras_get_date', () => {
    const data: Record<string, unknown> = {
      moduleStates: {
        extras: {
          enabled: true,
          toolStates: { get_date: true, other: false },
        },
      },
    };
    migrateV9ToV10(data);
    const states = data.moduleStates as Record<
      string,
      { toolStates?: Record<string, boolean> }
    >;
    expect(states.extras.toolStates).toEqual({
      extras_get_date: true,
      other: false,
    });
  });

  it('V9 -> V10 leaves extras.toolStates alone when it does not contain get_date', () => {
    const data: Record<string, unknown> = {
      moduleStates: {
        extras: {
          enabled: true,
          toolStates: { extras_get_date: true },
        },
      },
    };
    migrateV9ToV10(data);
    const states = data.moduleStates as Record<
      string,
      { toolStates?: Record<string, boolean> }
    >;
    expect(states.extras.toolStates).toEqual({ extras_get_date: true });
  });

  it('V9 -> V10 preserves an existing iAcceptInsecureMode setting', () => {
    const data: Record<string, unknown> = {
      authEnabled: false,
      accessKey: '',
      iAcceptInsecureMode: false,
    };
    migrateV9ToV10(data);
    expect(data.iAcceptInsecureMode).toBe(false);
  });
});

describe('migrateV10ToV11', () => {
  it('sets resourcesEnabled: true for installs without the field', () => {
    const data = {} as Record<string, unknown>;
    migrateV10ToV11(data);
    expect(data.resourcesEnabled).toBe(true);
  });

  it('preserves an explicit false', () => {
    const data = { resourcesEnabled: false } as Record<string, unknown>;
    migrateV10ToV11(data);
    expect(data.resourcesEnabled).toBe(false);
  });

  it('preserves an explicit true', () => {
    const data = { resourcesEnabled: true } as Record<string, unknown>;
    migrateV10ToV11(data);
    expect(data.resourcesEnabled).toBe(true);
  });
});

describe('migrateSettings — composition', () => {
  it('migrates V0 (no schemaVersion) all the way to current', () => {
    const result = migrateSettings({}) as { schemaVersion: number };
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('is idempotent on already-current data', () => {
    const data: Record<string, unknown> = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      port: 1234,
      accessKey: 'keep',
    };
    const before = JSON.stringify(data);
    migrateSettings(data);
    expect(JSON.stringify(data)).toBe(before);
  });

  it('never downgrades data that claims a higher version', () => {
    const data: Record<string, unknown> = {
      schemaVersion: CURRENT_SCHEMA_VERSION + 5,
      port: 1234,
    };
    const before = JSON.stringify(data);
    migrateSettings(data);
    expect(JSON.stringify(data)).toBe(before);
  });
});
