import { IssueViewMode } from "../config.ts";

export const FALLBACK_FILTER_CLAUSE = "issueType IS NOT EMPTY";

export function normalizeJql(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return `${FALLBACK_FILTER_CLAUSE} ORDER BY updated DESC`;
  }
  if (/^order\s+by/i.test(trimmed)) {
    return `${FALLBACK_FILTER_CLAUSE} ${trimmed}`;
  }
  return trimmed;
}

export function applyViewModeFilters(jql: string, mode: IssueViewMode): string {
  if (mode === "all") {
    return jql;
  }
  const { queryPart, orderPart } = splitJql(jql);
  const filters: string[] = [];
  if (mode !== "all") {
    filters.push("statusCategory != Done");
  }
  if (mode === "assigned") {
    filters.push("assignee = currentUser()");
  }
  const combinedQuery = filters.length
    ? `(${queryPart}) AND ${filters.map((f) => `(${f})`).join(" AND ")}`
    : queryPart;
  return orderPart ? `${combinedQuery} ${orderPart}` : combinedQuery;
}

export function splitJql(jql: string): { queryPart: string; orderPart?: string } {
  const match = / order by /i.exec(jql);
  if (!match) {
    return { queryPart: jql.trim() };
  }
  const index = match.index;
  const queryPart = jql.slice(0, index).trim();
  const orderPart = jql.slice(index).trim();
  return { queryPart, orderPart };
}

export function getModePriority(mode: IssueViewMode): IssueViewMode[] {
  switch (mode) {
    case "assigned":
      return ["assigned", "incomplete", "all"];
    case "incomplete":
      return ["incomplete", "assigned", "all"];
    default:
      return ["all", "incomplete", "assigned"];
  }
}

export function getModeLabel(mode: IssueViewMode): string {
  switch (mode) {
    case "assigned":
      return "Assigned to me & not done";
    case "incomplete":
      return "Any assignee, not done only";
    default:
      return "All issues";
  }
}
