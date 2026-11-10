import { describe, it, expect, afterEach, vi } from 'vitest';
import { z } from 'zod';
import { MockObsidianAdapter } from '../../helpers/mock-adapter';
import { createExtrasModule } from '../../../src/tools/extras/index';

interface TextContent {
  type: 'text';
  text: string;
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

  it('registers extras_get_date as a read-only tool', () => {
    const adapter = new MockObsidianAdapter();
    const module = createExtrasModule(adapter);
    const tool = module.tools()[0];
    expect(tool.name).toBe('extras_get_date');
    expect(tool.annotations.readOnlyHint).toBe(true);
  });

  it('extras_get_date returns a plain ISO-8601 string with timezone offset', async () => {
    const adapter = new MockObsidianAdapter();
    const module = createExtrasModule(adapter);
    const tool = module.tools().find((t) => t.name === 'extras_get_date')!;
    const result = await tool.handler({});
    expect(result.isError).toBeUndefined();

    const content = result.content[0] as TextContent;
    expect(content.type).toBe('text');
    const { iso } = JSON.parse(content.text) as { iso: string };
    expect(iso).toMatch(ISO_WITH_OFFSET);
    expect(result.structuredContent).toEqual({ iso });
  });

  it('extras_get_date encodes the current local UTC offset in the ISO string', async () => {
    const adapter = new MockObsidianAdapter();
    const module = createExtrasModule(adapter);
    const tool = module.tools().find((t) => t.name === 'extras_get_date')!;
    const before = new Date().getTimezoneOffset();
    const result = await tool.handler({});
    const after = new Date().getTimezoneOffset();

    const content = result.content[0] as TextContent;
    const { iso } = JSON.parse(content.text) as { iso: string };
    const offsetToken = iso.slice(-6);
    const sign = offsetToken.startsWith('+') ? 1 : -1;
    const [hh, mm] = offsetToken.slice(1).split(':');
    const encodedMinutes = sign * (parseInt(hh, 10) * 60 + parseInt(mm, 10));
    expect([-before, -after]).toContain(encodedMinutes);
  });

  describe('extras_get_date output for a fixed instant (#531)', () => {
    const originalTz = process.env.TZ;

    afterEach(() => {
      vi.useRealTimers();
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    });

    it.each([
      ['UTC', '2026-04-19T06:30:00.000Z', '2026-04-19T06:30:00.000+00:00'],
      ['Europe/Berlin', '2026-04-19T06:30:00.000Z', '2026-04-19T08:30:00.000+02:00'],
      ['Europe/Berlin', '2026-01-05T23:59:59.007Z', '2026-01-06T00:59:59.007+01:00'],
      ['Asia/Kathmandu', '2026-12-31T18:15:00.050Z', '2027-01-01T00:00:00.050+05:45'],
      ['America/St_Johns', '2026-07-01T02:00:00.999Z', '2026-06-30T23:30:00.999-02:30'],
      ['America/Los_Angeles', '2026-03-08T10:00:00.000Z', '2026-03-08T03:00:00.000-07:00'],
    ])('in %s, %s is %s', async (tz, instant, expected) => {
      process.env.TZ = tz;
      vi.useFakeTimers({ now: new Date(instant), toFake: ['Date'] });
      const tool = createExtrasModule(new MockObsidianAdapter())
        .tools()
        .find((t) => t.name === 'extras_get_date')!;
      const result = await tool.handler({});
      expect(result.structuredContent).toEqual({ iso: expected });
    });
  });
});

/**
 * Batch D of #248: every extras read tool that emits `structuredContent`
 * must declare an `outputSchema`. Strict-mode parsing catches drift between
 * the markdown renderer and the structured payload.
 */
describe('extras read tools — outputSchema declarations', () => {
  function getStructured(
    tool: { outputSchema?: z.ZodRawShape | z.ZodTypeAny },
  ): z.ZodObject<z.ZodRawShape> {
    if (!tool.outputSchema) {
      throw new Error('expected outputSchema to be declared');
    }
    if (tool.outputSchema instanceof z.ZodType) {
      throw new Error('expected outputSchema to be a raw shape, not a full Zod schema');
    }
    return z.object(tool.outputSchema).strict();
  }

  it('extras_get_date declares outputSchema and parses against handler output', async () => {
    const adapter = new MockObsidianAdapter();
    const tool = createExtrasModule(adapter).tools().find((t) => t.name === 'extras_get_date')!;
    const schema = getStructured(tool);

    const result = await tool.handler({});
    const parsed = schema.parse(result.structuredContent);
    expect(typeof parsed.iso).toBe('string');
    expect(parsed.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
  });
});
