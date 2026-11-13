import { App, Modal } from 'obsidian';
import type McpPlugin from '../main';
import { collectDebugInfo } from '../utils/debug-info';
import { t } from '../lang/helpers';
import { reportError } from '../utils/report-error';
import { copyWithNotice } from '../utils/clipboard';

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
    this.setTitle(t('modal_debug_info_title'));

    const textarea = contentEl.createEl('textarea', {
      cls: 'vault-mcp-debug-info-textarea',
      attr: { readonly: 'true', rows: '20' },
    });
    textarea.value = t('modal_debug_info_loading');

    const buttonRow = contentEl.createDiv({
      cls: 'modal-button-container vault-mcp-debug-info-buttons',
    });
    const copyBtn = buttonRow.createEl('button', {
      text: t('button_copy'),
      cls: 'mod-cta',
    });
    const closeBtn = buttonRow.createEl('button', { text: t('button_close') });

    copyBtn.disabled = true;

    copyBtn.addEventListener('click', () => {
      copyWithNotice(
        textarea.value,
        t('notice_debug_info_copied'),
        'copy debug info',
        this.plugin.logger,
      );
    });

    closeBtn.addEventListener('click', () => {
      this.close();
    });

    void this.showBundle(textarea, copyBtn);
  }

  /** Fill the textarea with the debug bundle and enable Copy. */
  private async showBundle(textarea: HTMLTextAreaElement, copyBtn: HTMLButtonElement): Promise<void> {
    try {
      textarea.value = await collectDebugInfo(this.plugin);
      copyBtn.disabled = false;
    } catch (err) {
      reportError('collect debug info', this.plugin.logger)(err);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
