# jira-pbi-cli

A Deno-based CLI for browsing Jira Cloud issues (PBIs) and creating Git branches from the terminal. The tool uses Atlassian's OAuth 2.0 (3LO) flow so contributors can log in via their default browser, pick an accessible Jira site, and immediately branch off with names such as `feat/ABC-123`.

## Features
- Authenticate through the browser with OAuth 2.0 (3LO) and reuse the stored refresh token automatically.
- Search issues by any JQL (default `ORDER BY updated DESC`) with incremental filtering, arrow-key navigation, and drill-down into child issues (`parent =`, `"Epic Link" =`, `"Parent Link" =`).
- Display whether an issue likely has children, and jump into nested lists with Enter.
- Create Git branches following the `prefix/{ISSUE_KEY}` pattern. All prefixes from [this Qiita article](https://qiita.com/muranakar/items/20a7927ffa63a5ca226a) are embedded and searchable, and you can enter a custom prefix at runtime.
- Detect existing branches and offer to switch rather than recreate them.

## Prerequisites
1. **Deno 1.42+** – Install via `brew install deno` or follow the [official guide](https://deno.com/manual/getting_started/installation).
2. **Atlassian OAuth 2.0 (3LO) app** – Create one in the [Atlassian Developer Console](https://developer.atlassian.com/console/myapps/):
   - Choose **OAuth 2.0 (3LO)**.
   - Add `http://127.0.0.1:8765/callback` to the Redirect URLs.
   - Under **General scopes** add `offline_access` and `read:me` (User identity API). The CLI needs `read:me` to call `/oauth/token/accessible-resources` and list your Jira sites.
   - Under **Jira API -> Granular scopes** enable at least:
     - `read:issue:jira` (issue search, fields, subtasks)
     - `read:project:jira` (project metadata referenced by issues)
     - `read:field:jira` (required for `/rest/api/3/field`)
     - `read:user:jira` (needed for `/rest/api/3/myself`)
   - Under **Jira API -> Classic scopes** enable both:
     - `read:jira-work` – legacy equivalent of issue/project read access
     - `read:jira-user` – Jira still requires this for `/rest/api/3/myself`
   - Copy the generated **Client ID** and **Client Secret**; the CLI requests them during setup.

> The Client ID and Client Secret identify your OAuth app. They replace the old API-token approach and allow the CLI to open a browser window where you sign in and approve access.

## Installation
```bash
deno install --global \
  --allow-net \
  --allow-read \
  --allow-write \
  --allow-env \
  --allow-run \
  --name jira-pbi-cli \
  https://raw.githubusercontent.com/anies1212/jira-pbi-cli/main/src/main.ts
```
After installation, ensure `$HOME/.deno/bin` is on your PATH, then run `jira-pbi-cli setup` / `jira-pbi-cli` anywhere. Uninstall with `deno uninstall --global jira-pbi-cli`.

> Prefer not to install globally or need to inspect the source? Clone the repo instead:
> ```bash
> git clone https://github.com/anies1212/jira-pbi-cli.git
> cd jira-pbi-cli
> deno task jira:setup
> ```

## Usage

### 1. Run the setup wizard
```bash
deno task jira:setup
```
The wizard asks for:
- Atlassian OAuth Client ID / Client Secret.
- Automatic browser login + consent to select the Jira sites accessible to the logged-in user.
- The default JQL (press Enter to keep `ORDER BY updated DESC`).

> **Note:** After the browser shows "Connection refused" at `127.0.0.1:8765/callback`, that simply means the CLI finished authentication and shut down the temporary callback server. As long as the terminal displays “Successfully authenticated…”, setup is complete.

All data (client credentials, selected site, tokens, last-used prefix, default JQL) is stored as plain JSON at `~/.jira-pbi-cli/config.json`. Protect this file appropriately.

### 2. Browse issues and create branches
```bash
deno task jira
```
- Navigate with arrow keys, type to search, and press Enter to inspect an issue.
- If children exist, choose “View child issues” to drill down.
- Select “Create branch” to open the prefix picker and run `git checkout -b {prefix}/{ISSUE_KEY}` (or switch to it if it already exists).
- The CLI automatically prepends a fallback clause (`issueType IS NOT EMPTY`) if your stored JQL only contains an `ORDER BY ...` statement, because `/rest/api/3/search/jql` rejects queries without a filter.
- By default the list prioritizes issues assigned to you *and* still in progress. Use the `settings` command below to switch between the presets without entering raw JQL. If that preset returns no issues, the CLI automatically falls back to broader presets (any assignee -> all issues) so you always see the available work.

### 3. Change the default ordering or JQL
```bash
deno run --allow-net --allow-read --allow-write --allow-env --allow-run src/main.ts settings
```
- Choose between:
  - Assigned to me & not done (default)
  - Any assignee, not done only
  - All issues
- Optionally update the stored default JQL in the same wizard.

### 4. Global command (optional)
Install the CLI globally (Deno 2.x requires the `--global` flag) so you can run it from any repository:
```bash
deno install --global \
  --allow-net \
  --allow-read \
  --allow-write \
  --allow-env \
  --allow-run \
  --name jira-pbi-cli \
  src/main.ts
```
After installation, ensure `$HOME/.deno/bin` is on your PATH, then run `jira-pbi-cli setup` / `jira-pbi-cli` anywhere. Uninstall with `deno uninstall --global jira-pbi-cli`.

### Command options
```bash
deno run --allow-net --allow-read --allow-write --allow-env --allow-run \
  src/main.ts browse --jql "project = MYPROJ AND statusCategory != Done"
```
Use `--jql` to override the saved query for a single run.

## Development
- Format: `deno fmt`
- Lint: `deno lint`

Contributions via Issues or PRs are welcome!

## License

Released under the [MIT License](./LICENSE).
