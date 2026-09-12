#!/usr/bin/env bash
set -euo pipefail
[[ $(id -u) != 0 ]] || { echo 'Run without sudo'; exit 1; }
[[ $(gnome-shell --version) == 'GNOME Shell 50.'* ]] || { echo 'This extension is tested for GNOME 50 only'; exit 1; }
source_dir=$(cd -- "$(dirname -- "$0")/.." && pwd)
extension_dir="$HOME/.local/share/gnome-shell/extensions/osaka-ai-usage@local"
backup_dir="$HOME/.local/state/osaka-jade-backups/ai-usage-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir" "$extension_dir" "$HOME/.local/lib/osaka-ai-usage" "$HOME/.config/systemd/user"
for target in "$extension_dir" "$HOME/.local/lib/osaka-ai-usage/collector.py" "$HOME/.config/systemd/user/osaka-ai-usage.service" "$HOME/.config/systemd/user/osaka-ai-usage.timer"; do
 if [[ -e "$target" ]]; then cp -a "$target" "$backup_dir/$(basename "$target")"; fi
done
cp -a "$source_dir/extension/." "$extension_dir/"
glib-compile-schemas --strict "$extension_dir/schemas"
cp "$source_dir/scripts/collector.py" "$HOME/.local/lib/osaka-ai-usage/collector.py"
cp "$source_dir/systemd/"* "$HOME/.config/systemd/user/"
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
