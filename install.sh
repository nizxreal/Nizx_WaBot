#!/data/data/com.termux/files/usr/bin/bash
# Pemasang satu perintah Nizx WaBot (khusus Termux).
set -e

REPO_URL="https://github.com/nizxreal/Nizx_WaBot.git"
DIR="$HOME/Nizx_WaBot"
SELF="$(realpath "$0" 2>/dev/null || true)"

case "$PREFIX" in
  *com.termux*) ;;
  *) echo "Skrip ini hanya untuk Termux di Android."; exit 1 ;;
esac

echo "[1/5] Memperbarui paket Termux..."
export DEBIAN_FRONTEND=noninteractive
pkg update -y
apt-get -y -o Dpkg::Options::="--force-confnew" upgrade

echo "[2/5] Memasang Node.js dan Git..."
pkg install -y nodejs-lts git

echo "[3/5] Mengunduh bot..."
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only || { echo "Update gagal. Jangan ubah file bot sendiri."; exit 1; }
else
  git clone "$REPO_URL" "$DIR"
fi

echo "[4/5] Memasang dependensi (beberapa menit)..."
cd "$DIR"
npm install --no-audit --no-fund

echo "[5/5] Membuat perintah nizxbot..."
cat > "$PREFIX/bin/nizxbot" <<'X'
#!/data/data/com.termux/files/usr/bin/bash
cd "$HOME/Nizx_WaBot" || exit 1
if [ "$1" = "update" ]; then
  git pull --ff-only && npm install --no-audit --no-fund
  exit $?
fi
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock
exec node index.js
X
chmod +x "$PREFIX/bin/nizxbot"

if [ -n "$SELF" ]; then rm -f "$SELF"; fi
echo "Selesai. Menjalankan bot..."
exec "$PREFIX/bin/nizxbot"
