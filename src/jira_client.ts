import { JiraCliConfig } from "./config.ts";

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary?: string;
    issuetype?: {
      name?: string;
      subtask?: boolean;
      hierarchyLevel?: number;
    };
    status?: {
      name?: string;
    };
    subtasks?: Array<{ key: string }>;
    parent?: {
      key?: string;
      fields?: {
        summary?: string;
      };
    };
  };
}

export interface JiraSearchResponse {
  issues: JiraIssue[];
  total: number;
}

interface JiraField {
  id: string;
  name: string;
  schema?: {
    custom?: string;
  };
}

interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
}

const DEFAULT_FIELDS = "summary,issuetype,status,subtasks,parent,priority";

export class JiraClient {
  private baseUrl: string;
  private fieldNames?: Set<string>;

  constructor(
    config: JiraCliConfig,
    private readonly tokenProvider: () => Promise<string>,
  ) {
    this.baseUrl = `https://api.atlassian.com/ex/jira/${config.cloudId}`;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = new Headers(init.headers ?? {});
    const token = await this.tokenProvider();
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Accept", "application/json");
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(url, { ...init, headers });
    if (!response.ok) {
      const message = await this.extractErrorMessage(response);
      throw new Error(
        `Jira API error (${response.status} ${response.statusText}): ${message}`,
      );
    }

    return response.json() as Promise<T>;
  }

  private async extractErrorMessage(response: Response): Promise<string> {
    try {
      const data = await response.json();
      if (data && typeof data === "object") {
        if ("errorMessages" in data && Array.isArray(data.errorMessages)) {
          return data.errorMessages.join(" / ");
        }
        if ("message" in data && typeof data.message === "string") {
          return data.message;
        }
      }
      return JSON.stringify(data);
    } catch {
      return await response.text();
    }
  }

  async searchIssues(
    jql: string,
    startAt = 0,
    maxResults = 50,
  ): Promise<JiraSearchResponse> {
    const params = new URLSearchParams({
      jql,
      startAt: String(startAt),
      maxResults: String(maxResults),
      fields: DEFAULT_FIELDS,
    });
    return await this.request<JiraSearchResponse>(
      `/rest/api/3/search/jql?${params.toString()}`,
    );
  }

  async fetchChildIssues(
    issueKey: string,
  ): Promise<(JiraSearchResponse & { jql: string }) | null> {
    const childJqls = await this.buildChildJql(issueKey);
    if (!childJqls.length) {
      return null;
    }
    const combined = childJqls.map((part) => `(${part})`).join(" OR ");
    const result = await this.searchIssues(combined, 0, 50);
    return { ...result, jql: combined };
  }

  async getCurrentUser(): Promise<JiraUser> {
    return await this.request<JiraUser>("/rest/api/3/myself");
  }

  private async ensureFieldMetadata(): Promise<void> {
    if (this.fieldNames) {
      return;
    }
    const fields = await this.request<JiraField[]>("/rest/api/3/field");
    this.fieldNames = new Set(fields.map((field) => field.name));
  }

  private async buildChildJql(issueKey: string): Promise<string[]> {
    const parts = [`parent = "${issueKey}"`];
    await this.ensureFieldMetadata();
    if (!this.fieldNames) {
      return parts;
    }
    if (this.fieldNames.has("Epic Link")) {
      parts.push(`"Epic Link" = "${issueKey}"`);
    }
    if (this.fieldNames.has("Parent Link")) {
      parts.push(`"Parent Link" = "${issueKey}"`);
    }
    return parts;
  }
}
