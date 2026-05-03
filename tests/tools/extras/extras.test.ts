import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
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
    expect(content.text).toMatch(ISO_WITH_OFFSET);
  });

  it('extras_get_date encodes the current local UTC offset in the ISO string', async () => {
    const adapter = new MockObsidianAdapter();
    const module = createExtrasModule(adapter);
    const tool = module.tools().find((t) => t.name === 'extras_get_date')!;
    const before = new Date().getTimezoneOffset();
    const result = await tool.handler({});
    const after = new Date().getTimezoneOffset();

    const content = result.content[0] as TextContent;
    const iso = content.text;
    const offsetToken = iso.slice(-6);
    const sign = offsetToken.startsWith('+') ? 1 : -1;
    const [hh, mm] = offsetToken.slice(1).split(':');
    const encodedMinutes = sign * (parseInt(hh, 10) * 60 + parseInt(mm, 10));
    expect([-before, -after]).toContain(encodedMinutes);
  });
});

/**
 * Batch D of #248: every extras read tool that emits `structuredContent`
 * must declare an `outputSchema`. Strict-mode parsing catches drift between
 * the markdown renderer and the structured payload.
 */
describe('extras read tools — outputSchema declarations', () => {
  function getStructured(
    tool: { outputSchema?: z.ZodRawShape },
  ): z.ZodObject<z.ZodRawShape> {
    if (!tool.outputSchema) {
      throw new Error('expected outputSchema to be declared');
    }
    return z.object(tool.outputSchema).strict();
  }

  it('extras_get_date declares outputSchema and parses against handler output', async () => {
    const adapter = new MockObsidianAdapter();
    const tool = createExtrasModule(adapter).tools().find((t) => t.name === 'extras_get_date')!;
    const schema = getStructured(tool);

    const result = await tool.handler({ response_format: 'json' });
    const parsed = schema.parse(result.structuredContent);
    expect(typeof parsed.iso).toBe('string');
    expect(parsed.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
  });
});
