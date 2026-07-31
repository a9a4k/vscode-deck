---
name: release
description: Cut a new release of the vscode-deck extension — bump version, commit with the standard `chore(release):` format, tag, and build the vsix. Use when the user says "release", "cut a release", "ship X.Y.Z", "publish a new version", or similar. Does NOT push to git remote or the VS Code Marketplace unless the user explicitly asks.
---

# Release

Cut a new release of the vscode-deck extension.

Preconditions to check first (fail loudly if any miss):
- Working tree is clean (`git status --short` prints nothing).
- On `main` branch.
- `npm test` passes.

## Steps

1. **Read current version and pick target.**
   Read `package.json` for the current version. Ask the user for the explicit target `X.Y.Z` (this skill does not compute bumps — you pick the exact version). Show recent releases for context:
   ```sh
   git log --oneline --grep='chore(release)' -5
   ```

2. **Ask for the summary line.**
   The commit title format is:
   ```
   chore(release): X.Y.Z — <summary>
   ```
   Summary is one line, often ends with issue refs like `(#151, #152, #153)`. Look at recent releases for tone. If the release has more nuance than one line can hold, ask if they want a longer commit body — otherwise the message is just the title + `Co-Authored-By` trailer.

3. **Bump.**
   ```sh
   npm version <target> --no-git-tag-version
   ```
   Updates `package.json` and `package-lock.json` version fields. Does not create a tag (we make one manually in step 5 so the commit format stays clean).

   Note: `npm version` may strip linux-only optional peer entries from `package-lock.json` on darwin. That's the accepted status quo — sandcastle's next merger detects the drift and auto-commits `fix: synchronize npm lockfile`. Don't try to regen the lockfile here (a fresh `rm -rf node_modules && npm install` can pull newer transitive deps, drifting the release from what was tested).

4. **Commit.** Use a HEREDOC to preserve formatting:
   ```sh
   git add package.json package-lock.json
   git commit -m "$(cat <<'EOF'
   chore(release): X.Y.Z — <summary>

   Co-Authored-By: <your model attribution> <noreply@anthropic.com>
   EOF
   )"
   ```
   Attribution: use the current session's model name (e.g. `Claude Opus 4.7`, `Claude Fable 5`). Do not hardcode.

5. **Tag.**
   ```sh
   git tag vX.Y.Z
   ```
   Lightweight tag (matches existing tag style).

6. **Build vsix.**
   ```sh
   npx @vscode/vsce package
   ```
   Produces `deck-X.Y.Z.vsix` at repo root. If prompted about README/LICENSE, follow-through interactively.

7. **Report.** Print:
   - The commit hash + title
   - The tag name
   - The absolute path to the `.vsix`
   - A reminder that pushing (`git push && git push --tags`) and publishing (`npx @vscode/vsce publish`) are separate steps not run by this skill.

## Do not

- `git push` unless the user asks.
- `npx @vscode/vsce publish` unless the user asks.
- Regenerate the lockfile from scratch. If drift matters this release, ask the user first.
- Amend a previous release commit.
