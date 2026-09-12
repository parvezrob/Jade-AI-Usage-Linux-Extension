#!/usr/bin/env bash
set -euo pipefail
gnome-extensions disable osaka-ai-usage@local || true
systemctl --user disable --now osaka-ai-usage.timer || true
systemctl --user stop osaka-ai-usage.service || true
archive="$HOME/.local/state/osaka-jade-backups/ai-usage-uninstalled-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$archive"
for target in "$HOME/.local/share/gnome-shell/extensions/osaka-ai-usage@local" "$HOME/.local/lib/osaka-ai-usage" "$HOME/.config/systemd/user/osaka-ai-usage.service" "$HOME/.config/systemd/user/osaka-ai-usage.timer" "$HOME/.config/systemd/user/osaka-ai-usage.timer.d"; do
 if [[ -e "$target" ]]; then mv "$target" "$archive/$(basename "$target")"; fi
done
systemctl --user daemon-reload
printf 'Uninstalled; files retained at %s. Usage cache remains local.\n' "$archive"
