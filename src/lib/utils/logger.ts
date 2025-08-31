// Logging utility with verbose mode support
//
// To enable verbose logging, set the environment variable:
// VERBOSE_LOGGING=true npm run dev
//
// Or in development mode, verbose logging is automatically enabled.
//
// By default, only error logs are shown to keep the console clean.

const VERBOSE_LOGGING = process.env.VERBOSE_LOGGING === 'true' || process.env.NODE_ENV === 'development';

export const logger = {
  info: (message: string, ...args: any[]) => {
    if (VERBOSE_LOGGING) {
      console.log(`ℹ️ ${message}`, ...args);
    }
  },

  warn: (message: string, ...args: any[]) => {
    if (VERBOSE_LOGGING) {
      console.warn(`⚠️ ${message}`, ...args);
    }
  },

  error: (message: string, ...args: any[]) => {
    // Always log errors, regardless of verbose setting
    console.error(`❌ ${message}`, ...args);
  },

  debug: (message: string, ...args: any[]) => {
    if (VERBOSE_LOGGING) {
      console.debug(`🔍 ${message}`, ...args);
    }
  },

  success: (message: string, ...args: any[]) => {
    if (VERBOSE_LOGGING) {
      console.log(`✅ ${message}`, ...args);
    }
  },

  websocket: (message: string, ...args: any[]) => {
    if (VERBOSE_LOGGING) {
      console.log(`🔌 ${message}`, ...args);
    }
  },

  playback: (message: string, ...args: any[]) => {
    if (VERBOSE_LOGGING) {
      console.log(`🎵 ${message}`, ...args);
    }
  },

  api: (message: string, ...args: any[]) => {
    if (VERBOSE_LOGGING) {
      console.log(`🔗 ${message}`, ...args);
    }
  }
};

// Export the verbose flag for components that need to check it
export const isVerboseLogging = VERBOSE_LOGGING;