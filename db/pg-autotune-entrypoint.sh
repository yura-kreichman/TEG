#!/bin/sh
# Автотюнинг postgres.conf при каждом старте контейнера (обсуждение с
# пользователем 2026-07-24: сервер сейчас маленький и общий с другими
# сайтами, при апгрейде параметры нужно пересчитывать заново вручную).
# Вместо статичного postgresql.conf считаем ключевые параметры по формулам
# PGTune из ДВУХ input-переменных (PG_TUNE_TOTAL_MB, PG_TUNE_CPUS) и
# передаём их postgres как -c флаги — они не трогают файл в volume, поэтому
# пересчитываются заново на каждом старте, а не только при первой
# инициализации (docker-entrypoint-initdb.d/* так не может — выполняется
# один раз на пустом data dir).
#
# PG_TUNE_TOTAL_MB — НЕ вся RAM хоста, а честная доля, которую отдаём
# Postgres на ЭТОЙ конкретной машине (сейчас сервер общий с почтой/apache/
# php-fpm — им тоже нужна память). При переезде на отдельный/больший сервер
# поднять эту одну цифру в .env — остальное пересчитается само.
set -e

TOTAL_MB="${PG_TUNE_TOTAL_MB:-512}"
CPUS="${PG_TUNE_CPUS:-1}"
MAX_CONNECTIONS="${PG_TUNE_MAX_CONNECTIONS:-50}"

# Целочисленная арифметика POSIX sh ($(( )) не умеет в дроби) — доли считаем
# через awk, округляя вниз, с нижним потолком по каждому параметру, чтобы
# крошечный PG_TUNE_TOTAL_MB (например, при опечатке в .env) не увёл
# Postgres в конфигурацию, которая не стартует.
SHARED_BUFFERS=$(awk -v t="$TOTAL_MB" 'BEGIN { v=int(t*0.25); print (v<32?32:v) }')
EFFECTIVE_CACHE=$(awk -v t="$TOTAL_MB" 'BEGIN { v=int(t*0.70); print (v<64?64:v) }')
MAINT_WORK_MEM=$(awk -v t="$TOTAL_MB" 'BEGIN { v=int(t*0.05); print (v<32?32:(v>1024?1024:v)) }')
WORK_MEM=$(awk -v t="$TOTAL_MB" -v c="$MAX_CONNECTIONS" 'BEGIN { v=int((t*0.25)/c); print (v<2?2:v) }')
WAL_BUFFERS=$(awk -v s="$SHARED_BUFFERS" 'BEGIN { v=int(s/32); print (v<4?4:(v>16?16:v)) }')
MAX_PARALLEL=$(awk -v c="$CPUS" 'BEGIN { v=int(c/2); print (v<1?1:v) }')

echo "[pg-autotune] TOTAL_MB=$TOTAL_MB CPUS=$CPUS MAX_CONNECTIONS=$MAX_CONNECTIONS"
echo "[pg-autotune] shared_buffers=${SHARED_BUFFERS}MB effective_cache_size=${EFFECTIVE_CACHE}MB work_mem=${WORK_MEM}MB maintenance_work_mem=${MAINT_WORK_MEM}MB wal_buffers=${WAL_BUFFERS}MB max_parallel_workers_per_gather=${MAX_PARALLEL}"

exec docker-entrypoint.sh postgres \
  -c "shared_buffers=${SHARED_BUFFERS}MB" \
  -c "effective_cache_size=${EFFECTIVE_CACHE}MB" \
  -c "work_mem=${WORK_MEM}MB" \
  -c "maintenance_work_mem=${MAINT_WORK_MEM}MB" \
  -c "wal_buffers=${WAL_BUFFERS}MB" \
  -c "max_connections=${MAX_CONNECTIONS}" \
  -c "max_worker_processes=${CPUS}" \
  -c "max_parallel_workers=${CPUS}" \
  -c "max_parallel_workers_per_gather=${MAX_PARALLEL}" \
  -c "random_page_cost=1.1" \
  -c "effective_io_concurrency=200"
