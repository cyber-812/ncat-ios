#!/usr/bin/env bash
# ============================================================================
# build-ios-unsigned.sh — 编译未签名 IPA（仅 macOS / CI 可运行）
# 产物：<仓库根>/build/NCat-unsigned.ipa
# 前置：npx cap sync ios 已执行。
# 沿用 Folia 流水线验证过的打法：
#   - 全程绝对路径、变量一律 ${var}（防 UTF-8 字节被吞进变量名）
#   - Capacitor 8 是 SPM 模式，用 -project 不用 -workspace
#   - -scheme 才能配 -derivedDataPath；失败自动降级默认 DerivedData 再试
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PROJECT_DIR="${ROOT_DIR}/ios/App"
XCODEPROJ="${PROJECT_DIR}/App.xcodeproj"
OUT_DIR="${ROOT_DIR}/build"
APP_NAME="App"
IPA_NAME="NCat-unsigned.ipa"
BUILD_LOG="${OUT_DIR}/xcodebuild.log"

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "xcodebuild not found - macOS only" >&2
  exit 1
fi
if [ ! -f "${XCODEPROJ}/project.pbxproj" ]; then
  echo "missing ${XCODEPROJ} - run npx cap sync ios first" >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"

SIGN_FLAGS=(
  CODE_SIGNING_ALLOWED=NO
  CODE_SIGNING_REQUIRED=NO
  CODE_SIGN_IDENTITY=""
  CODE_SIGNING_ENTITLEMENTS=""
)
BASE_FLAGS=(
  -project "${XCODEPROJ}"
  -configuration Release
  -sdk iphoneos
  "${SIGN_FLAGS[@]}"
)

# xcodebuild 的成败必须看 PIPESTATUS[0]：管道退出码默认是最后一个命令（tee）的，
# 只靠 set -o pipefail 的隐式行为太脆，显式取状态（审查 Minor）。
run_build() {
  set +e
  xcodebuild "$@" 2>&1 | tee "${BUILD_LOG}"
  local status=${PIPESTATUS[0]}
  set -e
  return "${status}"
}

APP_PATH=""
if run_build "${BASE_FLAGS[@]}" -scheme "${APP_NAME}" \
    -derivedDataPath "${OUT_DIR}/derived" \
    -clonedSourcePackagesDirPath "${OUT_DIR}/spm" \
    build; then
  APP_PATH="${OUT_DIR}/derived/Build/Products/Release-iphoneos/${APP_NAME}.app"
else
  echo "scheme+derivedData failed, retry with default DerivedData"
  if run_build "${BASE_FLAGS[@]}" -scheme "${APP_NAME}" build; then
    APP_PATH="$(find "${HOME}/Library/Developer/Xcode/DerivedData" -maxdepth 6 -path "*${APP_NAME}-*/Build/Products/Release-iphoneos/${APP_NAME}.app" 2>/dev/null | head -1)"
  fi
fi

if [ -z "${APP_PATH}" ] || [ ! -d "${APP_PATH}" ]; then
  echo "BUILD FAILED - app bundle not found" >&2
  tail -40 "${BUILD_LOG}" >&2 || true
  exit 1
fi

echo "app bundle: ${APP_PATH}"
rm -rf "${OUT_DIR}/Payload" "${OUT_DIR}/${IPA_NAME}"
mkdir -p "${OUT_DIR}/Payload"
cp -a "${APP_PATH}" "${OUT_DIR}/Payload/"
( cd "${OUT_DIR}" && zip -qry "${IPA_NAME}" Payload )
rm -rf "${OUT_DIR}/Payload"
ls -la "${OUT_DIR}/${IPA_NAME}"
echo "IPA OK: ${OUT_DIR}/${IPA_NAME}"
