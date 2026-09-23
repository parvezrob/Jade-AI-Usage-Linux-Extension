#!/usr/bin/env bash
set -euo pipefail
[[ $(id -u) != 0 ]] || { echo 'Run without sudo'; exit 1; }
[[ $(gnome-shell --version) == 'GNOME Shell 50.'* ]] || { echo 'This extension is tested for GNOME 50 only'; exit 1; }
source_dir=$(cd -- "$(dirname -- "$0")/.." && pwd)
extension_dir="$HOME/.local/share/gnome-shell/extensions/osaka-ai-usage@local"
lib_dir="$HOME/.local/lib/osaka-ai-usage"
backup_dir="$HOME/.local/state/osaka-jade-backups/ai-usage-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir" "$HOME/.config/systemd/user"
for target in "$extension_dir" "$lib_dir" "$HOME/.config/systemd/user/osaka-ai-usage.service" "$HOME/.config/systemd/user/osaka-ai-usage.timer"; do
 if [[ -e "$target" ]]; then cp -a "$target" "$backup_dir/$(basename "$target")"; fi
done
# Replace rather than merge, so files dropped from the project do not linger.
rm -rf "$extension_dir" "$lib_dir"
mkdir -p "$extension_dir" "$lib_dir"
cp -a "$source_dir/extension/." "$extension_dir/"
glib-compile-schemas --strict "$extension_dir/schemas"
install -m 0755 "$source_dir"/collector/{update,claude,codex}.py "$lib_dir/"
cp "$source_dir/systemd/"* "$HOME/.config/systemd/user/"
# The single-file cache of versions before 4; records/ replaces it.
rm -f "${XDG_CACHE_HOME:-$HOME/.cache}/osaka-ai-usage/usage.json" "${XDG_CACHE_HOME:-$HOME/.cache}/osaka-ai-usage/collector.lock"
systemctl --user daemon-reload
systemctl --user enable --now osaka-ai-usage.timer
systemctl --user start --no-block osaka-ai-usage.service
if ! gnome-extensions enable osaka-ai-usage@local; then
 python3 - <<'PY'
from gi.repository import Gio
s=Gio.Settings.new('org.gnome.shell');v=s.get_strv('enabled-extensions')
if 'osaka-ai-usage@local' not in v:s.set_strv('enabled-extensions',v+['osaka-ai-usage@local']);Gio.Settings.sync()
PY
 echo 'Extension will load after your next logout/login.'
fi
printf 'Backup: %s\n' "$backup_dir"
