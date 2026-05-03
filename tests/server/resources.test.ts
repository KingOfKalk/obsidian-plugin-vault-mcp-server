import { describe, it, expect } from 'vitest';
import { getMimeType, isTextMime } from '../../src/server/resources';

describe('getMimeType', () => {
  it('maps known text extensions', () => {
    expect(getMimeType('notes/foo.md')).toBe('text/markdown');
    expect(getMimeType('foo.txt')).toBe('text/plain');
    expect(getMimeType('config.json')).toBe('application/json');
    expect(getMimeType('data.csv')).toBe('text/csv');
    expect(getMimeType('settings.yml')).toBe('application/yaml');
    expect(getMimeType('settings.yaml')).toBe('application/yaml');
    expect(getMimeType('icon.svg')).toBe('image/svg+xml');
  });

  it('maps known binary extensions', () => {
    expect(getMimeType('a.png')).toBe('image/png');
    expect(getMimeType('a.jpg')).toBe('image/jpeg');
    expect(getMimeType('a.jpeg')).toBe('image/jpeg');
    expect(getMimeType('a.pdf')).toBe('application/pdf');
    expect(getMimeType('a.mp3')).toBe('audio/mpeg');
    expect(getMimeType('a.mp4')).toBe('video/mp4');
  });

  it('is case-insensitive on the extension', () => {
    expect(getMimeType('FOO.MD')).toBe('text/markdown');
    expect(getMimeType('PHOTO.JPG')).toBe('image/jpeg');
  });

  it('falls back to application/octet-stream for unknown or missing extensions', () => {
    expect(getMimeType('mystery.xyz')).toBe('application/octet-stream');
    expect(getMimeType('Makefile')).toBe('application/octet-stream');
  });
});

describe('isTextMime', () => {
  it('returns true for text/* and application/json and image/svg+xml', () => {
    expect(isTextMime('text/markdown')).toBe(true);
    expect(isTextMime('text/plain')).toBe(true);
    expect(isTextMime('application/json')).toBe(true);
    expect(isTextMime('image/svg+xml')).toBe(true);
  });

  it('returns false for binary mimes', () => {
    expect(isTextMime('image/png')).toBe(false);
    expect(isTextMime('application/pdf')).toBe(false);
    expect(isTextMime('application/octet-stream')).toBe(false);
  });
});
