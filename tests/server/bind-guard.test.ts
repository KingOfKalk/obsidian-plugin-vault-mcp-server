import { describe, it, expect } from 'vitest';
import { insecureBindRefusal, LOOPBACK_ADDRESS } from '../../src/server/bind-guard';

describe('insecureBindRefusal', () => {
  const base = {
    authEnabled: false,
    iAcceptInsecureMode: true,
    serverAddress: LOOPBACK_ADDRESS,
  };

  it('allows any address while authentication is on', () => {
    for (const serverAddress of ['127.0.0.1', '0.0.0.0', '192.168.1.10']) {
      expect(
        insecureBindRefusal({ ...base, authEnabled: true, iAcceptInsecureMode: false, serverAddress }),
      ).toBeNull();
    }
  });

  it('allows 127.0.0.1 without authentication once insecure mode is accepted', () => {
    expect(insecureBindRefusal(base)).toBeNull();
  });

  it('refuses without authentication when insecure mode is not accepted', () => {
    expect(insecureBindRefusal({ ...base, iAcceptInsecureMode: false })).toBe(
      'insecure_mode_not_accepted',
    );
  });

  it('checks the insecure-mode opt-in before the address', () => {
    expect(
      insecureBindRefusal({ ...base, iAcceptInsecureMode: false, serverAddress: '0.0.0.0' }),
    ).toBe('insecure_mode_not_accepted');
  });

  it.each(['0.0.0.0', '192.168.1.10', '10.0.0.1', '127.0.0.2'])(
    'refuses %s without authentication, even with insecure mode accepted',
    (serverAddress) => {
      expect(insecureBindRefusal({ ...base, serverAddress })).toBe('insecure_non_loopback');
    },
  );
});
