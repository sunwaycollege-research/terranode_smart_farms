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
        <span>
          <span className="cr-d2h">{c.daysToHarvest}</span>{' '}
          <span className="tn-muted">days</span>
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
      header: '',
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
          <div className="cr-toolbar" style={{ margin: 0 }}>
            <div className="cr-search">
              <TextField
                placeholder={`${t('common.search')}…`}
                value={query}
                onChange={setQuery}
                aria-label={t('common.search')}
              />
            </div>
            <div className="cr-chips">
              <button
                className={`cr-chip${cat === 'all' ? ' is-active' : ''}`}
                onClick={() => setCat('all')}
              >
                All
              </button>
              {CROP_CATEGORIES.map((c) => (
                <button
                  key={c}
                  className={`cr-chip${cat === c ? ' is-active' : ''}`}
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
          rows={filtered}
          rowKey={(c) => c.id}
          onRowClick={openEdit}
          empty={
            loading
              ? t('common.loading')
              : error
                ? error
                : query || cat !== 'all'
                  ? 'No crops match your filters.'
                  : t('common.empty')
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
