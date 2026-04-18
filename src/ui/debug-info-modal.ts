import { App, Modal, Notice } from 'obsidian';
import type McpPlugin from '../main';
import { collectDebugInfo } from '../utils/debug-info';
import { t } from '../lang/helpers';

/**
 * Modal that previews the debug bundle in a read-only textarea and
 * copies it to the clipboard on demand. Implements CR22.
 */
export class DebugInfoModal extends Modal {
  private plugin: McpPlugin;

  constructor(app: App, plugin: McpPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: t('modal_debug_info_title') });

    const textarea = contentEl.createEl('textarea', {
      cls: 'mcp-debug-info-textarea',
      attr: { readonly: 'true', rows: '20' },
    });
    textarea.value = t('modal_debug_info_loading');

    const buttonRow = contentEl.createDiv({
      cls: 'modal-button-container mcp-debug-info-buttons',
    });
    const copyBtn = buttonRow.createEl('button', {
      text: t('button_copy'),
      cls: 'mod-cta',
    });
    const closeBtn = buttonRow.createEl('button', { text: t('button_close') });

    copyBtn.disabled = true;

    copyBtn.addEventListener('click', () => {
      void navigator.clipboard.writeText(textarea.value).then(() => {
        new Notice(t('notice_debug_info_copied'));
      });
    });

    closeBtn.addEventListener('click', () => {
      this.close();
    });

    void collectDebugInfo(this.plugin).then((bundle) => {
      textarea.value = bundle;
      copyBtn.disabled = false;
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
