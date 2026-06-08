// TERANODE web — crop detail / editor drawer (unit 5.W3).
// Two tabs: "Details & bands" (crop metadata + whole-crop ideal/acceptable,
// POST /crops or PATCH /crops/:id) and "Stages" (per-stage bands,
// PATCH /crops/:id/stages). Uses @teranode/types Crop / CropBand shapes.

import { useEffect, useMemo, useState } from 'react';
import type {
  CropBand,
  CropCategory,
  CropRef,
  CropStageInput,
  CropStageRow,
  GrowthStage,
} from '@teranode/types';
import { Badge, Button, Select, Switch, TextField } from '../../components';
import { api, ApiRequestError } from '../../api/client';
import { BandEditor, isBandValid } from './BandEditor';
import { FertilizerSchedule } from './FertilizerSchedule';
import {
  blankBand,
  categoryLabel,
  cloneBand,
  CROP_CATEGORIES,
  GROWTH_STAGES,
  slugify,
  stageLabel,
  STAGE_DEFAULT_START_DAY,
  widen,
  type Lang,
} from './shared';

type Tab = 'details' | 'stages' | 'fertilizer';

export interface CropDrawerProps {
  /** The crop to edit, or null when creating a brand-new crop. */
  crop: CropRef | null;
  /** Whether we're in "create" mode (crop is null). */
  mode: 'edit' | 'create';
  lang: Lang;
  onClose: () => void;
  onSaved: () => void;
}

interface MetaState {
  id: string;
  nameEn: string;
  nameNe: string;
  emoji: string;
  category: CropCategory;
  daysToHarvest: string;
  wateringNotesEn: string;
  wateringNotesNe: string;
}

interface StageState extends CropStageInput {
  /** local key for React lists (stable across edits). */
  _key: string;
}

let stageKeySeq = 0;
function nextKey(): string {
  stageKeySeq += 1;
  return `s${stageKeySeq}`;
}

export function CropDrawer({ crop, mode, lang, onClose, onSaved }: CropDrawerProps) {
  const [tab, setTab] = useState<Tab>('details');

  // crop metadata ------------------------------------------------------------
  const [meta, setMeta] = useState<MetaState>(() => ({
    id: crop?.id ?? '',
    nameEn: crop?.nameEn ?? '',
    nameNe: crop?.nameNe ?? '',
    emoji: crop?.emoji ?? '\u{1F331}',
    category: crop?.category ?? 'fruiting',
    daysToHarvest: crop ? String(crop.daysToHarvest) : '90',
    wateringNotesEn: crop?.wateringNotesEn ?? '',
    wateringNotesNe: crop?.wateringNotesNe ?? '',
  }));
  const [ideal, setIdeal] = useState<CropBand>(() =>
    crop ? cloneBand(crop.ideal) : blankBand(),
  );
  const [acceptable, setAcceptable] = useState<CropBand>(() =>
    crop ? cloneBand(crop.acceptable) : widen(blankBand()),
  );

  // stages -------------------------------------------------------------------
  const [stages, setStages] = useState<StageState[] | null>(crop ? null : []);
  const [openStage, setOpenStage] = useState<string | null>(null);
  const [stagesDirty, setStagesDirty] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load full crop (with stages) for an existing crop.
  useEffect(() => {
    if (!crop) return;
    let alive = true;
    api
      .getCrop(crop.id)
      .then((full) => {
        if (!alive) return;
        setStages(toStageState(full.stages));
      })
      .catch((e) => {
        if (alive) setError(messageOf(e));
      });
    return () => {
      alive = false;
    };
  }, [crop]);

  const editingId = crop?.id ?? null;

  // --- meta helpers ---------------------------------------------------------
  function patchMeta<K extends keyof MetaState>(k: K, v: MetaState[K]) {
    setMeta((m) => ({ ...m, [k]: v }));
  }

  const metaValid = useMemo(() => {
    const days = Number(meta.daysToHarvest);
    const idOk = mode === 'edit' || slugify(meta.id || meta.nameEn).length > 0;
    return (
      meta.nameEn.trim().length > 0 &&
      meta.nameNe.trim().length > 0 &&
      meta.emoji.trim().length > 0 &&
      Number.isFinite(days) &&
      days > 0 &&
      idOk &&
      isBandValid(ideal) &&
      isBandValid(acceptable)
    );
  }, [meta, ideal, acceptable, mode]);

  async function saveDetails() {
    setError(null);
    if (!metaValid) {
      setError('Check the highlighted fields — names, emoji, days-to-harvest, and band ranges (low ≤ high).');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        nameEn: meta.nameEn.trim(),
        nameNe: meta.nameNe.trim(),
        emoji: meta.emoji.trim(),
        category: meta.category,
        daysToHarvest: Number(meta.daysToHarvest),
        wateringNotesEn: meta.wateringNotesEn.trim() || undefined,
        wateringNotesNe: meta.wateringNotesNe.trim() || undefined,
        ideal,
        acceptable,
      };
      if (mode === 'create') {
        const id = slugify(meta.id || meta.nameEn);
        await api.createCrop({ id, ...payload });
      } else if (editingId) {
        await api.updateCrop(editingId, payload);
      }
      onSaved();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setSaving(false);
    }
  }

  // --- stage helpers --------------------------------------------------------
  function patchStage(key: string, fn: (s: StageState) => StageState) {
    setStages((cur) => (cur ? cur.map((s) => (s._key === key ? fn(s) : s)) : cur));
    setStagesDirty(true);
  }
  function removeStage(key: string) {
    setStages((cur) => (cur ? cur.filter((s) => s._key !== key) : cur));
    setStagesDirty(true);
  }
  function addStage() {
    setStages((cur) => {
      const list = cur ?? [];
      const used = new Set(list.map((s) => s.stage));
      const stage =
        GROWTH_STAGES.find((g) => !used.has(g)) ?? 'vegetative';
      const ordinal = list.length;
      const created: StageState = {
        _key: nextKey(),
        stage,
        ordinal,
        startDay: STAGE_DEFAULT_START_DAY[stage],
        ideal: cloneBand(ideal),
        acceptable: cloneBand(acceptable),
      };
      setOpenStage(created._key);
      return [...list, created];
    });
    setStagesDirty(true);
  }

  const stagesValid = useMemo(() => {
    if (!stages) return false;
    return stages.every(
      (s) =>
        Number.isFinite(s.startDay) &&
        s.startDay >= 0 &&
        isBandValid(s.ideal) &&
        isBandValid(s.acceptable),
    );
  }, [stages]);

  async function saveStages() {
    if (!editingId || !stages) return;
    setError(null);
    if (!stagesValid) {
      setError('Every stage needs a valid start day and band ranges (low ≤ high).');
      return;
    }
    setSaving(true);
    try {
      const ordered = [...stages]
        .sort((a, b) => a.startDay - b.startDay)
        .map<CropStageInput>((s, i) => ({
          stage: s.stage,
          ordinal: i,
          startDay: Number(s.startDay),
          ideal: s.ideal,
          acceptable: s.acceptable,
        }));
      const res = await api.updateCropStages(editingId, { stages: ordered });
      setStages(toStageState(res.stages));
      setStagesDirty(false);
      onSaved();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setSaving(false);
    }
  }

  // --- render ---------------------------------------------------------------
  const displayName =
    mode === 'create'
      ? 'New crop'
      : lang === 'ne'
        ? meta.nameNe || meta.nameEn
        : meta.nameEn;

  return (
    <div className="cr-overlay" onMouseDown={onClose}>
      <aside
        className="cr-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={displayName}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="cr-drawer__head">
          <span className="cr-drawer__emoji" aria-hidden>
            {meta.emoji || '\u{1F331}'}
          </span>
          <div className="cr-drawer__titles">
            <div className="cr-drawer__title">{displayName}</div>
            <div className="cr-drawer__sub">
              <Badge tone="accent">{categoryLabel(meta.category)}</Badge>
              {mode === 'edit' && editingId ? (
                <span className="mono">{editingId}</span>
              ) : null}
              <span>
                {meta.daysToHarvest || '?'} days to harvest
              </span>
            </div>
          </div>
          <button className="cr-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="cr-drawer__body">
          <div className="cr-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === 'details'}
              className={tab === 'details' ? 'is-active' : ''}
              onClick={() => setTab('details')}
            >
              Details & bands
            </button>
            <button
              role="tab"
              aria-selected={tab === 'stages'}
              className={tab === 'stages' ? 'is-active' : ''}
              onClick={() => setTab('stages')}
              disabled={mode === 'create'}
              title={
                mode === 'create'
                  ? 'Create the crop first, then edit its stages.'
                  : undefined
              }
            >
              Stages
            </button>
            <button
              role="tab"
              aria-selected={tab === 'fertilizer'}
              className={tab === 'fertilizer' ? 'is-active' : ''}
              onClick={() => setTab('fertilizer')}
              disabled={mode === 'create'}
              title={
                mode === 'create'
                  ? 'Create the crop first to see its fertilizer schedule.'
                  : undefined
              }
            >
              Fertilizer schedule
            </button>
          </div>

          {error ? (
            <div className="tn-alert tn-alert--danger" role="alert">
              <span className="tn-alert__icon" aria-hidden>
                ⚠
              </span>
              <div className="tn-alert__body">{error}</div>
            </div>
          ) : null}

          {tab === 'details' ? (
            <DetailsTab
              meta={meta}
              mode={mode}
              patchMeta={patchMeta}
              ideal={ideal}
              acceptable={acceptable}
              setIdeal={setIdeal}
              setAcceptable={setAcceptable}
              disabled={saving}
            />
          ) : tab === 'stages' ? (
            <StagesTab
              stages={stages}
              openStage={openStage}
              setOpenStage={setOpenStage}
              patchStage={patchStage}
              removeStage={removeStage}
              addStage={addStage}
              disabled={saving}
            />
          ) : editingId ? (
            <FertilizerSchedule cropId={editingId} />
          ) : null}
        </div>

        <footer className="cr-drawer__foot">
          <span className="cr-hint">
            {tab === 'details'
              ? mode === 'create'
                ? 'Saving creates the crop, then open it again to set per-stage bands.'
                : 'Whole-crop fallback bands (used before a stage applies).'
              : tab === 'stages'
                ? stagesDirty
                  ? 'Unsaved stage changes.'
                  : 'Per-stage agronomic targets.'
                : 'Regional fertilizer references — read-only, not a prescription.'}
          </span>
          <span className="tn-spacer" />
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {tab === 'fertilizer' ? 'Close' : 'Cancel'}
          </Button>
          {tab === 'details' ? (
            <Button onClick={saveDetails} loading={saving} disabled={!metaValid}>
              {mode === 'create' ? 'Create crop' : 'Save changes'}
            </Button>
          ) : tab === 'stages' ? (
            <Button
              onClick={saveStages}
              loading={saving}
              disabled={!stagesValid || !stagesDirty}
            >
              Save stages
            </Button>
          ) : null}
        </footer>
      </aside>
    </div>
  );
}

// --- details tab --------------------------------------------------------------

function DetailsTab(props: {
  meta: MetaState;
  mode: 'edit' | 'create';
  patchMeta: <K extends keyof MetaState>(k: K, v: MetaState[K]) => void;
  ideal: CropBand;
  acceptable: CropBand;
  setIdeal: (b: CropBand) => void;
  setAcceptable: (b: CropBand) => void;
  disabled: boolean;
}) {
  const { meta, mode, patchMeta, ideal, acceptable, setIdeal, setAcceptable, disabled } =
    props;
  return (
    <>
      <div className="cr-form-grid">
        {mode === 'create' ? (
          <TextField
            label="Crop ID (slug)"
            value={meta.id}
            placeholder={slugify(meta.nameEn) || 'e.g. tomato'}
            hint="Lowercase id; auto-derived from the English name if left blank."
            onChange={(v) => patchMeta('id', v)}
            disabled={disabled}
          />
        ) : null}
        <TextField
          label="Name (English)"
          value={meta.nameEn}
          onChange={(v) => patchMeta('nameEn', v)}
          disabled={disabled}
        />
        <TextField
          label="Name (नेपाली)"
          value={meta.nameNe}
          onChange={(v) => patchMeta('nameNe', v)}
          disabled={disabled}
        />
        <div className="cr-emoji-input">
          <TextField
            label="Emoji"
            value={meta.emoji}
            maxLength={4}
            onChange={(v) => patchMeta('emoji', v)}
            disabled={disabled}
          />
        </div>
        <Select
          label="Category"
          value={meta.category}
          options={CROP_CATEGORIES.map((c) => ({
            value: c,
            label: categoryLabel(c),
          }))}
          onChange={(v) => patchMeta('category', v as CropCategory)}
          disabled={disabled}
        />
        <TextField
          label="Days to harvest"
          type="number"
          inputMode="numeric"
          value={meta.daysToHarvest}
          onChange={(v) => patchMeta('daysToHarvest', v)}
          disabled={disabled}
        />
      </div>

      <div className="cr-form-grid">
        <TextField
          label="Watering notes (English)"
          value={meta.wateringNotesEn}
          placeholder="Optional grower guidance"
          onChange={(v) => patchMeta('wateringNotesEn', v)}
          disabled={disabled}
        />
        <TextField
          label="Watering notes (नेपाली)"
          value={meta.wateringNotesNe}
          placeholder="वैकल्पिक"
          onChange={(v) => patchMeta('wateringNotesNe', v)}
          disabled={disabled}
        />
      </div>

      <div className="cr-section">
        <div className="cr-section__head">
          <div className="cr-subhead">Ideal band</div>
          <span className="cr-hint">Target range for healthy growth</span>
        </div>
        <BandEditor band={ideal} onChange={setIdeal} disabled={disabled} />
      </div>
      <div className="cr-section">
        <div className="cr-section__head">
          <div className="cr-subhead">Acceptable band</div>
          <span className="cr-hint">Wider tolerance before alerts trigger</span>
        </div>
        <BandEditor band={acceptable} onChange={setAcceptable} disabled={disabled} />
      </div>
    </>
  );
}

// --- stages tab ---------------------------------------------------------------

function StagesTab(props: {
  stages: StageState[] | null;
  openStage: string | null;
  setOpenStage: (k: string | null) => void;
  patchStage: (key: string, fn: (s: StageState) => StageState) => void;
  removeStage: (key: string) => void;
  addStage: () => void;
  disabled: boolean;
}) {
  const { stages, openStage, setOpenStage, patchStage, removeStage, addStage, disabled } =
    props;

  if (stages === null) {
    return (
      <div className="tn-state" role="status" aria-live="polite">
        <span className="tn-spinner tn-spinner--lg" aria-hidden />
        <span className="tn-state__title">Loading stages…</span>
      </div>
    );
  }

  const sorted = [...stages].sort((a, b) => a.startDay - b.startDay);

  return (
    <>
      {sorted.length === 0 ? (
        <div className="tn-state">
          <span className="tn-state__icon" aria-hidden>
            🌿
          </span>
          <span className="tn-state__title">No growth stages yet</span>
          <p className="tn-state__body">
            Add a stage to define stage-specific agronomic targets.
          </p>
          <div className="tn-state__actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={addStage}
              disabled={disabled}
            >
              + Add stage
            </Button>
          </div>
        </div>
      ) : (
        sorted.map((s) => {
          const open = openStage === s._key;
          return (
            <div className={`cr-stage${open ? ' is-open' : ''}`} key={s._key}>
              <button
                type="button"
                className="cr-stage__head"
                aria-expanded={open}
                onClick={() => setOpenStage(open ? null : s._key)}
              >
                <span
                  className={`cr-stage__caret${open ? ' is-open' : ''}`}
                  aria-hidden
                >
                  ▶
                </span>
                <span className="cr-stage__name">{stageLabel(s.stage)}</span>
                <span className="tn-spacer" />
                <span className="cr-stage__day">
                  {Number.isFinite(s.startDay) ? `day ${s.startDay}` : 'day —'}
                </span>
              </button>
              {open ? (
                <div className="cr-stage__body">
                  <div className="cr-form-grid">
                    <Select
                      label="Stage"
                      value={s.stage}
                      options={GROWTH_STAGES.map((g) => ({
                        value: g,
                        label: stageLabel(g),
                      }))}
                      onChange={(v) =>
                        patchStage(s._key, (prev) => ({
                          ...prev,
                          stage: v as GrowthStage,
                        }))
                      }
                      disabled={disabled}
                    />
                    <div className="tn-field">
                      <label className="tn-field__label">Start day</label>
                      <div className="cr-stage__startfield">
                        <input
                          className="cr-num"
                          type="number"
                          inputMode="numeric"
                          min={0}
                          value={Number.isFinite(s.startDay) ? s.startDay : ''}
                          disabled={disabled}
                          onChange={(e) =>
                            patchStage(s._key, (prev) => ({
                              ...prev,
                              startDay:
                                e.target.value === ''
                                  ? NaN
                                  : Number(e.target.value),
                            }))
                          }
                        />
                        <span>days since planting</span>
                      </div>
                    </div>
                  </div>

                  <div className="cr-section">
                    <div className="cr-section__head">
                      <div className="cr-subhead">Ideal band</div>
                      <span className="cr-hint">
                        Target range for this stage
                      </span>
                    </div>
                    <BandEditor
                      band={s.ideal}
                      onChange={(b) =>
                        patchStage(s._key, (prev) => ({ ...prev, ideal: b }))
                      }
                      disabled={disabled}
                    />
                  </div>
                  <div className="cr-section">
                    <div className="cr-section__head">
                      <div className="cr-subhead">Acceptable band</div>
                      <span className="cr-hint">Wider tolerance</span>
                    </div>
                    <BandEditor
                      band={s.acceptable}
                      onChange={(b) =>
                        patchStage(s._key, (prev) => ({ ...prev, acceptable: b }))
                      }
                      disabled={disabled}
                    />
                  </div>

                  <div className="tn-row">
                    <span className="tn-spacer" />
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => removeStage(s._key)}
                      disabled={disabled}
                    >
                      Remove stage
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })
      )}
      {sorted.length > 0 ? (
        <div className="tn-row">
          <Button
            variant="secondary"
            size="sm"
            onClick={addStage}
            disabled={disabled}
          >
            + Add stage
          </Button>
          <span className="tn-spacer" />
          <span className="cr-hint">
            {sorted.length} {sorted.length === 1 ? 'stage' : 'stages'} ·
            ordered by start day
          </span>
        </div>
      ) : null}
    </>
  );
}

// --- helpers ------------------------------------------------------------------

function toStageState(rows: CropStageRow[]): StageState[] {
  return [...rows]
    .sort((a, b) => a.startDay - b.startDay)
    .map((r) => ({
      _key: nextKey(),
      stage: r.stage,
      ordinal: r.ordinal,
      startDay: r.startDay,
      ideal: cloneBand(r.ideal),
      acceptable: cloneBand(r.acceptable),
    }));
}

function messageOf(e: unknown): string {
  if (e instanceof ApiRequestError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong.';
}
