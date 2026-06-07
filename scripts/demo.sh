#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "CAW x402 Agent Commerce"
echo
echo "1. Installing backend and agent dependencies"
cd "$ROOT_DIR"
npm run install:all

echo
echo "2. Running type checks and tests"
npm run check
npm run test

echo
echo "3. Starting backend provider"
echo "Run this in one terminal:"
echo "  npm run backend:provider"
echo
echo "Open the browser demo console:"
echo "  http://localhost:4021/demo"
echo
echo "Then run this in another terminal:"
echo "  npm run agents:precheck -- --address 0x0000000000000000000000000000000000000001 --api http://localhost:4021/risk-report --max-price-usdc 0.005"
