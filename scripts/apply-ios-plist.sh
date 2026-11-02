#!/usr/bin/env bash
# ============================================================================
# apply-ios-plist.sh — CI 在 cap add ios 之后、cap sync 之前执行，
# 给生成的 Info.plist 打上壳需要的条目（仓库不提交 ios/ 树，全部现场生成）：
#   - ATS 放行任意加载（这类站的片源大量是 http，不放行直接黑屏）
#   - 方向：竖屏 + 左右横屏（看片要能横过来）
# 仅 macOS（用系统自带 PlistBuddy）。
# ============================================================================
set -euo pipefail

PLIST="ios/App/App/Info.plist"
PB=/usr/libexec/PlistBuddy

if [ ! -f "${PLIST}" ]; then
  echo "missing ${PLIST} - run npx cap add ios first" >&2
  exit 1
fi

"${PB}" -c "Delete :NSAppTransportSecurity" "${PLIST}" 2>/dev/null || true
"${PB}" -c "Add :NSAppTransportSecurity dict" "${PLIST}"
"${PB}" -c "Add :NSAppTransportSecurity:NSAllowsArbitraryLoads bool true" "${PLIST}"

for key in "UISupportedInterfaceOrientations~iphone" "UISupportedInterfaceOrientations~ipad"; do
  "${PB}" -c "Delete :${key}" "${PLIST}" 2>/dev/null || true
  "${PB}" -c "Add :${key} array" "${PLIST}"
  "${PB}" -c "Add :${key}:0 string UIInterfaceOrientationPortrait" "${PLIST}"
  "${PB}" -c "Add :${key}:1 string UIInterfaceOrientationLandscapeLeft" "${PLIST}"
  "${PB}" -c "Add :${key}:2 string UIInterfaceOrientationLandscapeRight" "${PLIST}"
done

echo "plist applied:"
"${PB}" -c "Print :NSAppTransportSecurity" "${PLIST}"
