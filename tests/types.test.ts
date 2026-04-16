import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/types';

describe('DEFAULT_SETTINGS', () => {
  it('should have the correct default port', () => {
    expect(DEFAULT_SETTINGS.port).toBe(28741);
  });

  it('should have an empty access key by default', () => {
    expect(DEFAULT_SETTINGS.accessKey).toBe('');
  });

  it('should have HTTPS disabled by default', () => {
    expect(DEFAULT_SETTINGS.httpsEnabled).toBe(false);
  });

  it('should have debug mode disabled by default', () => {
    expect(DEFAULT_SETTINGS.debugMode).toBe(false);
  });

  it('should have empty module states by default', () => {
    expect(DEFAULT_SETTINGS.moduleStates).toEqual({});
  });

  it('should have schema version 2', () => {
    expect(DEFAULT_SETTINGS.schemaVersion).toBe(2);
  });

  it('should have default server address 127.0.0.1', () => {
    expect(DEFAULT_SETTINGS.serverAddress).toBe('127.0.0.1');
  });
});
