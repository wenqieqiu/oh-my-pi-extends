/**
 * Config file for this extension: `<agent dir>/oh-my-pi-extends.json`.
 *
 * Deliberately not `settings.json` — that name belongs to the host, and this
 * file is only ever written by our own commands/UI actions.
 *
 * Missing, unreadable, or corrupt files read as defaults (ADHD summary on);
 * reading never rewrites the file.
 */
import { join } from "node:path";
import { getAgentDir } from "./common";

export const PLUGIN_CONFIG_FILE = "oh-my-pi-extends.json";

export interface PluginConfig {
  adhdSummary?: { enabled?: boolean; language?: string };
}

/** Default footer language. Chinese unless the user configures otherwise. */
export const DEFAULT_ADHD_SUMMARY_LANGUAGE = "zh";
/** Config value meaning "match the language of the summarized reply". */
export const ADHD_SUMMARY_LANGUAGE_FOLLOW = "follow";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read the config object. Missing or corrupt files read as `{}`. */
async function readConfig(dir: string): Promise<PluginConfig> {
  const file = Bun.file(join(dir, PLUGIN_CONFIG_FILE));
  if (!(await file.exists())) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch (err) {
    console.warn(
      `oh-my-pi-extends: ignoring unreadable ${PLUGIN_CONFIG_FILE}: ` +
        (err instanceof Error ? err.message : String(err)),
    );
    return {};
  }
  return isPlainObject(parsed) ? parsed : {};
}

/** Whether the ADHD summary footer is enabled. Defaults to `true`. */
export async function getAdhdSummaryEnabled(dir: string = getAgentDir()): Promise<boolean> {
  const config = await readConfig(dir);
  const summary = config.adhdSummary;
  const enabled = isPlainObject(summary) ? summary.enabled : undefined;
  return typeof enabled === "boolean" ? enabled : true;
}

/** Persist the ADHD summary toggle, preserving unrelated keys. */
export async function setAdhdSummaryEnabled(
  enabled: boolean,
  dir: string = getAgentDir(),
): Promise<void> {
  await patchSummary({ enabled }, dir);
}

/** Footer language: a language code/name, or {@link ADHD_SUMMARY_LANGUAGE_FOLLOW}. */
export async function getAdhdSummaryLanguage(dir: string = getAgentDir()): Promise<string> {
  const config = await readConfig(dir);
  const summary = config.adhdSummary;
  const language = isPlainObject(summary) ? summary.language : undefined;
  return typeof language === "string" && language.trim()
    ? language.trim()
    : DEFAULT_ADHD_SUMMARY_LANGUAGE;
}

/** Persist the footer language, preserving unrelated keys. */
export async function setAdhdSummaryLanguage(
  language: string,
  dir: string = getAgentDir(),
): Promise<void> {
  await patchSummary({ language }, dir);
}

/** Merge `patch` into `adhdSummary`, keeping every other key in the file. */
async function patchSummary(
  patch: { enabled?: boolean; language?: string },
  dir: string,
): Promise<void> {
  const config = await readConfig(dir);
  const summary = isPlainObject(config.adhdSummary) ? config.adhdSummary : {};
  config.adhdSummary = { ...summary, ...patch };
  await Bun.write(join(dir, PLUGIN_CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`);
}
