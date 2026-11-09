import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  renderModulePage,
  renderIndexPage,
  truncateExampleValue,
  EXAMPLE_MAX_ITEMS,
  EXAMPLE_MAX_STRING,
  type ToolDoc,
  type ModuleDoc,
} from '../../../scripts/render-tools/render';

const sampleModule: ModuleDoc = {
  moduleId: 'sample',
  moduleName: 'Sample Module',
  tools: [
    {
      name: 'sample_read',
      title: 'Read sample',
      description: 'Reads a sample.\n\nArgs:\n- path (string)',
      schema: { path: z.string().min(1).describe('Path') },
      outputSchema: { path: z.string().describe('Path read') },
      readOnly: true,
      destructive: false,
    } satisfies ToolDoc,
    {
      name: 'sample_write',
      title: 'Write sample',
      description: 'Writes a sample.',
      schema: { path: z.string().describe('Path'), content: z.string().describe('Body') },
      outputSchema: undefined,
      readOnly: false,
      destructive: false,
    } satisfies ToolDoc,
  ],
};

describe('renderModulePage', () => {
  it('starts with the auto-generated banner and an H1', () => {
    const md = renderModulePage(sampleModule);
    expect(md.split('\n')[0]).toContain('AUTO-GENERATED');
    expect(md).toMatch(/^# Sample Module \(`sample`\)/m);
  });

  it('renders one section per tool with name, title, description, and Input table', () => {
    const md = renderModulePage(sampleModule);
    expect(md).toContain('### sample_read');
    expect(md).toContain('Read sample');
    expect(md).toContain('Reads a sample.');
    expect(md).toContain('#### Input');
    expect(md).toMatch(/\| `path` \| string \(≥1\) \| yes \| Path \|/);
  });

  it('renders an Output section for tools that declare outputSchema', () => {
    const md = renderModulePage(sampleModule);
    expect(md).toContain('#### Output');
    expect(md).toMatch(/\| `path` \| string \| Path read \|/);
  });

  it('renders the no-output marker for tools without outputSchema', () => {
    const md = renderModulePage(sampleModule);
    // The sample_write section should contain the marker, not a table.
    const writeSection = md.split('### sample_write')[1];
    expect(writeSection).toContain(
      '_No `structuredContent` declared — returns plain text or binary._',
    );
    expect(writeSection.split('### ')[0]).not.toContain('| Field | Type | Description |');
  });

  it('preserves the order tools were registered in', () => {
    const md = renderModulePage(sampleModule);
    expect(md.indexOf('### sample_read')).toBeLessThan(md.indexOf('### sample_write'));
  });
});

describe('renderIndexPage', () => {
  it('keeps the existing summary banner, summary table, and totals line', () => {
    const md = renderIndexPage([sampleModule]);
    expect(md).toContain('AUTO-GENERATED');
    expect(md).toContain('# Tool Registry Snapshot');
    expect(md).toContain('| Module ID | Module Name | Count | Tools |');
    expect(md).toMatch(/\*\*Total tools:\*\* 2 across 1 modules\./);
  });

  it('keeps the per-module annotation tables', () => {
    const md = renderIndexPage([sampleModule]);
    expect(md).toContain('### Sample Module (`sample`)');
    expect(md).toContain('| Name | Title | readOnly | destructive |');
    expect(md).toContain('| `sample_read` | Read sample |');
  });

  it('adds a schema link line per module', () => {
    const md = renderIndexPage([sampleModule]);
    expect(md).toContain('Schemas → [docs/tools/sample.generated.md](tools/sample.generated.md)');
  });
});

describe('tool examples (#324)', () => {
  const withExample: ModuleDoc = {
    moduleId: 'sample',
    moduleName: 'Sample Module',
    tools: [
      {
        ...sampleModule.tools[0],
        example: {
          arguments: { path: 'a.md' },
          response: { kind: 'structuredContent', value: { path: 'a.md' } },
        },
      },
      {
        ...sampleModule.tools[1],
        example: {
          arguments: { path: 'b.md', content: 'x' },
          response: { kind: 'content', value: [{ type: 'text', text: '```js\nx\n```' }] },
        },
      },
    ],
  };

  it('renders the request and structuredContent response after the Output section', () => {
    const md = renderModulePage(withExample);
    const section = md.slice(md.indexOf('### sample_read'), md.indexOf('### sample_write'));
    expect(section.indexOf('#### Output')).toBeLessThan(section.indexOf('#### Example'));
    expect(section).toContain('Request (`tools/call` params):');
    expect(section).toContain(
      '```json\n{\n  "name": "sample_read",\n  "arguments": {\n    "path": "a.md"\n  }\n}\n```',
    );
    expect(section).toContain('Response (`structuredContent`):');
    expect(section).toContain('```json\n{\n  "path": "a.md"\n}\n```');
  });

  it('falls back to the content blocks and widens the fence past inner backticks', () => {
    const md = renderModulePage(withExample);
    const section = md.slice(md.indexOf('### sample_write'));
    expect(section).toContain('Response (`content`):');
    // A text block is shown as the text the model reads (#467).
    expect(section).toContain('Text block:\n\n````text\n```js\nx\n```\n````');
  });

  it('shows a non-text block as JSON', () => {
    const md = renderModulePage({
      ...withExample,
      tools: [
        {
          ...withExample.tools[1],
          example: {
            arguments: { path: 'a.png' },
            response: {
              kind: 'content',
              value: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }],
            },
          },
        },
      ],
    });
    expect(md).toContain('`image` block:\n\n```json\n{\n  "type": "image",');
  });

  it('omits the Example heading for tools without an example', () => {
    expect(renderModulePage(sampleModule)).not.toContain('#### Example');
  });

  it('truncates long strings and arrays with a visible marker', () => {
    const long = 'a'.repeat(EXAMPLE_MAX_STRING + 5);
    const items = Array.from({ length: EXAMPLE_MAX_ITEMS + 3 }, (_, i) => i);
    expect(truncateExampleValue({ nested: { long, items } })).toEqual({
      nested: {
        long: `${'a'.repeat(EXAMPLE_MAX_STRING)}… [truncated, 5 more chars]`,
        items: [...items.slice(0, EXAMPLE_MAX_ITEMS), '… 3 more items'],
      },
    });
    expect(truncateExampleValue('short')).toBe('short');
    expect(truncateExampleValue(null)).toBeNull();
  });
});
