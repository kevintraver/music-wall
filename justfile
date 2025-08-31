# Song Wall Development Commands

# Install all dependencies (including pm2 for process management)
install:
    npm install
    npm install -g pm2

# Start NextJS app (includes WebSocket server)
start-app:
    pm2 start "npm run dev" --name songwall-app || just start-app-fallback

# Start WebSocket server
start-ws:
    pm2 start "npm run ws" --name songwall-ws || just start-ws-fallback

# Start both app and WebSocket server
start-all:
    just start-app
    just start-ws

# Fallbacks without pm2
start-app-fallback:
    npm run dev &
start-ws-fallback:
    npm run ws &

# Clean node_modules
clean:
    rm -rf node_modules

# Stop all processes
stop:
    pm2 stop all || just stop-fallback

# Restart all processes
restart:
    pm2 restart all || (just stop-fallback && just start-all-fallback)

# Fallback stop without pm2
stop-fallback:
    -pkill -f "next dev"
    -pkill -f "start-websocket"

# Fallback start without pm2
start-all-fallback:
    just start-app-fallback
    just start-ws-fallback

# Full setup (install + start)
setup:
    just install
    just start-all