// @teranode/agronomy — the 14-crop library (vegetables + growth-stage timelines)
// and the pure agronomy engine (stage / status / health / recommend / rules /
// analyzeZone). All agronomy *types* live in @teranode/types and are re-exported
// here for convenience so consumers can import everything from one place.

// crop library
export * from './crops';

// engine
export * from './engine';

// re-export the shared agronomy vocabulary (types + constants) for convenience.
export type {
  CropCategory,
  GrowthStage,
  Channel,
  Range,
  CropBand,
  CropStageDef,
  Crop,
  BandStatus,
  ChannelStatus,
  HealthResult,
  RecommendationAction,
  Recommendation,
  DerivedRule,
  CurrentStageResult,
  ChannelReadings,
  ZoneAnalysis,
  Locale,
} from '@teranode/types';
export {
  CHANNEL_DB_MAP,
  CHANNEL_ENGINE_MAP,
  ENGINE_CHANNELS,
  HEALTH_WEIGHTS,
} from '@teranode/types';
