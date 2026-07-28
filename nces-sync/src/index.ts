import 'dotenv/config';
import { createLogger } from './lib/logger';
import { createServiceClient } from './lib/supabase-client';
import { SYNC_CONFIG } from './config/sync-config';
import { runSync } from './sync/run-sync';

function parseArgs(argv: string[]) {
  let leaid: string | undefined;
  let states: string[] | undefined;
  let discoverOnly = false;
  let skipDiscover = false;
  let resume = false;
  let force = false;
  let incompleteOnly = false;
  let skipIfSyncedWithinDays: number | undefined;
  let verbose = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--district' || arg === '-d') {
      leaid = argv[++i];
    } else if (arg === '--state' || arg === '-s') {
      states = argv[++i].split(',').map((s) => s.trim().toUpperCase());
    } else if (arg === '--discover-only') {
      discoverOnly = true;
    } else if (arg === '--skip-discover') {
      skipDiscover = true;
    } else if (arg === '--resume') {
      resume = true;
    } else if (arg === '--force') {
      force = true;
    } else if (arg === '--incomplete-only') {
      incompleteOnly = true;
    } else if (arg === '--skip-recent-days') {
      skipIfSyncedWithinDays = Number(argv[++i]);
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return {
    leaid,
    states,
    discoverOnly,
    skipDiscover,
    resume,
    force,
    incompleteOnly,
    skipIfSyncedWithinDays,
    verbose,
  };
}

function printHelp() {
  console.log(`NCES Education Data API → Supabase sync

Usage:
  npm run sync                              # Skips districts synced in last 30 days (default)
  npm run sync -- --state CO --skip-discover --resume
  npm run sync -- --state ALL --skip-discover --force   # Re-pull everything
  npm run sync -- --state TX --skip-discover --incomplete-only
  npm run sync -- --district 0804800 --skip-discover
  npm run sync -- --skip-recent-days 14               # Custom freshness window

Flags:
  --resume              Only districts never synced (last_synced is null)
  --force               Re-sync all districts, ignore last_synced age
  --incomplete-only     Only districts missing configured school years
  --skip-recent-days N  Skip districts synced within N days (default: 30 from sync-config.ts)
                        (year-incomplete districts are never skipped by this window)

Configuration:
  src/config/sync-config.ts   — skipIfSyncedWithinDays: 30

Environment:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
`);
}

async function main() {
  const {
    leaid,
    states,
    discoverOnly,
    skipDiscover,
    resume,
    force,
    incompleteOnly,
    skipIfSyncedWithinDays,
    verbose,
  } = parseArgs(process.argv.slice(2));
  const logger = createLogger(verbose);

  logger.info('NCES sync starting', {
    leaid: leaid ?? 'all matching districts',
    states: states ?? SYNC_CONFIG.states,
    schoolYears: SYNC_CONFIG.schoolYears,
    discoverOnly,
    resume,
    force,
    incompleteOnly,
    skipIfSyncedWithinDays:
      force || incompleteOnly
        ? null
        : (skipIfSyncedWithinDays ?? SYNC_CONFIG.skipIfSyncedWithinDays),
  });

  const supabase = createServiceClient();
  const summary = await runSync({
    leaid,
    stateCodes: states,
    discoverOnly,
    skipDiscover,
    resume,
    force,
    incompleteOnly,
    // incomplete-only must re-pull even if last_synced is recent
    skipIfSyncedWithinDays: incompleteOnly ? undefined : skipIfSyncedWithinDays,
    verbose,
    logger,
    supabase,
  });

  if (summary.districtsProcessed <= 20) {
    for (const result of summary.results) {
      const level = result.errors.length ? 'warn' : 'info';
      logger[level](`${result.dataset} complete`, {
        leaid: result.leaid,
        year: result.year,
        upserted: result.upserted,
        errors: result.errors.length ? result.errors.slice(0, 3) : undefined,
      });
    }
  }

  logger.info('NCES sync finished', {
    districtsProcessed: summary.districtsProcessed,
    districtsSkipped: summary.districtsSkipped,
    totalUpserted: summary.totalUpserted,
    hadErrors: summary.hadErrors,
  });

  if (summary.hadErrors && summary.totalUpserted === 0) process.exit(1);
  if (summary.hadErrors) {
    logger.warn('Sync completed with some errors (partial data may still be usable)');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
