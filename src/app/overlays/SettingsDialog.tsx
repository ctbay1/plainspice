/**
 * Settings (lazy-loaded): text size, contrast and motion, each "Follow my device" by default.
 * A choice applies at once (no Save button) and is remembered on the device (src/app/settings.ts).
 */
import type { ReactNode } from 'react';
import { Label, Radio, RadioGroup, Text } from 'react-aria-components';
import { t, type MessageKey } from '../../i18n/index.ts';
import { CONTRASTS, MOTIONS, TEXT_SIZES, type Settings } from '../settings.ts';
import { DialogFrame } from './DialogFrame.tsx';

function Choice<K extends string>({
  label,
  help,
  value,
  options,
  names,
  onChange,
}: {
  label: string;
  help: string;
  value: K;
  options: readonly K[];
  names: Record<K, MessageKey>;
  onChange: (value: K) => void;
}): ReactNode {
  return (
    <RadioGroup className="radio-group" value={value} onChange={(v) => onChange(v as K)}>
      <Label className="radio-group__label">{label}</Label>
      <div className="radio-group__options">
        {options.map((o) => (
          <Radio key={o} value={o} className="radio">
            <span className="radio__dot" aria-hidden="true" />
            {t(names[o])}
          </Radio>
        ))}
      </div>
      <Text slot="description" className="hint">
        {help}
      </Text>
    </RadioGroup>
  );
}

export default function SettingsDialog({
  settings,
  onChange,
  onOpenChange,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  onOpenChange: (isOpen: boolean) => void;
}): ReactNode {
  return (
    <DialogFrame title={t('settingsTitle')} onOpenChange={onOpenChange}>
      <p>{t('settingsIntro')}</p>
      <Choice
        label={t('textSize')}
        help={t('textSizeHelp')}
        value={settings.textSize}
        options={TEXT_SIZES}
        names={{ device: 'followDevice', normal: 'textSizeNormal', large: 'textSizeLarge', 'x-large': 'textSizeXLarge' }}
        onChange={(textSize) => onChange({ ...settings, textSize })}
      />
      <Choice
        label={t('contrast')}
        help={t('contrastHelp')}
        value={settings.contrast}
        options={CONTRASTS}
        names={{ device: 'followDevice', normal: 'contrastNormal', more: 'contrastMore' }}
        onChange={(contrast) => onChange({ ...settings, contrast })}
      />
      <Choice
        label={t('motion')}
        help={t('motionHelp')}
        value={settings.motion}
        options={MOTIONS}
        names={{ device: 'followDevice', normal: 'motionNormal', reduce: 'motionReduce' }}
        onChange={(motion) => onChange({ ...settings, motion })}
      />
    </DialogFrame>
  );
}
