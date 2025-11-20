import {
  Confirm,
  Input,
  Select,
} from "https://deno.land/x/cliffy@v1.0.0-rc.4/prompt/mod.ts";
import {
  getConfigPath,
  JiraCliConfig,
  loadConfig,
  saveConfig,
  resolveIssueViewMode,
  type IssueViewMode,
} from "../config.ts";
import { JiraClient, JiraIssue } from "../jira_client.ts";
import {
  applyViewModeFilters,
  getModeLabel,
  getModePriority,
  normalizeJql,
} from "../lib/jql.ts";
import {
  ensureGitRepository,
  gitBranchExists,
  runGit,
} from "../lib/git.ts";
import { BRANCH_PREFIXES } from "../prefixes.ts";
import { needsTokenRefresh, refreshAccessToken } from "../oauth.ts";

const MAX_RESULTS = 50;

interface IssueContext {
  jql: string;
  parentKey?: string;
  issues: JiraIssue[];
  total: number;
}

export async function runBrowseCommand(options: { jql?: string }) {
  const loadedConfig = await loadConfig();
  if (!loadedConfig || !loadedConfig.clientId || !loadedConfig.cloudId) {
    console.error(
      "Configuration was not found or is outdated. Run `deno task jira:setup` first.",
    );
    return;
  }

  let activeConfig = loadedConfig;
  const persistConfig = async (next: JiraCliConfig) => {
    activeConfig = next;
    await saveConfig(activeConfig);
  };

  const tokenProvider = createAccessTokenProvider(
    () => activeConfig,
    persistConfig,
  );

  const client = new JiraClient(activeConfig, tokenProvider);
  const normalizedBase = normalizeJql(
    options.jql ?? activeConfig.defaultJql ?? "ORDER BY updated DESC",
  );
  const viewMode = resolveIssueViewMode(activeConfig);
  const initialContext = await initializeContext(
    client,
    normalizedBase,
    viewMode,
  );

  await browseIssues(client, () => activeConfig, persistConfig, initialContext);
}

async function browseIssues(
  client: JiraClient,
  getConfig: () => JiraCliConfig,
  persistConfig: (config: JiraCliConfig) => Promise<void>,
  initialContext: IssueContext,
): Promise<void> {
  const contextStack: IssueContext[] = [initialContext];

  while (contextStack.length > 0) {
    const current = contextStack[contextStack.length - 1];

    if (!current.issues.length) {
      try {
        await loadMoreIssues(client, current);
      } catch (error) {
        console.error("Failed to fetch data from Jira.");
        console.error(error instanceof Error ? error.message : String(error));
        const retry = await Confirm.prompt({ message: "Retry?", default: true });
        if (!retry) {
          return;
        }
        continue;
      }
    }

    const selection = await promptIssueList(current, contextStack.length > 1);

    if (selection === "__exit") {
      return;
    }
    if (selection === "__back") {
      contextStack.pop();
      continue;
    }
    if (selection === "__refresh") {
      current.issues = [];
      current.total = 0;
      continue;
    }
    if (selection === "__more") {
      await loadMoreIssues(client, current);
      continue;
    }

    if (selection.startsWith(ISSUE_VALUE_PREFIX)) {
      const key = selection.replace(ISSUE_VALUE_PREFIX, "");
      const issue = current.issues.find((item) => item.key === key);
      if (!issue) {
        console.error(`Selected issue (${key}) was not found in the current list.`);
        continue;
      }
      await handleIssueSelection(issue, client, getConfig, persistConfig, contextStack);
    }
  }
}

const ISSUE_VALUE_PREFIX = "ISSUE:";

async function promptIssueList(
  context: IssueContext,
  hasParent: boolean,
): Promise<string> {
  const options: Array<{ name: string; value: string }> = [];

  const formattedIssues = context.issues.map((issue) => ({
    name: formatIssue(issue),
    value: `${ISSUE_VALUE_PREFIX}${issue.key}`,
  }));
  options.push(...formattedIssues);

  if (context.issues.length < context.total) {
    const remaining = context.total - context.issues.length;
    options.push({
      name: `📥 Load more (${remaining} remaining)`,
      value: "__more",
    });
  }

  if (hasParent) {
    options.push({ name: "⬅ Back to parent list", value: "__back" });
  }
  options.push({ name: "🔄 Refresh", value: "__refresh" });
  options.push({ name: "⏻ Exit", value: "__exit" });

  const title = context.parentKey
    ? `Choose a task under ${context.parentKey} (${context.issues.length}/${context.total || "?"})`
    : `Choose a task to work on (${context.issues.length}/${context.total || "?"})`;

  return await Select.prompt({
    message: title,
    search: true,
    options,
  });
}

async function loadMoreIssues(
  client: JiraClient,
  context: IssueContext,
): Promise<void> {
  const startAt = context.issues.length;
  const response = await client.searchIssues(context.jql, startAt, MAX_RESULTS);
  context.issues.push(...response.issues);
  context.total = response.total;
}

async function initializeContext(
  client: JiraClient,
  baseJql: string,
  currentMode: IssueViewMode,
): Promise<IssueContext> {
  const modes = getModePriority(currentMode);
  let fallbackContext: IssueContext | undefined;
  for (const mode of modes) {
    const finalJql = applyViewModeFilters(baseJql, mode);
    const response = await client.searchIssues(finalJql, 0, MAX_RESULTS);
    const context: IssueContext = {
      jql: finalJql,
      issues: [...response.issues],
      total: response.total,
    };
    if (response.issues.length > 0) {
      if (mode !== currentMode) {
        console.log(
          `No issues for "${getModeLabel(currentMode)}"; switched to "${getModeLabel(mode)}".`,
        );
      }
      return context;
    }
    fallbackContext = context;
  }
  return fallbackContext ?? {
    jql: applyViewModeFilters(baseJql, currentMode),
    issues: [],
    total: 0,
  };
}

async function handleIssueSelection(
  issue: JiraIssue,
  client: JiraClient,
  getConfig: () => JiraCliConfig,
  persistConfig: (config: JiraCliConfig) => Promise<void>,
  contextStack: IssueContext[],
): Promise<void> {
  console.log(`\n[${issue.key}] ${issue.fields.summary ?? "(No summary)"}`);
  console.log(
    `Type: ${issue.fields.issuetype?.name ?? "Unknown"} / Status: ${
      issue.fields.status?.name ?? "Unspecified"
    }`,
  );

  let childResponse: Awaited<ReturnType<typeof client.fetchChildIssues>> | null =
    null;
  try {
    childResponse = await client.fetchChildIssues(issue.key);
  } catch (error) {
    console.error("Failed to fetch child issues.");
    console.error(error instanceof Error ? error.message : String(error));
  }

  const childCount = childResponse?.issues.length ?? 0;
  const actionOptions: Array<{ name: string; value: string }> = [];
  if (childResponse && childResponse.issues.length > 0) {
    actionOptions.push({
      name: `📂 View child issues (${childResponse.total})`,
      value: "children",
    });
  }
  actionOptions.push({
    name: `🌱 Create branch (${issue.key})`,
    value: "branch",
  });
  actionOptions.push({ name: "↩ Back to list", value: "back" });
  actionOptions.push({ name: "⏻ Exit", value: "exit" });

  const action = await Select.prompt({
    message: childCount
      ? `Choose an action for ${issue.key}`
      : `Create a branch for ${issue.key}?`,
    options: actionOptions,
  });

  if (action === "exit") {
    Deno.exit(0);
  }
  if (action === "back") {
    return;
  }
  if (action === "children" && childResponse) {
    const childContext: IssueContext = {
      jql: childResponse.jql,
      parentKey: issue.key,
      issues: childResponse.issues,
      total: childResponse.total,
    };
    contextStack.push(childContext);
    return;
  }
  if (action === "branch") {
    await createBranch(issue, getConfig, persistConfig);
  }
}

async function createBranch(
  issue: JiraIssue,
  getConfig: () => JiraCliConfig,
  persistConfig: (config: JiraCliConfig) => Promise<void>,
): Promise<void> {
  const currentConfig = getConfig();
  const prefix = await selectBranchPrefix(currentConfig.lastUsedPrefix);
  if (!prefix) {
    console.log("No prefix selected. Aborting branch creation.");
    return;
  }
  const branchName = `${prefix}/${issue.key}`;

  try {
    await ensureGitRepository();
    const exists = await gitBranchExists(branchName);
    if (exists) {
      const result = await runGit(["checkout", branchName]);
      if (!result.success) {
        throw new Error(result.stderr || "Failed to check out the existing branch.");
      }
      console.log(`Branch ${branchName} already existed. Switched to it.`);
    } else {
      const result = await runGit(["checkout", "-b", branchName]);
      if (!result.success) {
        throw new Error(result.stderr || "Failed to create a new branch.");
      }
      console.log(`Created branch ${branchName}.`);
    }

    const updatedConfig = { ...currentConfig, lastUsedPrefix: prefix };
    await persistConfig(updatedConfig);
    Deno.exit(0);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Failed to create or switch branches.",
    );
    Deno.exit(1);
  }
}

async function selectBranchPrefix(
  lastUsed?: string,
): Promise<string | undefined> {
  const options = BRANCH_PREFIXES.map((prefix) => ({
    name: `${prefix.value.padEnd(10)} ${prefix.description}`,
    value: prefix.value,
  }));
  options.push({ name: "Custom prefix…", value: "__custom" });

  const defaultIndex = lastUsed
    ? options.findIndex((item) => item.value === lastUsed)
    : -1;

  const selection = await Select.prompt({
    message: "Select a branch prefix",
    search: true,
    options,
    ...(defaultIndex >= 0 ? { default: defaultIndex + 1 } : {}),
  });

  if (selection === "__custom") {
    const custom = await Input.prompt({
      message: "Enter a custom prefix",
      validate: (value) =>
        value.trim().length > 0 || "Please enter a prefix.",
    });
    return custom.trim();
  }

  return selection;
}

function formatIssue(issue: JiraIssue): string {
  const summary = (issue.fields.summary ?? "(No summary)").replace(/\s+/g, " ");
  const type = issue.fields.issuetype?.name ?? "Unknown";
  const status = issue.fields.status?.name ?? "Unspecified";
  const childIndicator = issueHasChildrenHint(issue) ? "📂" : " ";
  return `[${issue.key}] ${type} | ${status} ${childIndicator} ${summary}`;
}

function issueHasChildrenHint(issue: JiraIssue): boolean {
  if (issue.fields.subtasks && issue.fields.subtasks.length > 0) {
    return true;
  }
  const typeName = issue.fields.issuetype?.name?.toLowerCase() ?? "";
  return typeName === "epic";
}

function createAccessTokenProvider(
  getConfig: () => JiraCliConfig,
  persistConfig: (config: JiraCliConfig) => Promise<void>,
): () => Promise<string> {
  return async () => {
    const config = getConfig();
    if (!config) throw new Error("Configuration invalid.");
    if (!needsTokenRefresh(config.expiresAt)) {
      return config.accessToken;
    }
    if (!config.refreshToken) {
      throw new Error(
        "Access token expired and no refresh token is available. Re-run `deno task jira:setup`.",
      );
    }
    const tokens = await refreshAccessToken({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: config.refreshToken,
    });
    const updatedConfig: JiraCliConfig = {
      ...config,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    };
    await persistConfig(updatedConfig);
    return updatedConfig.accessToken;
  };
}
