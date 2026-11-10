# Specstride

Specstride carries a Spec Kit feature to done, phase by phase. Claude implements a phase, Specstride runs
your tests itself, and a separate Claude session with no tools judges the change against the tasks. Only an
approved phase is ticked and committed. A rejected one goes back with the critic's reasons.

Ask Claude to use the `specstride-run` skill in a repository with `specs/<feature>/tasks.md`. Use
`specstride-doctor` to check your setup. It needs Node 22 or later, git and Claude Code, and it uses your own
Claude subscription or API key.

Install the CLI (the plugin's skills run it from your PATH):

```text
npm install -g specstride@0.1.0
```

Then install the plugin, in Claude Code:

```text
/plugin marketplace add mairp/specstride-plugin
/plugin install specstride@specstride-marketplace
```
