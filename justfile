# Song Wall Development Commands

# Install all dependencies
install:
    cd backend && npm install
    cd ../frontend && npm install

# Start backend server
start-backend:
    cd backend && npm start

# Start frontend dev server
start-frontend:
    cd frontend && npm run dev

# Start both backend and frontend
start-all:
    just start-backend &
    just start-frontend &

# Run Spotifyd (requires config file)
spotifyd:
    spotifyd --no-daemon --verbose

# Clean node_modules
clean:
    rm -rf backend/node_modules
    rm -rf frontend/node_modules

# Full setup (install + start)
setup:
    just install
    just start-all