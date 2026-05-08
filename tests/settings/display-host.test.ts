import { describe, it, expect } from 'vitest';
import { displayHost } from '../../src/settings/display-host';

describe('displayHost', () => {
  it('maps the default loopback to localhost', () => {
    expect(displayHost('127.0.0.1')).toBe('localhost');
  });

  it('passes 0.0.0.0 through unchanged (bind-all is intentional)', () => {
    expect(displayHost('0.0.0.0')).toBe('0.0.0.0');
  });

  it('passes a LAN IP through unchanged', () => {
    expect(displayHost('192.168.1.10')).toBe('192.168.1.10');
  });

  it('is idempotent on localhost', () => {
    expect(displayHost('localhost')).toBe('localhost');
  });

  it('passes an empty string through (defensive: mid-edit input)', () => {
    expect(displayHost('')).toBe('');
  });
});
