#!/usr/bin/env bash
# Screenshots for checking the figures by eye. Run after: node scripts/figures/dot4-machine/build.mjs --debug
#   scripts/figures/dot4-machine/shots.sh angles   each figure from seven angles, closed and see-through
#   scripts/figures/dot4-machine/shots.sh page     the finished page at desktop and 375 px, several states
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
out="$root/build/figures/dot4-machine"
shot() { # url file width height
  local dir; dir="$(mktemp -d)"
  chromium --headless=new --hide-scrollbars --user-data-dir="$dir" --force-device-scale-factor=1.5 \
    --window-size="$3,$4" --virtual-time-budget="${BUDGET:-4000}" --screenshot="$2" "$1" >/dev/null 2>&1 || true
  rm -rf "$dir"
}
errors() { # url
  local dir; dir="$(mktemp -d)"
  chromium --headless=new --user-data-dir="$dir" --virtual-time-budget=3000 --dump-dom "$1" 2>/dev/null \
    | grep -o 'data-errors="[^"]*"\|[^A-Za-z0-9+/]NaN[^A-Za-z0-9+/]' | sort -u || true
  rm -rf "$dir"
}
case "${1:-page}" in
  angles)
    mkdir -p "$out/angles"
    for fig in dot4 board; do
      url="file://$out/debug/$fig.html?free=1"
      echo "$fig errors: $(errors "$url&xr=1&labels=1")"
      for v in "yaw=45" "yaw=110" "yaw=170" "yaw=230" "yaw=300" "yaw=20&pitch=62" "yaw=200&pitch=70"; do
        n="${v//[&=]/_}"
        shot "$url&$v" "$out/angles/$fig-$n.png" 900 760
        shot "$url&$v&xr=1&labels=1" "$out/angles/$fig-$n-xr.png" 900 760
      done
    done ;;
  page)
    page="file://$root/output/figures/dot4-machine/index.html"
    shot "$page" "$out/desktop.png" 1280 4200
    shot "$page#a=127,127,127,127&b=127,127,127,127&xr=1&labels=1&t=3&bxr=1&blabels=1" "$out/desktop-seethrough.png" 1280 4200
    shot "$page#a=-128,-128,-128,-128&b=-128,-128,-128,-128&t=0.3&fault=0" "$out/desktop-extreme-fail.png" 1280 4200
    shot "$page#a=-128,-128,-128,-128&b=127,127,127,127&run=0.3&t=3" "$out/desktop-running.png" 1280 4200
    shot "$page" "$out/mobile-375.png" 375 5200
    shot "$page#a=5,-6,7,-8&b=-100,90,-80,70&xr=1&labels=1&t=3&bxr=1&blabels=1" "$out/mobile-375-seethrough.png" 375 5200
    echo "page errors: $(errors "$page")" ;;
esac
