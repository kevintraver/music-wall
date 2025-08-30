# Song Wall Development Commands

# Install all dependencies (including pm2 for process management)
install:
    cd backend && npm install
    cd ../frontend && npm install
    npm install -g pm2

# Start backend server
start-backend:
    pm2 start "cd backend && npm start" --name songwall-backend || just start-backend-fallback

# Start frontend dev server
start-frontend:
    pm2 start "cd frontend && npm run dev" --name songwall-frontend || just start-frontend-fallback

# Start both backend and frontend
start-all:
    just start-backend
    just start-frontend

# Fallbacks without pm2
start-backend-fallback:
    cd backend && npm start &

start-frontend-fallback:
    cd frontend && npm run dev &

# Clean node_modules
clean:
    rm -rf backend/node_modules
    rm -rf frontend/node_modules

# Stop all processes
stop:
    pm2 stop all || just stop-fallback

# Restart all processes
restart:
    pm2 restart all || (just stop-fallback && just start-all-fallback)

# Fallback stop without pm2
stop-fallback:
    -pkill -f "node server.js"
    -pkill -f "next dev"

# Fallback start without pm2
start-all-fallback:
    just start-backend-fallback
    just start-frontend-fallback

# Full setup (install + start)
setup:
    just install
    just start-all