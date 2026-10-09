#!/bin/bash
# 링크비트 · 서버 설치 (Ubuntu 22.04/24.04 · 달 없는 밤 서버와 함께 써도 됨)
# 사용법 (라이트세일 브라우저 SSH 창에 붙여넣기):
#   curl -fsSL https://raw.githubusercontent.com/gh920327-cmyk/linkbeat/main/deploy/setup.sh | sudo bash
# 다시 실행해도 안전합니다 (이미 깔린 건 건너뛰고, 곡·기록·호스트 키는 그대로).
set -e
REPO=https://github.com/gh920327-cmyk/linkbeat.git
APP=/opt/linkbeat
DATA=/var/lib/linkbeat
PORT=8800
ENVF=/etc/linkbeat.env
export DEBIAN_FRONTEND=noninteractive
say(){ echo -e "\n\033[1;36m▶ $*\033[0m"; }

APT="apt-get -o DPkg::Lock::Timeout=1200 -y"
# Caddy 공식 설치 저장소(cloudsmith)가 지금 막혀 있어서(402) apt 업데이트 전체가 실패함.
# Caddy는 이미 깔려 있으니 그 저장소만 꺼 둠 (Caddy 자체는 그대로 동작)
if command -v caddy >/dev/null; then
  for f in /etc/apt/sources.list.d/caddy-stable.list /etc/apt/sources.list.d/caddy-stable.sources; do
    [ -f "$f" ] && mv "$f" "$f.disabled" && echo "  disabled broken Caddy repo: $f"
  done
fi
say "1/7 Installing python, numpy, scipy (2~5 min) · 기본 도구 설치"
if python3 -c "import numpy, scipy" 2>/dev/null && command -v git >/dev/null && command -v curl >/dev/null; then
  echo "  already installed / 이미 설치됨"
else
  if pgrep -x unattended-upgr >/dev/null || pgrep -f apt.systemd.daily >/dev/null; then
    echo "  The server is running its own automatic update. Waiting for it to finish... / 서버 자동 업데이트가 끝나길 기다리는 중"
  fi
  $APT update || echo "  (some package lists failed to update - continuing)"
  $APT install --no-install-recommends curl git ca-certificates gnupg python3 python3-numpy python3-scipy debian-keyring debian-archive-keyring apt-transport-https
fi
python3 --version

say "2/7 Checking HTTPS server (Caddy) · HTTPS 서버 확인"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  $APT update && $APT install caddy
fi
[ -f /swapfile ] || { fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab; }

say "3/7 Downloading the game · 게임 내려받기"
id linkbeat >/dev/null 2>&1 || useradd -r -m -d /home/linkbeat -s /usr/sbin/nologin linkbeat
mkdir -p "$DATA"
if [ ! -d "$APP/.git" ]; then git clone -q "$REPO" "$APP"; fi
git config --global --add safe.directory "$APP" 2>/dev/null || true
git -C "$APP" fetch -q origin main && git -C "$APP" reset -q --hard origin/main
chown -R linkbeat:linkbeat "$DATA"

say "4/7 Host key · 호스트 키 준비"
if [ ! -f "$ENVF" ] || ! grep -q '^LB_HOST_KEY=.\+' "$ENVF"; then
  KEY=$(python3 -c 'import secrets;print(secrets.token_urlsafe(24))')
  cat > "$ENVF" <<EOF
LB_HOST_KEY=$KEY
EOF
fi
chmod 600 "$ENVF"
KEY=$(grep '^LB_HOST_KEY=' "$ENVF" | cut -d= -f2-)

say "5/7 Auto start / auto update · 자동 실행 등록"
cat > /etc/systemd/system/linkbeat.service <<EOF
[Unit]
Description=LINKBEAT rhythm game server
After=network-online.target
[Service]
User=linkbeat
WorkingDirectory=$APP
Environment=PORT=$PORT
Environment=LB_CLOUD=1
Environment=LB_DATA=$DATA
Environment=LB_BIND=127.0.0.1
Environment=PYTHONUNBUFFERED=1
EnvironmentFile=$ENVF
ExecStart=/usr/bin/python3 server.py
Restart=always
RestartSec=2
[Install]
WantedBy=multi-user.target
EOF

IP=$(curl -fsS --max-time 10 https://checkip.amazonaws.com | tr -d '[:space:]')
HOST="linkbeat.${IP//./-}.sslip.io"
echo "$HOST" > /etc/linkbeat.host

# 자동 업데이트: 깃허브에 새 코드가 있으면 받아서 재시작. 단, 방에 친구들이 있으면(플레이 중) 기다렸다가
# 아무도 없을 때 적용 (최대 3시간 기다리고 그래도 계속 바쁘면 그때 적용)
cat > /usr/local/bin/linkbeat-update <<'EOF'
#!/bin/bash
APP=/opt/linkbeat
STAMP=/var/lib/linkbeat/.update-waiting
cd $APP || exit 0
# 달 없는 밤 설치 스크립트가 Caddy 설정을 새로 쓰면 링크비트 주소가 빠지므로 다시 넣음
if [ -f /etc/caddy/linkbeat.caddy ] && ! grep -q 'import /etc/caddy/linkbeat.caddy' /etc/caddy/Caddyfile; then
  printf '\nimport /etc/caddy/linkbeat.caddy\n' >> /etc/caddy/Caddyfile
  systemctl reload caddy || systemctl restart caddy
fi
git fetch -q origin main || exit 0
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] && { rm -f $STAMP; exit 0; }
BUSY=$(curl -fsS --max-time 5 http://127.0.0.1:8800/api/health | grep -o '"busy": *true' || true)
if [ -n "$BUSY" ]; then
  [ -f $STAMP ] || date +%s > $STAMP
  [ $(( $(date +%s) - $(cat $STAMP) )) -lt 10800 ] && exit 0
fi
rm -f $STAMP
git reset -q --hard origin/main
systemctl restart linkbeat
echo "updated to $(git rev-parse --short HEAD)"
EOF
chmod +x /usr/local/bin/linkbeat-update
cat > /etc/systemd/system/linkbeat-update.service <<EOF
[Unit]
Description=LINKBEAT auto update
[Service]
Type=oneshot
ExecStart=/usr/local/bin/linkbeat-update
EOF
cat > /etc/systemd/system/linkbeat-update.timer <<EOF
[Unit]
Description=Check GitHub for LINKBEAT updates every minute
[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
[Install]
WantedBy=timers.target
EOF

say "6/7 Daily backup · 매일 백업"
cat > /usr/local/bin/linkbeat-backup <<'EOF'
#!/bin/bash
mkdir -p /var/backups/linkbeat
tar czf /var/backups/linkbeat/linkbeat-$(date +%Y%m%d).tgz -C /var/lib linkbeat 2>/dev/null
ls -1t /var/backups/linkbeat/linkbeat-*.tgz | tail -n +15 | xargs -r rm -f
EOF
chmod +x /usr/local/bin/linkbeat-backup
cat > /etc/systemd/system/linkbeat-backup.service <<EOF
[Unit]
Description=LINKBEAT daily backup
[Service]
Type=oneshot
ExecStart=/usr/local/bin/linkbeat-backup
EOF
cat > /etc/systemd/system/linkbeat-backup.timer <<EOF
[Unit]
Description=LINKBEAT daily backup
[Timer]
OnCalendar=*-*-* 05:00:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable -q --now linkbeat.service linkbeat-update.timer linkbeat-backup.timer
systemctl restart linkbeat

say "7/7 HTTPS address (Moonless Night stays as is) · 주소 연결"
cat > /etc/caddy/linkbeat.caddy <<EOF
$HOST {
  encode gzip
  reverse_proxy 127.0.0.1:$PORT
}
EOF
touch /etc/caddy/Caddyfile
grep -q 'import /etc/caddy/linkbeat.caddy' /etc/caddy/Caddyfile || printf '\nimport /etc/caddy/linkbeat.caddy\n' >> /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || echo "⚠ Caddy 설정 확인 필요 (caddy validate --config /etc/caddy/Caddyfile)"
systemctl enable -q caddy
systemctl reload caddy 2>/dev/null || systemctl restart caddy

sleep 3
if curl -fsS --max-time 5 http://127.0.0.1:$PORT/api/health >/dev/null; then OK="SERVER OK"; else OK="SERVER NOT RESPONDING (journalctl -u linkbeat -n 50)"; fi
echo
echo "=================================================================="
echo " DONE · $OK"
echo " Game address :  https://$HOST/"
echo " Host key     :  $KEY"
echo "   - Keep this key to yourself (only for adding songs)."
echo "   - Forgot it?  sudo grep KEY /etc/linkbeat.env"
echo " (HTTPS certificate may take about 1 minute)"
echo "=================================================================="
