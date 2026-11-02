#!/usr/bin/env bash
# verify-anchor.sh — 第三方离线复核 csb-charter 的指纹锚
#
# 为什么需要这个脚本：anchors.json 是根信任，无法自锁（改受保护文件 + 重算锚 →
# 本仓自检仍全绿）。所以把它的哈希钉到本仓之外：四平台分发 tag + OpenTimestamps。
# 本脚本只做机械比对，不依赖任何一方的「我已核过」。
#
# 用法：
#   bash scripts/verify-anchor.sh                     # 本机复核
#   bash scripts/verify-anchor.sh --remote            # 顺带核对四平台 tag 是否分裂
#
# 退出码：0 全部相符 · 1 有不符 · 2 缺文件/依赖

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ANCHOR="specs/anchors.json"
PROOF="specs/anchors.json.ots"
REMOTE=0
[ "${1:-}" = "--remote" ] && REMOTE=1

fail=0
ok()   { printf '  ✅ %s\n' "$*"; }
bad()  { printf '  ❌ %s\n' "$*"; fail=1; }
skip() { printf '  ⏸️  %s\n' "$*"; }

[ -f "$ANCHOR" ] || { echo "缺 $ANCHOR"; exit 2; }

echo "① 文件哈希 vs tag 名"
ACTUAL="$(sha256sum "$ANCHOR" | cut -d' ' -f1)"
TAG="$(git tag -l 'anchor-*' | tail -1)"
echo "   file  = $ACTUAL"
if [ -z "$TAG" ]; then
  skip "本机无 anchor-* tag（浅克隆？先 git fetch --tags）"
else
  echo "   tag   = $TAG"
  # tag 名里带的是哈希前缀（16 位），按前缀比，不按全等
  TAGHASH="${TAG##*-}"
  case "$ACTUAL" in
    "$TAGHASH"*) ok "文件哈希以 tag 名前缀 ${TAGHASH} 开头" ;;
    *) bad "文件哈希 ${ACTUAL:0:16}… 不以 tag 名 ${TAGHASH} 开头 —— 锚文件被改过" ;;
  esac
  echo "   tag object = $(git rev-parse "$TAG" 2>/dev/null)"
  echo "   peeled     = $(git rev-parse "$TAG^{}" 2>/dev/null)"
fi

echo "② 锚的封缄元数据"
python3 - "$ANCHOR" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
print(f"   sealed_at = {d.get('sealed_at')}")
print(f"   sealed_by = {d.get('sealed_by')}")
print(f"   files={len(d.get('files', {}))} segments={len(d.get('segments', {}))}")
PY

echo "③ OpenTimestamps 证明"
if [ ! -f "$PROOF" ]; then
  skip "缺 $PROOF"
elif ! command -v ots >/dev/null 2>&1; then
  skip "本机无 ots（pip install --user opentimestamps-client）"
else
  echo "   proof sha256 = $(sha256sum "$PROOF" | cut -d' ' -f1)"
  HDR="$(ots info "$PROOF" 2>&1 | head -1)"
  echo "   $HDR"
  case "$HDR" in
    *"$ACTUAL"*) ok "OTS 证明覆盖的就是当前文件哈希" ;;
    *) bad "OTS 证明与当前文件哈希不符" ;;
  esac
  ots verify "$PROOF" 2>&1 | sed 's/^/   /'
  if ots verify "$PROOF" 2>&1 | grep -qi 'Bitcoin block'; then
    ok "已进 Bitcoin 区块（时间证明成立）"
  else
    skip "仍在 PendingAttestation（未确认前只证明「已提交」，不证明「何时上链」）"
  fi
fi

if [ "$REMOTE" = 1 ]; then
  echo "④ 四平台 tag 一致性（分裂即可疑）"
  if [ -z "${TAG:-}" ]; then
    skip "无 tag 可比"
  else
    for url in https://gitee.com/lilozhao/csb-charter.git \
               https://github.com/lilozhao/csb-charter.git \
               https://gitcode.com/lilozhao11/csb-charter.git \
               https://cnb.cool/ebatom/csb-charter.git; do
      OUT="$(timeout 25 git ls-remote --tags "$url" "refs/tags/$TAG" 2>/dev/null | awk '{print $1}' | head -1)"
      HOSTN="$(printf '%s' "$url" | sed -E 's#https://([^/]+)/.*#\1#')"
      if [ "$OUT" = "$(git rev-parse "$TAG" 2>/dev/null)" ]; then
        ok "$HOSTN tag 一致"
      else
        bad "$HOSTN tag 不一致或读不到（got '${OUT:-空}'）"
      fi
    done
  fi
fi

echo
if [ "$fail" = 0 ]; then echo "✅ 复核通过"; exit 0; else echo "❌ 复核不通过"; exit 1; fi
