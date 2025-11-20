import {
  Confirm,
  Input,
  Select,
} from "https://deno.land/x/cliffy@v1.0.0-rc.4/prompt/mod.ts";
import {
  JiraCliConfig,
  loadConfig,
  resolveIssueViewMode,
  saveConfig,
  type IssueViewMode,
} from "../config.ts";
import { normalizeJql } from "../lib/jql.ts";

export async function runSettingsCommand(): Promise<void> {
  const config = await loadConfig();
  if (!config) {
    console.error("No configuration found. Run `deno task jira:setup` first.");
    return;
  }

  const currentMode = resolveIssueViewMode(config);
  const mode = await promptViewModeChoice(currentMode, true);
  if (!mode) {
    console.log("Settings unchanged.");
    return;
  }

  const updateJql = await Confirm.prompt({
    message: "Update the default JQL as well?",
    default: false,
  });

  let newDefaultJql = config.defaultJql ?? "ORDER BY updated DESC";
  if (updateJql) {
    newDefaultJql = normalizeJql(await Input.prompt({
      message: "New default JQL",
      default: newDefaultJql,
    }));
  }

  const updatedConfig: JiraCliConfig = {
    ...config,
    issueViewMode: mode,
    defaultJql: newDefaultJql.trim() || config.defaultJql,
  };
  await saveConfig(updatedConfig);
  console.log("Settings updated.");
}

export async function promptViewModeChoice(
  current: IssueViewMode,
  allowBack = false,
): Promise<IssueViewMode | undefined> {
  const baseOptions: Array<{ name: string; value: string }> = [
    { name: "Assigned to me & not done", value: "assigned" },
    { name: "Any assignee, not done only", value: "incomplete" },
    { name: "All issues", value: "all" },
  ];

  const options = allowBack
    ? [{ name: "↩ Back without changes", value: "__back" }, ...baseOptions]
    : baseOptions;

  const currentIndex = current === "assigned"
    ? 0
    : current === "incomplete"
    ? 1
    : 2;
  const defaultIndex = allowBack ? currentIndex + 2 : currentIndex + 1;

  const selection = await Select.prompt<string>({
    message: "Choose a filter preset",
    options,
    default: defaultIndex,
  });

  if (selection === "__back") {
    return undefined;
  }
  return selection as IssueViewMode;
}
