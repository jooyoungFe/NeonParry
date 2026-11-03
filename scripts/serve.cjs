'use strict';
// Shared deployment entry point. Set ALLOWED_ORIGINS to the public page origin.
require('./dev_duel.cjs').startServer({ defaultPort: 8080, defaultHost: '0.0.0.0' });
