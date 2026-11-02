#!/usr/bin/env sh
# 清空演示环境里的用户数据（候选人、HR、投递、HR 发布与粘贴导入的岗位），保留抓取的种子岗位；先备份到 deploy/backups/
set -eu
cd "$(dirname "$0")"
compose="docker compose -f docker-compose.yml --env-file .env"
mkdir -p backups
backup="backups/$(date +%Y%m%d-%H%M%S).dump"
$compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup"
$compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' <<'SQL'
begin;
delete from users;
delete from jobs where source in ('hr_workspace', 'user_import');
commit;
SQL
# server 进程缓存了演示用户 id，删用户后必须重启
$compose restart server >/dev/null
echo "已重置，备份在 deploy/$backup"
