#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

target="${DEPLOY_TARGET:-tgbot}"
unit="${DEPLOY_SERVICE:-cosmoclerk.service}"
remote_binary="${DEPLOY_BINARY:-/usr/local/bin/cosmoclerk}"
remote_binary_dir="${remote_binary%/*}"
remote_workdir="${DEPLOY_WORKDIR:-/etc/cosmoclerk}"
remote_env="${DEPLOY_ENV_FILE:-$remote_workdir/.env}"
run_user="${DEPLOY_USER:-cosmoclerk}"
run_group="${DEPLOY_GROUP:-cosmoclerk}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

require_cmd lxc
require_cmd install

./scripts/build.sh

tmp_binary="/tmp/cosmoclerk.$$"
tmp_service="/tmp/${unit}.$$"

cleanup() {
  lxc exec "$target" -- rm -f "$tmp_binary" "$tmp_service" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> verifying target $target"
lxc exec "$target" -- true

echo "==> ensuring runtime user and directories"
lxc exec "$target" -- sh -c "getent group '$run_group' >/dev/null || groupadd --system '$run_group'"
lxc exec "$target" -- sh -c "id -u '$run_user' >/dev/null 2>&1 || useradd --system --gid '$run_group' --home-dir '$remote_workdir' --shell /usr/sbin/nologin '$run_user'"
lxc exec "$target" -- mkdir -p "$remote_binary_dir" "$remote_workdir"
lxc exec "$target" -- chown "$run_user:$run_group" "$remote_workdir"

echo "==> verifying runtime env file $remote_env"
if ! lxc exec "$target" -- test -f "$remote_env"; then
  echo "target is missing $remote_env; create it with BOT_TOKEN before deploying" >&2
  exit 1
fi

echo "==> pushing release binary and systemd unit"
lxc file push target/release/cosmoclerk "$target$tmp_binary"
lxc file push cosmoclerk.service "$target$tmp_service"

echo "==> installing binary to $remote_binary"
lxc exec "$target" -- install -o root -g root -m 0755 "$tmp_binary" "$remote_binary"

echo "==> installing systemd unit /etc/systemd/system/$unit"
lxc exec "$target" -- install -o root -g root -m 0644 "$tmp_service" "/etc/systemd/system/$unit"

echo "==> restarting $unit"
lxc exec "$target" -- systemctl daemon-reload
lxc exec "$target" -- systemctl enable "$unit"
lxc exec "$target" -- systemctl restart "$unit"
lxc exec "$target" -- systemctl is-active --quiet "$unit"

echo "==> recent service logs"
lxc exec "$target" -- journalctl -u "$unit" -n 30 --no-pager

echo "Deployment complete on $target"
