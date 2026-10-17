#!/usr/bin/env bash
# Despliega PokeMart en Monad testnet con el keystore de monskills y activa el contrato en la función `game`.
# Antes: la wallet de despliegue necesita MON de prueba (https://faucet.monad.xyz).
set -euo pipefail
cd "$(dirname "$0")/.."
KS="${KEYSTORE:-$(ls ~/.monskills/keystore/* | head -1)}"
WHO="$(cast wallet address --keystore "$KS" --password "")"
TREASURY="${TREASURY:-0x80d80c6C22568Fd0C03477520cFDDBD23F343f79}"
echo "Despliega: $WHO · tesorería: $TREASURY"
cast balance "$WHO" --rpc-url https://testnet-rpc.monad.xyz --ether
OUT="$(forge create contracts/PokeMart.sol:PokeMart --rpc-url https://testnet-rpc.monad.xyz \
  --keystore "$KS" --password "" --broadcast --constructor-args "$TREASURY")"
echo "$OUT"
ADDR="$(echo "$OUT" | awk '/Deployed to:/ {print $3}')"
[ -n "$ADDR" ] || { echo "No se pudo leer la dirección"; exit 1; }
(cd .. && supabase secrets set MON_MART_CONTRACT="$ADDR" MON_TREASURY="$TREASURY")
echo "Contrato activo: $ADDR"
