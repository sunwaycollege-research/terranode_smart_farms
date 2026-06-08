// TERANODE web — research-backed fertilizer schedule (crop library reference).
// Reads the pure-TS @teranode/agronomy schedule for the selected crop and renders
// the per-growth-stage guidance (germination → harvest): a headline title, the
// concrete dose, an organic / low-cost alternative, and a small source tag
// (TNAU / JICA / NAST / General). Read-only agronomy reference — it does NOT
// touch the editable crop bands or stage targets.

import { fertilizerSchedule } from '@teranode/agronomy';
import type { FertilizerAdvice } from '@teranode/agronomy';
import { stageLabel } from './shared';

export interface FertilizerScheduleProps {
  /** Agronomy crop id (slug) — the same id used by the crop library. */
  cropId: string;
}

/** Map a free-form source citation onto a stable tag + badge tone. */
function sourceMeta(source: string): { tag: string; tone: string } {
  const s = source.toLowerCase();
  if (s.includes('tnau')) return { tag: 'TNAU', tone: 'accent' };
  if (s.includes('jica')) return { tag: 'JICA', tone: 'watering' };
  if (s.includes('nast')) return { tag: 'NAST', tone: 'healthy' };
  if (s.includes('nepal')) return { tag: 'NAST', tone: 'healthy' };
  if (s.includes('general')) return { tag: 'General', tone: 'neutral' };
  return { tag: source, tone: 'neutral' };
}

export function FertilizerSchedule({ cropId }: FertilizerScheduleProps) {
  const schedule: FertilizerAdvice[] = fertilizerSchedule(cropId);

  return (
    <>
      <div className="cr-fert-note" role="note">
        <span className="cr-fert-note__icon" aria-hidden>
          ⚠
        </span>
        <span>
          Doses are <strong>regional references</strong> (Tamil Nadu / Nepal),
          not prescriptions. Always pair them with this farm’s live soil readings
          and local extension advice before applying.
        </span>
      </div>

      {schedule.length === 0 ? (
        <div className="tn-state">
          <span className="tn-state__icon" aria-hidden>
            🧪
          </span>
          <span className="tn-state__title">No fertilizer reference yet</span>
          <p className="tn-state__body">
            This crop has no regional schedule on file. Pair the farm’s live soil
            readings with local extension advice.
          </p>
        </div>
      ) : (
        <ol className="cr-fert">
          {schedule.map((a, i) => {
            const src = sourceMeta(a.source);
            return (
              <li className="cr-fert__item" key={`${a.stage}-${i}`}>
                <div className="cr-fert__rail" aria-hidden>
                  <span className="cr-fert__dot" />
                </div>
                <div className="cr-fert__card">
                  <div className="cr-fert__head">
                    <span className="cr-fert__stage">{stageLabel(a.stage)}</span>
                    <span className="cr-fert__title">{a.titleEn}</span>
                    <span className="tn-spacer" />
                    <span
                      className={`tn-badge tn-badge--${src.tone} cr-fert__src`}
                      title={a.source}
                    >
                      {src.tag}
                    </span>
                  </div>

                  <div className="cr-fert__row">
                    <span className="cr-fert__k">Dose</span>
                    <span className="cr-fert__v">{a.doseEn}</span>
                  </div>
                  <div className="cr-fert__row cr-fert__row--organic">
                    <span className="cr-fert__k">Organic</span>
                    <span className="cr-fert__v">{a.organicEn}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
