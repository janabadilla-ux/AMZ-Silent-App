import { getSupabase } from './supabase-client';

export type Category = 'productive' | 'neutral' | 'unproductive' | 'uncategorized';

// Built-in default category map (35 common apps, lowercase keys)
const BUILT_IN: Record<string, Category> = {
  // Browsers — neutral
  'chrome': 'neutral', 'google chrome': 'neutral', 'firefox': 'neutral',
  'msedge': 'neutral', 'microsoft edge': 'neutral', 'safari': 'neutral',
  'opera': 'neutral', 'brave': 'neutral', 'brave browser': 'neutral',
  // IDEs & dev — productive
  'code': 'productive', 'visual studio code': 'productive',
  'webstorm': 'productive', 'idea': 'productive', 'intellij idea': 'productive',
  'pycharm': 'productive', 'xcode': 'productive',
  'devenv': 'productive', 'visual studio': 'productive',
  'android studio': 'productive', 'eclipse': 'productive',
  'sublime_text': 'productive', 'sublime text': 'productive',
  'atom': 'productive', 'notepad++': 'productive',
  // Terminals — productive
  'cmd': 'productive', 'powershell': 'productive', 'windowsterminal': 'productive',
  'windows terminal': 'productive', 'iterm2': 'productive', 'terminal': 'productive',
  'bash': 'productive', 'git bash': 'productive', 'wt': 'productive',
  // Communication — neutral
  'slack': 'neutral', 'teams': 'neutral', 'microsoft teams': 'neutral',
  'zoom': 'neutral', 'discord': 'neutral',
  // Productivity — productive
  'excel': 'productive', 'microsoft excel': 'productive',
  'winword': 'productive', 'microsoft word': 'productive',
  'powerpnt': 'productive', 'microsoft powerpoint': 'productive',
  'notion': 'productive', 'figma': 'productive', 'postman': 'productive',
  'onenote': 'productive', 'outlook': 'productive',
  // Entertainment — unproductive
  'spotify': 'unproductive', 'vlc': 'unproductive', 'vlc media player': 'unproductive',
  'steam': 'unproductive', 'epicgameslauncher': 'unproductive',
};

// Supabase-fetched overrides (refreshed every 15 minutes)
let overrideCache: Record<string, Category> = {};
let lastFetchTime = 0;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export async function refreshCategories(): Promise<void> {
  try {
    const { data, error } = await getSupabase()
      .from('app_categories')
      .select('app_name, category');
    if (error || !data) return;
    overrideCache = {};
    for (const row of data) {
      overrideCache[row.app_name.toLowerCase()] = row.category as Category;
    }
    lastFetchTime = Date.now();
  } catch {
    // Non-fatal: keep using built-ins + cached overrides
  }
}

// Trigger a background refresh if cache is stale (non-blocking)
function maybeRefresh(): void {
  if (Date.now() - lastFetchTime > CACHE_TTL_MS) {
    refreshCategories().catch(() => { /* ignore */ });
  }
}

export function categorize(appName: string): Category {
  maybeRefresh();
  if (!appName) return 'uncategorized';
  const lower = appName.toLowerCase();

  // Exact match in override cache
  if (overrideCache[lower]) return overrideCache[lower];

  // Exact match in built-in map
  if (BUILT_IN[lower]) return BUILT_IN[lower];

  // Partial match: check if any key is contained in the app name or vice versa
  for (const [key, cat] of Object.entries(overrideCache)) {
    if (lower.includes(key) || key.includes(lower)) return cat;
  }
  for (const [key, cat] of Object.entries(BUILT_IN)) {
    if (lower.includes(key) || key.includes(lower)) return cat;
  }

  return 'uncategorized';
}
