import {
  Confirm,
  Input,
  Secret,
  Select,
} from "https://deno.land/x/cliffy@v1.0.0-rc.4/prompt/mod.ts";
import {
  getConfigPath,
  JiraCliConfig,
  loadConfig,
  saveConfig,
} from "../config.ts";
import {
  authorizeInBrowser,
  DEFAULT_SCOPES,
  exchangeCodeForTokens,
  fetchAccessibleResources,
} from "../oauth.ts";
import { JiraClient } from "../jira_client.ts";

export async function runSetupCommand(): Promise<void> {
  const existing = await loadConfig();

  let clientId = existing?.clientId ?? "";
  if (clientId) {
    const reuse = await Confirm.prompt({
      message: "Reuse the stored client ID?",
      default: true,
    });
    if (!reuse) {
      clientId = (await Input.prompt({
        message: "Atlassian OAuth client ID",
        default: clientId,
      })).trim();
    }
  } else {
    clientId = (await Input.prompt({
      message: "Atlassian OAuth client ID",
    })).trim();
  }

  let clientSecret = existing?.clientSecret ?? "";
  if (!clientSecret) {
    clientSecret = (await Secret.prompt({
      message: "Atlassian OAuth client secret",
    })).trim();
  } else {
    const updateSecret = await Confirm.prompt({
      message: "Update the stored client secret?",
      default: false,
    });
    if (updateSecret) {
      clientSecret = (await Secret.prompt({
        message: "New Atlassian OAuth client secret",
      })).trim();
    }
  }

  if (!clientId) {
    console.error("Client ID cannot be empty.");
    return;
  }
  if (!clientSecret) {
    console.error("Client secret cannot be empty.");
    return;
  }

  const defaultJqlInput = await Input.prompt({
    message: "Default JQL (press Enter for ORDER BY updated DESC)",
    default: existing?.defaultJql ?? "ORDER BY updated DESC",
  });

  try {
    const oauthCode = await authorizeInBrowser(clientId, DEFAULT_SCOPES);
    const tokens = await exchangeCodeForTokens({
      clientId,
      clientSecret,
      code: oauthCode,
    });
    const resources = await fetchAccessibleResources(tokens.accessToken);
    if (!resources.length) {
      console.error("No accessible Jira resources were returned for this account.");
      return;
    }

    const selected = await selectResourcePrompt(resources.map((res) => ({
      id: res.id,
      name: res.name,
      url: res.url,
    })));

    const config: JiraCliConfig = {
      clientId,
      clientSecret,
      cloudId: selected.id,
      cloudName: selected.name,
      cloudUrl: selected.url,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      defaultJql: defaultJqlInput.trim() || "ORDER BY updated DESC",
      lastUsedPrefix: existing?.lastUsedPrefix,
      issueViewMode: existing?.issueViewMode ?? "assigned",
    };

    const client = new JiraClient(config, async () => config.accessToken);
    const user = await client.getCurrentUser();
    console.log(`Successfully authenticated as ${user.displayName}`);

    await saveConfig(config);
    console.log(`Saved configuration to ${getConfigPath()}`);
  } catch (error) {
    console.error("Failed to complete OAuth setup.");
    console.error(error instanceof Error ? error.message : String(error));
  }
}

async function selectResourcePrompt(
  resources: Array<{ id: string; name: string; url: string }>,
): Promise<{ id: string; name: string; url: string }> {
  if (resources.length === 1) {
    return resources[0];
  }

  const selectedId = await Select.prompt({
    message: "Select a Jira site",
    search: true,
    options: resources.map((resource) => ({
      name: `${resource.name} (${resource.url})`,
      value: resource.id,
    })),
  });

  const resource = resources.find((item) => item.id === selectedId);
  if (!resource) {
    throw new Error("Selected resource no longer exists.");
  }
  return resource;
}
