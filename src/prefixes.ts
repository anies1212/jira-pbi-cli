export interface BranchPrefix {
  value: string;
  description: string;
}

const RAW_PREFIXES: Array<{ label: string; description: string }> = [
  {
    label: "fix",
    description: "Fix issues found in existing features.",
  },
  {
    label: "hotfix",
    description: "Apply an urgent change that cannot wait.",
  },
  {
    label: "add",
    description: "Add a brand-new file or capability.",
  },
  {
    label: "feat",
    description: "Introduce a new feature or file.",
  },
  {
    label: "update",
    description: "Tweak an existing feature where no bug existed.",
  },
  {
    label: "change",
    description: "Adjust functionality due to a requirement change.",
  },
  {
    label: "clean/refactor",
    description: "Refactor or clean up code without altering behavior.",
  },
  {
    label: "improve",
    description: "Improve code quality or structure.",
  },
  {
    label: "disable",
    description: "Temporarily turn off a feature or flag.",
  },
  {
    label: "remove/delete",
    description: "Remove a file or retire an existing feature.",
  },
  {
    label: "rename",
    description: "Rename files, symbols, or resources.",
  },
  {
    label: "move",
    description: "Move files or folders around.",
  },
  {
    label: "upgrade",
    description: "Upgrade dependencies or runtime versions.",
  },
  {
    label: "revert",
    description: "Revert to a previous commit or behavior.",
  },
  {
    label: "docs",
    description: "Edit or add project documentation.",
  },
  {
    label: "style",
    description: "Make formatting or stylistic changes only.",
  },
  {
    label: "perf",
    description: "Optimize performance or resource usage.",
  },
  {
    label: "test",
    description: "Add or update tests and supporting fixtures.",
  },
  {
    label: "chore",
    description: "Miscellaneous tasks, tooling, or generated updates.",
  },
];

export const BRANCH_PREFIXES: BranchPrefix[] = RAW_PREFIXES.flatMap(
  ({ label, description }) =>
    label.split("/").map((value) => ({
      value,
      description,
    })),
);
