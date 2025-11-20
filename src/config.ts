import { join } from "https://deno.land/std@0.224.0/path/join.ts";

export interface JiraCliConfig {
  clientId: string;
  clientSecret: string;
  cloudId: string;
  cloudName: string;
  cloudUrl: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  defaultJql?: string;
  lastUsedPrefix?: string;
  issueViewMode?: IssueViewMode;
}

export type IssueViewMode = "assigned" | "incomplete" | "all";

const CONFIG_DIR_NAME = ".jira-pbi-cli";
const CONFIG_FILE_NAME = "config.json";

function resolveHomeDir(): string {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  if (!home) {
    throw new Error(
      "Could not determine the user's home directory. Check your environment variables.",
    );
  }
  return home;
}

export function getConfigDir(): string {
  return join(resolveHomeDir(), CONFIG_DIR_NAME);
}

export function getConfigPath(): string {
  return join(getConfigDir(), CONFIG_FILE_NAME);
}

export async function loadConfig(): Promise<JiraCliConfig | null> {
  try {
    const text = await Deno.readTextFile(getConfigPath());
    const parsed = JSON.parse(text) as JiraCliConfig;
    return parsed;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return null;
    }
    throw error;
  }
}

export async function saveConfig(config: JiraCliConfig): Promise<void> {
  await Deno.mkdir(getConfigDir(), { recursive: true });
  const serialized = JSON.stringify(config, null, 2);
  await Deno.writeTextFile(getConfigPath(), serialized, { mode: 0o600 });
}

export function resolveIssueViewMode(
  config?: JiraCliConfig | null,
): IssueViewMode {
  return config?.issueViewMode ?? "assigned";
}
