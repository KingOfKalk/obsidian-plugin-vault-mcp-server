import { Setting } from 'obsidian';
import type McpPlugin from '../main';
import { t, type TranslationKey } from '../lang/helpers';
import {
  CustomTlsError,
  loadAndValidateCustomTls,
} from '../server/custom-tls';
import { pickFile } from '../utils/file-picker';
import { reportError } from '../utils/report-error';
import {
  createValidationError,
  type ValidationErrorController,
} from './validation';

/**
 * "Custom TLS" subsection of Server Settings — two file pickers (cert + key)
 * with live validation feedback. Only rendered when the user has toggled the
 * "use custom TLS" flag on.
 */
export function renderTlsSection(
  containerEl: HTMLElement,
  plugin: McpPlugin,
  refresh: () => void,
): void {
  containerEl.createEl('h3', { text: t('heading_custom_tls_group') });

  const certSetting = new Setting(containerEl)
    .setName(t('setting_custom_tls_cert_name'))
    .setDesc(
      t('setting_custom_tls_cert_desc', {
        path:
          plugin.settings.customTlsCertPath ?? t('label_no_file_selected'),
      }),
    );
  const certError = createValidationError(certSetting);
  certSetting.addButton((btn) =>
    btn.setButtonText(t('button_browse')).onClick(() => {
      pickCustomTlsPath(plugin, 'cert', refresh).catch(
        reportError('pick custom TLS certificate', plugin.logger),
      );
    }),
  );

  const keySetting = new Setting(containerEl)
    .setName(t('setting_custom_tls_key_name'))
    .setDesc(
      t('setting_custom_tls_key_desc', {
        path:
          plugin.settings.customTlsKeyPath ?? t('label_no_file_selected'),
      }),
    );
  const keyError = createValidationError(keySetting);
  keySetting.addButton((btn) =>
    btn.setButtonText(t('button_browse')).onClick(() => {
      pickCustomTlsPath(plugin, 'key', refresh).catch(
        reportError('pick custom TLS key', plugin.logger),
      );
    }),
  );

  const { customTlsCertPath, customTlsKeyPath } = plugin.settings;
  if (customTlsCertPath && customTlsKeyPath) {
    void loadAndValidateCustomTls(customTlsCertPath, customTlsKeyPath).then(
      () => {
        certError.clear();
        keyError.clear();
      },
      (err: unknown) => {
        showCustomTlsError(err, certError, keyError);
      },
    );
  }
}

async function pickCustomTlsPath(
  plugin: McpPlugin,
  kind: 'cert' | 'key',
  refresh: () => void,
): Promise<void> {
  const title =
    kind === 'cert' ? t('dialog_title_pick_cert') : t('dialog_title_pick_key');
  const filters =
    kind === 'cert'
      ? [
          { name: 'PEM certificate', extensions: ['pem', 'crt', 'cer'] },
          { name: 'All files', extensions: ['*'] },
        ]
      : [
          { name: 'PEM private key', extensions: ['pem', 'key'] },
          { name: 'All files', extensions: ['*'] },
        ];
  const chosen = await pickFile({ title, filters });
  if (!chosen) return;

  if (kind === 'cert') {
    plugin.settings.customTlsCertPath = chosen;
  } else {
    plugin.settings.customTlsKeyPath = chosen;
  }
  await plugin.saveSettings();
  refresh();
}

function showCustomTlsError(
  err: unknown,
  certError: ValidationErrorController,
  keyError: ValidationErrorController,
): void {
  if (!(err instanceof CustomTlsError)) {
    certError.show(err instanceof Error ? err.message : String(err));
    keyError.clear();
    return;
  }
  const key: TranslationKey = `error_custom_tls_${err.code}`;
  const message = t(key);
  switch (err.code) {
    case 'cert_not_readable':
    case 'invalid_cert':
    case 'cert_expired':
      certError.show(message);
      keyError.clear();
      return;
    case 'key_not_readable':
    case 'invalid_key':
      keyError.show(message);
      certError.clear();
      return;
    case 'key_cert_mismatch':
      certError.show(message);
      keyError.show(message);
      return;
  }
}
