import { describe, it, expect } from 'vitest';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createExtrasModule } from '../../../src/tools/extras/index';

interface TextContent {
  type: 'text';
  text: string;
}

interface GetDatePayload {
  iso: string;
  timezone: string;
  utcOffsetMinutes: number;
}

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/;

describe('Extras module', () => {
  it('exposes metadata placing it in the extras group and disabled by default', () => {
    const adapter = new MockObsidianAdapter();
    const module = createExtrasModule(adapter);
    expect(module.metadata.id).toBe('extras');
    expect(module.metadata.group).toBe('extras');
    expect(module.metadata.defaultEnabled).toBe(false);
  });

  it('registers exactly one tool', () => {
    const adapter = new MockObsidianAdapter();
    const module = createExtrasModule(adapter);
    expect(module.tools()).toHaveLength(1);
  });

  it('registers get_date as a read-only tool', () => {
    const adapter = new MockObsidianAdapter();
    const module = createExtrasModule(adapter);
    const tool = module.tools()[0];
    expect(tool.name).toBe('get_date');
    expect(tool.isReadOnly).toBe(true);
  });

  it('get_date returns a valid ISO-8601 string with timezone offset', async () => {
    const adapter = new MockObsidianAdapter();
    const module = createExtrasModule(adapter);
    const tool = module.tools().find((t) => t.name === 'get_date')!;
    const result = await tool.handler({});
    expect(result.isError).toBeUndefined();

    const content = result.content[0] as TextContent;
    const payload = JSON.parse(content.text) as GetDatePayload;
    expect(payload.iso).toMatch(ISO_WITH_OFFSET);
    expect(typeof payload.timezone).toBe('string');
    expect(payload.timezone.length).toBeGreaterThan(0);
    expect(typeof payload.utcOffsetMinutes).toBe('number');
  });

  it('utcOffsetMinutes matches the current local offset', async () => {
    const adapter = new MockObsidianAdapter();
    const module = createExtrasModule(adapter);
    const tool = module.tools().find((t) => t.name === 'get_date')!;
    const before = new Date().getTimezoneOffset();
    const result = await tool.handler({});
    const after = new Date().getTimezoneOffset();

    const content = result.content[0] as TextContent;
    const payload = JSON.parse(content.text) as GetDatePayload;
    expect([-before, -after]).toContain(payload.utcOffsetMinutes);
  });

  it('get_date iso encodes the same offset as utcOffsetMinutes', async () => {
    const adapter = new MockObsidianAdapter();
    const module = createExtrasModule(adapter);
    const tool = module.tools().find((t) => t.name === 'get_date')!;
    const result = await tool.handler({});
    const content = result.content[0] as TextContent;
    const payload = JSON.parse(content.text) as GetDatePayload;

    const offsetToken = payload.iso.slice(-6);
    const sign = offsetToken.startsWith('+') ? 1 : -1;
    const [hh, mm] = offsetToken.slice(1).split(':');
    const encodedMinutes = sign * (parseInt(hh, 10) * 60 + parseInt(mm, 10));
    expect(encodedMinutes).toBe(payload.utcOffsetMinutes);
  });
});
