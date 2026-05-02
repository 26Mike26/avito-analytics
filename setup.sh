#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# Avito Аналитика — локальная установка одной командой
#
# Запуск:
#   chmod +x setup.sh
#   ./setup.sh
# ──────────────────────────────────────────────────────────────────────

set -e

echo ""
echo "🟧  Avito Аналитика · установка"
echo "─────────────────────────────────"

# 1. Проверяем Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Не найден Node.js. Установите с https://nodejs.org/ (LTS) и запустите снова."
  exit 1
fi
NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "❌ Нужна версия Node.js 18+. У вас: $(node -v)"
  exit 1
fi
echo "✓ Node.js: $(node -v)"

# 2. .env
if [ ! -f .env ]; then
  echo ""
  echo "📝 Сейчас настроим переменные окружения для Supabase."
  echo "   (если хотите запустить локально без облака — нажмите Enter, оставьте пустым)"
  echo ""
  read -p "VITE_SUPABASE_URL (https://xxx.supabase.co): " SB_URL
  read -p "VITE_SUPABASE_ANON_KEY (eyJ... длинный ключ):  " SB_KEY

  cat > .env <<EOF
VITE_SUPABASE_URL=$SB_URL
VITE_SUPABASE_ANON_KEY=$SB_KEY
VITE_AVITO_PROXY_URL=
EOF
  echo "✓ .env создан"
else
  echo "✓ .env уже существует — не трогаю"
fi

# 3. npm install
echo ""
echo "📦 Ставлю зависимости..."
npm install --silent

echo ""
echo "✅ Готово!"
echo ""
echo "Дальше:"
echo "   • npm run dev          — запустить локально (http://localhost:5173)"
echo "   • npm run build        — собрать продакшен в dist/"
echo "   • SUPABASE_SETUP.md    — инструкция по облачному развёртыванию"
echo ""
