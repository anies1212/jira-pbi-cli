import { Command } from "https://deno.land/x/cliffy@v1.0.0-rc.4/command/mod.ts";
import { runSetupCommand } from "./commands/setup.ts";
import { runBrowseCommand } from "./commands/browse.ts";
import { runSettingsCommand } from "./commands/settings.ts";

if (import.meta.main) {
  const program = new Command()
    .name("jira-pbi-cli")
    .description("Browse Jira issues and create Git branches from the terminal");

  program.command("setup").description("Run the initial Jira CLI setup wizard")
    .action(() => runSetupCommand());

  program.command("browse")
    .description("Browse issues and create prefixed Git branches")
    .option("--jql <jql:string>", "Override the configured JQL for this run")
    .action((options) => runBrowseCommand(options));

  program.command("settings")
    .description("Change default ordering presets or JQL")
    .action(() => runSettingsCommand());

  program.reset().default("browse");
  await program.parse(Deno.args);
}
