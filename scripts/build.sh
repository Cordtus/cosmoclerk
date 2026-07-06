#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

skip_checks=0
if [[ "${1:-}" == "--skip-checks" ]]; then
  skip_checks=1
elif [[ $# -gt 0 ]]; then
  echo "usage: $0 [--skip-checks]" >&2
  exit 2
fi

if [[ "$skip_checks" -eq 0 ]]; then
  ./scripts/check.sh
fi

echo "==> cargo build --release"
cargo build --release

binary="$repo_root/target/release/cosmoclerk"
if [[ ! -x "$binary" ]]; then
  echo "release binary was not created at $binary" >&2
  exit 1
fi

echo "Built $binary"
