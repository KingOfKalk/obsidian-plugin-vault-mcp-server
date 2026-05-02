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

  it('should have schema version 9', () => {
    expect(DEFAULT_SETTINGS.schemaVersion).toBe(9);
  });

  it('should have loopback-only Origin and Host allowlists by default', () => {
    expect(DEFAULT_SETTINGS.allowedOrigins).toEqual([
      'http://127.0.0.1',
      'http://localhost',
      'https://127.0.0.1',
      'https://localhost',
    ]);
    expect(DEFAULT_SETTINGS.allowedHosts).toEqual(['127.0.0.1', 'localhost']);
    expect(DEFAULT_SETTINGS.allowNullOrigin).toBe(false);
    expect(DEFAULT_SETTINGS.requireOrigin).toBe(false);
  });

  it('has bring-your-own-cert disabled by default', () => {
    expect(DEFAULT_SETTINGS.useCustomTls).toBe(false);
    expect(DEFAULT_SETTINGS.customTlsCertPath).toBeNull();
    expect(DEFAULT_SETTINGS.customTlsKeyPath).toBeNull();
  });

  it('should have Bearer authentication disabled by default', () => {
    expect(DEFAULT_SETTINGS.authEnabled).toBe(false);
  });

  it('should have a null TLS certificate by default', () => {
    expect(DEFAULT_SETTINGS.tlsCertificate).toBeNull();
  });

  it('should have default server address 127.0.0.1', () => {
    expect(DEFAULT_SETTINGS.serverAddress).toBe('127.0.0.1');
  });

  it('should have auto-start disabled by default', () => {
    expect(DEFAULT_SETTINGS.autoStart).toBe(false);
  });
});
