import { useState, type ReactNode } from 'react';
import { useSettings, type CardBack } from '../app/settings';
import { Card } from '../components/Card';
import { Segmented, Sheet, Toggle } from '../components/Sheet';
import { useT } from '../i18n/i18n';

const BACKS: CardBack[] = ['blue', 'violet', 'rose', 'teal'];

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const s = useSettings();
  return (
    <Sheet open={open} onClose={onClose} title={t('settings.title')} labelledBy="settings-title">
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('settings.name')}</span>
          <input className="input" maxLength={20} value={s.name} placeholder={t('name.placeholder')} onChange={(e) => s.set({ name: e.target.value })} />
        </label>
        <Field label={t('settings.language')}>
          <Segmented label={t('settings.language')} value={s.lang} onChange={(lang) => s.set({ lang })} options={[{ value: 'en', label: 'English' }, { value: 'bn', label: 'বাংলা' }]} />
        </Field>
        <Field label={t('settings.theme')}>
          <Segmented
            label={t('settings.theme')}
            value={s.theme}
            onChange={(theme) => s.set({ theme })}
            options={(['system', 'light', 'dark'] as const).map((v) => ({ value: v, label: t(`settings.theme.${v}`) }))}
          />
        </Field>
        <Field label={t('settings.motion')}>
          <Segmented
            label={t('settings.motion')}
            value={s.motion}
            onChange={(motion) => s.set({ motion })}
            options={(['system', 'full', 'reduced'] as const).map((v) => ({ value: v, label: t(`settings.motion.${v}`) }))}
          />
        </Field>
        <Field label={t('settings.cardBack')}>
          <div className="flex gap-2" role="radiogroup" aria-label={t('settings.cardBack')}>
            {BACKS.map((b) => (
              <button
                key={b}
                type="button"
                role="radio"
                aria-checked={s.cardBack === b}
                aria-label={b}
                data-cardback={b}
                onClick={() => s.set({ cardBack: b })}
                className={`rounded-lg p-0.5 ${s.cardBack === b ? 'ring-2 ring-accent' : ''}`}
              >
                <Card card={null} size="xs" />
              </button>
            ))}
          </div>
        </Field>
        <div className="flex flex-col">
          <Toggle label={t('settings.sound')} checked={s.sound} onChange={(sound) => s.set({ sound })} />
          <Toggle label={t('settings.fourColour')} checked={s.fourColour} onChange={(fourColour) => s.set({ fourColour })} />
          <Toggle label={t('settings.singleTap')} checked={s.singleTap} onChange={(singleTap) => s.set({ singleTap })} />
        </div>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          {t('settings.done')}
        </button>
      </div>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}

/** Ask for a display name before going online. Resolves with the name, or null if cancelled. */
export function NameSheet({ open, onDone }: { open: boolean; onDone: (name: string | null) => void }) {
  const t = useT();
  const saved = useSettings((s) => s.name);
  const set = useSettings((s) => s.set);
  const [value, setValue] = useState(saved);
  const submit = () => {
    const name = value.trim().slice(0, 20);
    if (!name) return;
    set({ name });
    onDone(name);
  };
  return (
    <Sheet open={open} onClose={() => onDone(null)} title={t('name.prompt')}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-3"
      >
        <input className="input" autoFocus maxLength={20} value={value} placeholder={t('name.placeholder')} onChange={(e) => setValue(e.target.value)} data-testid="name-input" />
        <button type="submit" className="btn btn-primary" disabled={!value.trim()}>
          {t('common.continue')}
        </button>
      </form>
    </Sheet>
  );
}
