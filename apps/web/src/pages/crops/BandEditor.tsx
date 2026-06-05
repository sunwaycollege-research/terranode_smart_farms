// TERANODE web — 8-channel CropBand range editor (unit 5.W3).
// Renders one [low, high] numeric pair per agronomy channel. Pure controlled
// component: the parent owns the CropBand and gets a new clone on every edit.

import type { Channel, CropBand } from '@teranode/types';
import { CHANNEL_META, cloneBand } from './shared';

export interface BandEditorProps {
  band: CropBand;
  onChange: (next: CropBand) => void;
  disabled?: boolean;
}

export function BandEditor({ band, onChange, disabled }: BandEditorProps) {
  function setEdge(ch: Channel, edge: 0 | 1, raw: string) {
    const next = cloneBand(band);
    // empty input → keep as NaN sentinel so the field can be cleared while typing;
    // we coerce to a number and let the row flag invalid pairs.
    const n = raw === '' ? NaN : Number(raw);
    next[ch][edge] = n;
    onChange(next);
  }

  return (
    <div className="cr-band">
      <div className="cr-band__head">
        <span>Channel</span>
        <span>Low</span>
        <span>High</span>
      </div>
      {CHANNEL_META.map(({ key, label, unit, step }) => {
        const [lo, hi] = band[key];
        const loNum = Number(lo);
        const hiNum = Number(hi);
        const invalid =
          Number.isFinite(loNum) && Number.isFinite(hiNum) && loNum > hiNum;
        return (
          <div className="cr-band__row" key={key}>
            <div className="cr-band__ch">
              <span className="cr-band__ch-label">{label}</span>
              {unit ? <span className="cr-band__ch-unit">{unit}</span> : null}
            </div>
            <input
              className={['cr-num', invalid ? 'cr-num--invalid' : '']
                .filter(Boolean)
                .join(' ')}
              type="number"
              inputMode="decimal"
              step={step}
              value={Number.isFinite(loNum) ? lo : ''}
              disabled={disabled}
              aria-label={`${label} low`}
              onChange={(e) => setEdge(key, 0, e.target.value)}
            />
            <input
              className={['cr-num', invalid ? 'cr-num--invalid' : '']
                .filter(Boolean)
                .join(' ')}
              type="number"
              inputMode="decimal"
              step={step}
              value={Number.isFinite(hiNum) ? hi : ''}
              disabled={disabled}
              aria-label={`${label} high`}
              onChange={(e) => setEdge(key, 1, e.target.value)}
            />
          </div>
        );
      })}
    </div>
  );
}

/** True when every channel pair is finite and low <= high. */
export function isBandValid(band: CropBand): boolean {
  return CHANNEL_META.every(({ key }) => {
    const [lo, hi] = band[key];
    return Number.isFinite(Number(lo)) && Number.isFinite(Number(hi)) && lo <= hi;
  });
}
