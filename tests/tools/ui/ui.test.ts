import { describe, it, expect } from 'vitest';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createUiModule } from '../../../src/tools/ui/index';

describe('UI module', () => {
  it('should register 1 tool', () => {
    const adapter = new MockObsidianAdapter();
    const module = createUiModule(adapter);
    expect(module.tools()).toHaveLength(1);
  });

  it('should show notice without error', async () => {
    const adapter = new MockObsidianAdapter();
    const module = createUiModule(adapter);
    const tool = module.tools().find((t) => t.name === 'ui_notice')!;
    const result = await tool.handler({ message: 'Test notice' });
    expect(result.isError).toBeUndefined();
  });
});
