import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { renderModulePage, type ToolDoc, type ModuleDoc } from '../../../scripts/render-tools/render';

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
    } satisfies ToolDoc,
    {
      name: 'sample_write',
      title: 'Write sample',
      description: 'Writes a sample.',
      schema: { path: z.string().describe('Path'), content: z.string().describe('Body') },
      outputSchema: undefined,
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
