#!/bin/sh
# 發布新版前執行：把所有檔案的版本號換成新的，手機上的網頁才會自動更新
# 用法：./bump-version.sh 8
set -e
cd "$(dirname "$0")"
old=$(sed -n 's/.*"version": "\([0-9]*\)".*/\1/p' version.json)
new="$1"
[ -n "$new" ] || { echo "用法：$0 新版本號（目前是 $old）"; exit 1; }
sed -i '' -e "s/?v=$old/?v=$new/g" -e "s/var APP_VERSION = '$old';/var APP_VERSION = '$new';/" index.html sync.js
echo "{ \"version\": \"$new\" }" > version.json
echo "版本 $old → $new"
