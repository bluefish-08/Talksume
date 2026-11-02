#!/usr/bin/env bash
# 用法：./build.sh [源 md]，产物在 dist/ 下（自包含 HTML + A4 PDF）
set -euo pipefail
cd "$(dirname "$0")"

SRC="${1:-初赛设计文档.md}"
NAME="$(basename "$SRC" .md)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
mkdir -p dist

[ -f assets/mermaid.min.js ] || curl -fsSL https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js -o assets/mermaid.min.js

pandoc "$SRC" \
  --standalone --embed-resources \
  --template assets/template.html \
  --css assets/handbook.css \
  --toc --toc-depth=2 \
  -o "dist/$NAME.html"

# mermaid 在页面里异步渲染，留足虚拟时间再打印
"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer \
  --virtual-time-budget=20000 \
  --print-to-pdf="dist/$NAME.pdf" "file://$PWD/dist/$NAME.html" >/dev/null 2>&1

PAGES=$(python3 -c "import re,sys;print(len(re.findall(rb'/Type\s*/Page[^s]',open(sys.argv[1],'rb').read())))" "dist/$NAME.pdf")
echo "dist/$NAME.html"
echo "dist/$NAME.pdf ($PAGES 页)"
