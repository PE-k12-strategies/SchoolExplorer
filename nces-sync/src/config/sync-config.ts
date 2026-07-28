/**
 * Global sync configuration
 *
 * CHANGE THESE to control what gets synced:
 * - states: which states' districts to discover and sync ('ALL' = entire US, very slow)
 * - schoolYears: CCD years for directory, enrollment, staff
 * - financeYears: CCD finance years (typically lags 2–3 years)
 */
export const SYNC_CONFIG = {
  /** State codes to sync all districts for, or ['ALL'] for every state */
  states: ['ALL'] as string[],

  /** CCD school years — enrollment trends need multiple years here */
  schoolYears: [2015, 2020, 2021, 2022, 2023, 2024] as number[],

  /** CCD finance fiscal years */
  financeYears: [2019, 2020, 2021] as number[],

  /** Year used when discovering district list from the API */
  discoveryYear: 2024,

  /** Pause between districts when syncing many (ms) — helps avoid Cloudflare 429s */
  delayBetweenDistrictsMs: 1200,

  /**
   * Skip districts synced within this many days (default on every run).
   * Use --force to re-pull everything, or --resume for only never-synced districts.
   */
  skipIfSyncedWithinDays: 30,
};
