export async function ensureGitRepository(): Promise<void> {
  const result = await runGit(["rev-parse", "--is-inside-work-tree"]);
  if (!result.success || result.stdout.trim() !== "true") {
    throw new Error("The current directory is not a git repository.");
  }
}

export async function gitBranchExists(branchName: string): Promise<boolean> {
  const result = await runGit(["rev-parse", "--verify", branchName]);
  return result.success;
}

export async function runGit(args: string[]): Promise<{
  success: boolean;
  stdout: string;
  stderr: string;
}> {
  try {
    const command = new Deno.Command("git", {
      args,
      stdout: "piped",
      stderr: "piped",
    });
    const { code, stdout, stderr } = await command.output();
    const decoder = new TextDecoder();
    return {
      success: code === 0,
      stdout: decoder.decode(stdout).trim(),
      stderr: decoder.decode(stderr).trim(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      stdout: "",
      stderr: message,
    };
  }
}
