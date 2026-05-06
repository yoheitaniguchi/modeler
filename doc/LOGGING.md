# Logging Implementation

This document describes the logging system implemented across the Client, Server, and Shared modules of the Modeler application.

## Overview

The logging system tracks all operations and errors across the application, writing logs to:
- **Server**: JSON-formatted logs to `log/server.log`
- **Client**: Logs stored in browser localStorage and accessible via developer tools
- **Both**: Console output for development

## Architecture

### Shared Logger Interface

All modules use a common logger interface defined in `shared/src/logger.ts`:

```typescript
interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, error?: Error | Record<string, unknown>): void;
}
```

### Server-Side Logging

**Location**: `server/src/services/logger.ts`

Uses [Pino](https://getpino.io/) for high-performance JSON logging:
- Logs written to `log/server.log` in JSON format
- Console output with `pino-pretty` for readable formatting during development
- Configurable log level via `LOG_LEVEL` environment variable (default: `info`)
- Includes timestamp, process ID, hostname, and contextual data

**Logged Operations**:
- Server startup with port and URL
- Model deployments (success/failure)
- Model updates (success/failure)
- Model deletions (success/failure)
- Test resets
- API health checks

### Client-Side Logging

**Location**: `client/src/services/logger.ts`

Stores logs in browser localStorage:
- Up to 1000 logs stored in `modeler_logs` key
- Console output for development
- Logs are structured with timestamp, level, message, and optional data

**Usage**:
```typescript
import { clientLogger, getClientLogs, clearClientLogs } from './services/logger.js';

// Log an operation
clientLogger.info('User action performed', { action: 'save', recordId: 123 });

// Retrieve all logs
const logs = getClientLogs();

// Clear logs
clearClientLogs();
```

## Log Levels

- **DEBUG**: Detailed diagnostic information (development only)
- **INFO**: General informational messages (important operations)
- **WARN**: Warning messages (validation failures, recoverable errors)
- **ERROR**: Error messages (exceptions, unrecoverable errors)

## Server Log Endpoint

The server provides a `/meta/logs` endpoint to receive client logs:

```
POST /meta/logs
Content-Type: application/json

{
  "level": "info",
  "message": "Operation completed",
  "data": { "recordId": 123 }
}
```

Responses:
- `200 OK`: Log received successfully

## File Structure

```
log/
├── server.log          # Server logs in JSON format
```

Client logs are stored in browser localStorage, accessible via:
- Browser DevTools → Application → LocalStorage → modeler_logs
- Or programmatically via `getClientLogs()`

## Example Log Format

### Server Logs (JSON format)
```json
{"level":30,"time":"2026-05-07T10:30:15.453Z","modelName":"customer","msg":"Deploying model"}
{"level":30,"time":"2026-05-07T10:30:15.457Z","msg":"Model deployed successfully"}
{"level":40,"time":"2026-05-07T10:30:20.123Z","modelName":"customer","errors":["validation error"],"msg":"Model update validation failed"}
```

### Client Logs (localStorage format)
```json
[
  {
    "timestamp": "2026-05-07T10:30:15.453Z",
    "level": "info",
    "message": "Application started",
    "data": { "timestamp": "2026-05-07T10:30:15.453Z" }
  },
  {
    "timestamp": "2026-05-07T10:30:16.100Z",
    "level": "warn",
    "message": "Form validation failed",
    "data": { "field": "email", "error": "Invalid email format" }
  }
]
```

## Environment Variables

- `LOG_LEVEL`: Controls server log level (default: `info`)
  - Possible values: `debug`, `info`, `warn`, `error`
  - Set via: `LOG_LEVEL=debug npm run dev:server`

## Accessing Logs

### Server Logs
```bash
# View server logs
tail -f log/server.log

# Pretty print JSON logs
cat log/server.log | jq .

# Filter logs by message
cat log/server.log | jq 'select(.msg | contains("Deploy"))'

# Filter logs by level (30=info, 40=warn, 50=error)
cat log/server.log | jq 'select(.level >= 40)'
```

### Client Logs
In browser DevTools:
1. Open DevTools (F12)
2. Go to Application tab
3. Click LocalStorage
4. Find `modeler_logs` key
5. Parse the JSON value in the console:
   ```javascript
   JSON.parse(localStorage.getItem('modeler_logs'))
   ```

Or in application code:
```typescript
import { getClientLogs } from './services/logger.js';
console.log(getClientLogs());
```

## Log Retention

- **Server**: Logs accumulate in `log/server.log`. Implement log rotation as needed.
- **Client**: Limited to 1000 most recent entries. Older entries are automatically removed.

## Integration Points

### Shared Module
- Exports Logger interface and utilities
- No external dependencies
- Can be used by both client and server

### Server Module
- `server/src/index.ts`: Server startup logging
- `server/src/app.ts`: API endpoint logging
- `server/src/services/logger.ts`: Logger implementation

### Client Module
- `client/src/main.tsx`: Application startup logging
- `client/src/services/logger.ts`: Logger implementation
- Components can import `clientLogger` to log user actions

## Future Enhancements

- [ ] Log rotation for server logs
- [ ] Client logs sent to server endpoint
- [ ] Dashboard to view logs
- [ ] Log filtering and search
- [ ] Alert on error logs
