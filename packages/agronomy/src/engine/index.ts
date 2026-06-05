// Agronomy engine barrel — pure, deterministic functions over crop bands.
export { currentStage } from './stage';
export {
  evaluateChannel,
  evaluateChannels,
  evaluateChannelsWithAcceptable,
} from './status';
export { channelScore, zoneHealth } from './health';
export { recommendations } from './recommend';
export { deriveRule } from './rules';
export { analyzeZone } from './analyze';
export type { AnalyzeZoneInput } from './analyze';
