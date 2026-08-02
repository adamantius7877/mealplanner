#!/usr/bin/env sh
set -eu

APP_NAME="meals-and-grocery-dashboard"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required but was not found."
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  echo "Docker Compose is required but was not found."
  exit 1
fi

echo "Deploying ${APP_NAME}..."
echo "Using ${COMPOSE_FILE}"

${COMPOSE} -f "${COMPOSE_FILE}" up -d --build --remove-orphans

echo
echo "${APP_NAME} is running."
echo "Open http://localhost:3000 on this machine, or http://SERVER_IP:3000 from another device."
echo
echo "Your meal data is stored in the Docker volume named meals-data."
echo "Redeploying with this script rebuilds the app without deleting that volume."
