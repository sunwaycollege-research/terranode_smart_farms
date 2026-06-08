// TERANODE web — Crop Library admin (unit 5.W3).
// Library table from GET /crops (emoji, en/ne names, category, days-to-harvest,
// ideal-band summary) + an add/edit drawer (POST /crops, PATCH /crops/:id,
// PATCH /crops/:id/stages). Uses @teranode/types Crop/CropBand shapes.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Column } from '../../components';
import { Badge, Button, Card, PageHeader, Table, TextField } from '../../components';
import { api, ApiRequestError } from '../../api/client';
import { useLanguage } from '../../i18n/useLanguage';
import type { CropCategory, CropRef } from '@teranode/types';
import { CropDrawer } from './CropDrawer';
import {
  bandSummary,
  categoryLabel,
  CATEGORY_GLYPH,
  CROP_CATEGORIES,
} from './shared';
import './crops.css';

type DrawerState =
  | { open: false }
  | { open: true; mode: 'create'; crop: null }
  | { open: true; mode: 'edit'; crop: CropRef };

export default function CropsPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();

  const [crops, setCrops] = useState<CropRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<CropCategory | 'all'>('all');
  const [drawer, setDrawer] = useState<DrawerState>({ open: false });

  async function load() {
    setError(null);
    try {
      const res = await api.listCrops();
      setCrops([...res.crops].sort((a, b) => a.nameEn.localeCompare(b.nameEn)));
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t('common.error'));
      setCrops([]);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (!crops) return [];
    const q = query.trim().toLowerCase();
    return crops.filter((c) => {
      if (cat !== 'all' && c.category !== cat) return false;
      if (!q) return true;
      return (
        c.nameEn.toLowerCase().includes(q) ||
        c.nameNe.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        categoryLabel(c.category).toLowerCase().includes(q)
      );
    });
  }, [crops, query, cat]);

  function openEdit(crop: CropRef) {
    setDrawer({ open: true, mode: 'edit', crop });
  }
  function openCreate() {
    setDrawer({ open: true, mode: 'create', crop: null });
  }
  function closeDrawer() {
    setDrawer({ open: false });
  }
  function onSaved() {
    void load();
    closeDrawer();
  }

  const columns: Column<CropRef>[] = [
    {
      header: 'Crop',
      cell: (c) => (
        <div className="cr-crop">
          <span className="cr-crop__emoji" aria-hidden>
            {c.emoji}
          </span>
          <span className="cr-crop__names">
            <span className="cr-crop__en">{c.nameEn}</span>
            <span className="cr-crop__ne">{c.nameNe}</span>
          </span>
        </div>
      ),
    },
    {
      header: 'Category',
      width: '130px',
      cell: (c) => <Badge tone="accent">{categoryLabel(c.category)}</Badge>,
    },
    {
      header: 'Harvest',
      width: '110px',
      align: 'right',
      cell: (c) => (
        <span className="cr-harvest">
          <span className="cr-d2h">{c.daysToHarvest}</span>
          <span className="cr-harvest__unit">days</span>
        </span>
      ),
    },
    {
      header: 'Ideal bands',
      cell: (c) => (
        <div className="cr-bands">
          {bandSummary(c.ideal).map((b) => (
            <span className="cr-band-pill" key={b.label}>
              <span className="cr-band-pill__k">{b.label}</span>
              <span className="cr-band-pill__v">{b.value}</span>
            </span>
          ))}
        </div>
      ),
    },
    {
      header: <span className="tn-visually-hidden">Actions</span>,
      width: '88px',
      align: 'right',
      cell: (c) => (
        <Button
          variant="secondary"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            openEdit(c);
          }}
          aria-label={`Edit ${c.nameEn}`}
        >
          {t('common.edit')}
        </Button>
      ),
    },
  ];

  const loading = crops === null;
  const total = crops?.length ?? 0;

  return (
    <>
      <PageHeader
        title={t('page.crops.title')}
        subtitle={t('page.crops.subtitle')}
        actions={
          <Button onClick={openCreate} disabled={loading}>
            + Add crop
          </Button>
        }
      />

      <Card
        flush
        title={
          loading
            ? t('common.loading')
            : `${filtered.length} of ${total} crops`
        }
        actions={
          <div className="cr-toolbar cr-toolbar--flush">
            <div className="cr-search">
              <span className="cr-search__icon" aria-hidden>
                🔍
              </span>
              <TextField
                className="cr-search__input"
                placeholder={`${t('common.search')}…`}
                value={query}
                onChange={setQuery}
                aria-label={t('common.search')}
              />
              {query ? (
                <button
                  type="button"
                  className="cr-search__clear"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                >
                  ×
                </button>
              ) : null}
            </div>
            <div
              className="cr-chips"
              role="group"
              aria-label="Filter by category"
            >
              <button
                type="button"
                className={`cr-chip${cat === 'all' ? ' is-active' : ''}`}
                aria-pressed={cat === 'all'}
                onClick={() => setCat('all')}
              >
                All
              </button>
              {CROP_CATEGORIES.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={`cr-chip${cat === c ? ' is-active' : ''}`}
                  aria-pressed={cat === c}
                  onClick={() => setCat(c)}
                >
                  <span aria-hidden>{CATEGORY_GLYPH[c]} </span>
                  {categoryLabel(c)}
                </button>
              ))}
            </div>
          </div>
        }
      >
        <Table<CropRef>
          columns={columns}
          rows={loading ? [] : filtered}
          rowKey={(c) => c.id}
          onRowClick={openEdit}
          empty={
            loading ? (
              <div className="tn-state" role="status" aria-live="polite">
                <span className="tn-spinner tn-spinner--lg" aria-hidden />
                <span className="tn-state__title">{t('common.loading')}</span>
              </div>
            ) : error ? (
              <div className="tn-state tn-state--error" role="alert">
                <span className="tn-state__icon" aria-hidden>
                  ⚠
                </span>
                <span className="tn-state__title">{t('common.error')}</span>
                <p className="tn-state__body">{error}</p>
                <div className="tn-state__actions">
                  <Button variant="secondary" size="sm" onClick={() => void load()}>
                    {t('common.retry')}
                  </Button>
                </div>
              </div>
            ) : query || cat !== 'all' ? (
              <div className="tn-state">
                <span className="tn-state__icon" aria-hidden>
                  🔍
                </span>
                <span className="tn-state__title">No crops match your filters</span>
                <p className="tn-state__body">
                  Try a different search term or clear the category filter.
                </p>
                {(query || cat !== 'all') && (
                  <div className="tn-state__actions">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setQuery('');
                        setCat('all');
                      }}
                    >
                      Clear filters
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="tn-state">
                <span className="tn-state__icon" aria-hidden>
                  🌱
                </span>
                <span className="tn-state__title">No crops yet</span>
                <p className="tn-state__body">
                  Add your first crop to build the agronomy library.
                </p>
                <div className="tn-state__actions">
                  <Button size="sm" onClick={openCreate}>
                    + Add crop
                  </Button>
                </div>
              </div>
            )
          }
        />
      </Card>

      {drawer.open ? (
        <CropDrawer
          crop={drawer.crop}
          mode={drawer.mode}
          lang={language}
          onClose={closeDrawer}
          onSaved={onSaved}
        />
      ) : null}
    </>
  );
}
