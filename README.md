# Jade AI Usage · Linux Extension

A GNOME Shell extension that brings Omarchy's agent-usage panel to GNOME: Claude and Codex subscription limits as percent **used**, reset countdowns, the plan you are on, seven days of token history, and your token mix by model. It uses the Osaka Jade palette.

**Status: early release for GNOME 50.** Not yet reviewed or listed on extensions.gnome.org.

![Jade AI Usage on GNOME: Claude limits, tokens by day and by model](docs/screenshot.png)

## Install

Requires GNOME 50, Python 3, systemd user services, and Codex CLI and/or Claude Code signed in with a subscription. No pip packages are needed.

```bash
git clone https://github.com/parvezrob/Jade-AI-Usage-Linux-Extension.git
cd Jade-AI-Usage-Linux-Extension
bash scripts/install.sh
```

Run as your desktop user, without sudo. After installing or updating, **log out and back in** so GNOME Shell loads the new JavaScript. The collector and timer update right away. Existing installations are backed up to `~/.local/state/osaka-jade-backups/`.

## What it shows

- **Top bar:** each provider's fullest limit (the one that will stop your next prompt), e.g. `Claude 5h 3% · Codex 7d 100%`. At 90% or more, the number turns red. `*` means the data is stale or the last probe failed. Turn off **Show percentages** in Settings to show just a logo, which turns red when any limit reaches 90%.
- **Menu:**
  - **Header:** the provider logo and name, your plan (`Max 5x`, `Pro`), and how old the numbers are. When sign-in fails, a status card explains how to fix it.
  - **Claude / Codex tabs:** switch with a click, or press `h`/`l`.
  - **Limits:** Session, Weekly and per-model windows (such as Fable Weekly), each with percent used, a meter and a reset countdown. Codex also shows any free full resets your account holds; the extension only displays these and never redeems one.
  - **Tokens by day:** the last seven days, with today in bold and today's prompt and session counts underneath.
  - **Tokens by model:** your top four models, each with a bar showing its share. Hover over a row for its input, output and cache split.
  - **Buttons:** Refresh (or press `r`) and Settings.

## How it refreshes

- A systemd user timer runs the collector every 10 minutes by default. You can set 1–60 minutes in Settings and click **Apply**; the change is saved as a timer override in `~/.config/systemd/user/osaka-ai-usage.timer.d/refresh-interval.conf`.
- **Opening the menu** fetches current limits and reuses recent local token scans. This happens at most once every 30 seconds.
- **Refresh** rescans everything. The button reads *Refreshing…* until the collector finishes, and the menu stays open.
- The extension watches the record files, so new numbers appear as soon as they are written, including while the menu is open.

## Data and privacy

The collectors are Omarchy's (`collector/claude.py`, `collector/codex.py`, MIT, vendored with attribution). `collector/update.py` runs them and writes one record per provider to `~/.cache/osaka-ai-usage/records/<id>.json`.

- **Claude limits** come from Anthropic's OAuth usage endpoint, using the token that Claude Code stores in `~/.claude/.credentials.json`. This endpoint is unofficial and can change. The collector never refreshes the token itself: if the menu says *Sign-in expired*, start Claude Code once. Token history comes from your local Claude Code transcripts.
- **Codex limits and plan** come from `codex app-server` (`account/rateLimits/read`), started read-only, and no model turns are run. Token history comes from local Codex session files.
- Records contain quota numbers, token counts, model names and plan labels. They never contain credentials, prompts or conversation text. If a Codex probe fails, the last limits stay on screen, marked stale, until their window resets.

## Verify / troubleshoot

```bash
python3 -m unittest discover -s tests
python3 ~/.local/lib/osaka-ai-usage/update.py --force && ls ~/.cache/osaka-ai-usage/records
systemctl --user status osaka-ai-usage.timer
journalctl --user -u osaka-ai-usage.service -n 15
gnome-extensions info osaka-ai-usage@local
```

## Uninstall

```bash
bash scripts/uninstall.sh
```

This moves the installed files into a backup and stops collection. Your CLI logins and the local usage cache are left alone.

## Package the extension

A Shell extension ZIP alone cannot collect usage: install the collector and user timer with the installer above.

```bash
mkdir -p dist
gnome-extensions pack extension --force --out-dir=dist --extra-source=icons
```

## Contributing

Bug reports and pull requests are welcome. Include your GNOME version, distribution and installation method, and remove account details and secrets from any logs you share. Before submitting:

```bash
python3 -m unittest discover -s tests
glib-compile-schemas --strict --dry-run extension/schemas
```

Keep network and CLI work outside GNOME Shell (the extension only starts `update.py` and reads its records). Don't resize widgets from allocation callbacks, and keep keyboard navigation working. Future GNOME versions need real testing before they are added to `shell-version`.

## License

GPL-3.0-or-later; see [LICENSE](LICENSE). The Omarchy collectors are MIT and the provider icons are CC0 ([Simple Icons v15.0.0](https://github.com/simple-icons/simple-icons/tree/15.0.0)); see [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md). This is an independent community project, not affiliated with Anthropic, OpenAI, GNOME or Omarchy. Brand marks belong to their respective owners.
