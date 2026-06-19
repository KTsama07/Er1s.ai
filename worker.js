require('dotenv').config();

// Install log interceptor BEFORE anything else writes to stdout
const logService = require('./src/services/logService');
logService.install();

console.log('🚀 Starting background queue worker...');

// Start the queue worker
require('./src/queue/scanWorker');
