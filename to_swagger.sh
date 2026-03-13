#!/usr/bin/env bash
# Convert the latest mitmproxy capture to an OpenAPI/Swagger spec
# Usage: ./to_swagger.sh [flows_file] [api_base_url]
#   e.g: ./to_swagger.sh captures/20260313_104500.flows https://api.example.com
#
# If no flows file given, uses the most recent capture.
# If no base URL given, tries to auto-detect from traffic (prompts if ambiguous).

set -e

CAPTURES_DIR="$HOME/android-re/captures"
SWAGGER_DIR="$HOME/android-re/swagger"
mkdir -p "$SWAGGER_DIR"

FLOWS_FILE="${1:-$(ls -t "$CAPTURES_DIR"/*.flows 2>/dev/null | head -1)}"
if [ -z "$FLOWS_FILE" ]; then
  echo "Error: no .flows file found in $CAPTURES_DIR"
  echo "Usage: $0 [flows_file] [api_base_url]"
  exit 1
fi

BASE_URL="${2:-}"
SESSION="$(basename "${FLOWS_FILE%.flows}")"
OUT_FILE="$SWAGGER_DIR/${SESSION}_openapi.yaml"

echo "Flows file : $FLOWS_FILE"
echo "Output     : $OUT_FILE"
echo ""

# First pass — generate spec (without base URL to see what hosts appear)
if [ -z "$BASE_URL" ]; then
  echo "Running first pass to detect API hosts..."
  mitmproxy2swagger \
    -i "$FLOWS_FILE" \
    -o "$OUT_FILE" \
    -p "https://placeholder.invalid" \
    --format flow \
    --examples 2>&1 | grep -v "^$" || true

  echo ""
  echo "Hosts found in capture:"
  grep "servers:" -A3 "$OUT_FILE" 2>/dev/null || true
  grep "^  - url:" "$OUT_FILE" 2>/dev/null | sort -u || true
  echo ""
  read -r -p "Enter the API base URL to filter (e.g. https://api.target.com): " BASE_URL
fi

echo "Generating OpenAPI spec for: $BASE_URL"
mitmproxy2swagger \
  -i "$FLOWS_FILE" \
  -o "$OUT_FILE" \
  -p "$BASE_URL" \
  --format flow \
  --examples

echo ""
echo "Done → $OUT_FILE"
echo ""
echo "Next steps:"
echo "  View:     cat $OUT_FILE"
echo "  Validate: python3 -c \"import yaml; yaml.safe_load(open('$OUT_FILE'))\""
echo "  Swagger UI: docker run -p 8888:8080 -e SWAGGER_JSON=/spec.yaml \\"
echo "    -v ${OUT_FILE}:/spec.yaml swaggerapi/swagger-ui"
