import { describe, it, expect } from 'vitest';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createUiModule } from '../../../src/tools/ui/index';

describe('UI module', () => {
  it('should register 3 tools', () => {
    const adapter = new MockObsidianAdapter();
    const module = createUiModule(adapter);
    expect(module.tools()).toHaveLength(3);
  });

  it('should show notice without error', async () => {
    const adapter = new MockObsidianAdapter();
    const module = createUiModule(adapter);
    const tool = module.tools().find((t) => t.name === 'ui_notice')!;
    const result = await tool.handler({ message: 'Test notice' });
    expect(result.isError).toBeUndefined();
  });

  it('should return confirm response', async () => {
    const adapter = new MockObsidianAdapter();
    const module = createUiModule(adapter);
    const tool = module.tools().find((t) => t.name === 'ui_confirm')!;
    const result = await tool.handler({ message: 'Are you sure?' });
    expect(result.isError).toBeUndefined();
  });

  it('should return prompt response', async () => {
    const adapter = new MockObsidianAdapter();
    const module = createUiModule(adapter);
    const tool = module.tools().find((t) => t.name === 'ui_prompt')!;
    const result = await tool.handler({ message: 'Enter name' });
    expect(result.isError).toBeUndefined();
  });
});
