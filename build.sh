#!/usr/bin/env bash
# ============================================================================
#  build.sh — construit l'image OCI du service de référence avec Buildah.
#  Usage :  ./build.sh                 (service par défaut : API Gateway)
#           ./build.sh <module> <port> (généralisation à un autre module)
#  Exemple : ./build.sh Banque-ClientService 10011
# ============================================================================
set -euo pipefail

# Paramètres (valeurs par défaut = service de référence API Gateway)
MODULE="${1:-Banque-APIGateway}"
PORT="${2:-10000}"
# Nom d'image dérivé du module, en minuscules (ex. banquemssol-banque-apigateway)
IMAGE="banquemssol-$(echo "$MODULE" | tr '[:upper:]' '[:lower:]'):local"

echo ">> Module      : $MODULE"
echo ">> Port appli  : $PORT"
echo ">> Image cible : $IMAGE"

# Vérifie que le JAR est bien présent (sinon : lancer 'mvn package' avant).
if ! ls "$MODULE"/target/*.jar >/dev/null 2>&1; then
  echo "!! Aucun JAR dans $MODULE/target/ — lance d'abord : mvn -pl $MODULE -am package" >&2
  exit 1
fi

# Build via le Containerfile multi-stage (approche 1).
buildah bud -t "$IMAGE" \
  --build-arg APP_PORT="$PORT" \
  -f Containerfile.api_gateway "$MODULE"

echo ">> OK. Image construite :"
buildah images --format "   {{.Name}}:{{.Tag}}  {{.Size}}" | grep "${IMAGE%:*}"
