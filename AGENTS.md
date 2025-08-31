# Agent Instructions for Song Wall

## Build/Lint/Test Commands

### Development

- `npm run dev` - Start development server with Turbopack
- `npm run build` - Build production bundle with Turbopack
- `npm run start` - Start production server
- `npm run lint` - Run ESLint (Next.js + TypeScript rules)

### WebSocket

- `npm run ws` - Start WebSocket server using tsx

### Scripts

- `npm run update-album-art` - Update album artwork via script

### Process Management (via justfile)

- `just start-all` - Start both app and WebSocket server
- `just stop` - Stop all processes
- `just restart` - Restart all processes

## Code Style Guidelines

### TypeScript

- Strict mode enabled (`"strict": true` in tsconfig.json)
- Use explicit types for function parameters and return values
- Prefer interfaces over types for object shapes
- Use `Readonly<>` for immutable props

### Naming Conventions

- **Components**: PascalCase (e.g., `NowPlayingPanel`, `AlbumWall`)
- **Functions/Variables**: camelCase (e.g., `loadAlbums`, `spotifyApiClient`)
- **Types/Interfaces**: PascalCase (e.g., `Track`, `Props`)
- **Files**: kebab-case for routes, PascalCase for components

### Imports

- Use absolute imports with `@/` alias (configured in tsconfig.json)
- Group imports: React/Next.js first, then external libs, then internal modules
- Use type imports for TypeScript types: `import type { Metadata } from "next"`

### React Patterns

- Use `"use client"` directive for client components
- Wrap components with `React.memo()` for performance optimization
- Use functional components with hooks
- Implement proper loading states and error handling
- Include accessibility attributes (`aria-label`, `role`, etc.)

### Error Handling

- Use try/catch blocks with specific error types
- Log errors with context information
- Provide fallback UI states for failed operations
- Handle rate limiting gracefully with retry logic

### API Routes

- Use Next.js 13+ app router structure
- Export named functions (GET, POST, etc.) for HTTP methods
- Return `NextResponse.json()` for API responses
- Implement rate limiting and caching where appropriate

### Styling

- Use Tailwind CSS for styling
- Follow responsive design patterns with mobile-first approach
- Use semantic class names and consistent spacing
- Implement dark/light theme support if needed

### Security

- Never log sensitive information (tokens, secrets, passwords)
- Validate input data on both client and server
- Use environment variables for configuration
- Implement proper authentication/authorization

### Performance

- Use React.memo for expensive components
- Implement caching for API responses
- Add loading skeletons for better UX
- Optimize images and assets

## Testing

- No specific test framework configured - use Jest/Testing Library if adding tests
- Test API routes, components, and utilities
- Include integration tests for critical user flows

## Commit Guidelines

- Use conventional commit format
- Include issue references when applicable
- Write clear, concise commit messages focusing on "why" not "what"

## Webserver Instructions

- Never run their web servers; always assume that I'm already running them
