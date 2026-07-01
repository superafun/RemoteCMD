---
name: skill-market
description: Search, install, list, and remove opencode skills. Use when the user says they want to find, install, or manage skills.
---

# Skill Market

Search, install, list, and remove opencode skills from any source.

## Search skills

1. **GitHub search**: Use `gh search repos "opencode skill" --limit 20` or search GitHub code for `SKILL.md` files with opencode frontmatter.
2. **Known registries**: Fetch `https://opencode.ai/docs/skills/` and any known skill gist/repo URLs provided by the user.
3. **webfetch**: For any URL the user provides, fetch the content to inspect if it's a valid opencode skill.
4. **Local scan**: Scan `.opencode/skills/*/SKILL.md` and `~/.config/opencode/skills/*/SKILL.md` for installed skills.

## Install a skill

1. Validate the source has valid frontmatter (`name`, `description` fields).
2. Validate `name` matches regex: `^[a-z0-9]+(-[a-z0-9]+)*$`.
3. Create directory `.opencode/skills/<name>/`.
4. Write `SKILL.md` with the full content.
5. Show the user a summary of what was installed.
6. Remind the user to **restart opencode** for the skill to take effect.

## List installed skills

Read all files matching `.opencode/skills/*/SKILL.md`, `~/.config/opencode/skills/*/SKILL.md`, `.claude/skills/*/SKILL.md`, and `~/.agents/skills/*/SKILL.md`. For each, parse the `name` and `description` from frontmatter and display as a table.

## Remove a skill

1. Ask which skill to remove (show list if needed).
2. Delete the entire skill directory: `Remove-Item -Recurse .opencode/skills/<name>/`.
3. Confirm removal.
4. Remind user to restart opencode.

## Skill validation checklist

Before installing, verify:
- [ ] Frontmatter has `name` (required)
- [ ] Frontmatter has `description` (required)
- [ ] `name` matches `^[a-z0-9]+(-[a-z0-9]+)*$`
- [ ] `name` matches the directory name
- [ ] Content is valid markdown