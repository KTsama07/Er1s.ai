const express = require('express');
const router = express.Router();
const logService = require('../services/logService');

/**
 * GET /logs/stream
 * Server-Sent Events endpoint — streams live log entries.
 */
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx compat
  res.flushHeaders();

  // send existing buffer as initial burst
  const buffer = logService.getBuffer();
  for (const entry of buffer) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }

  // register for live updates
  logService.addClient(res);
});

/**
 * GET /logs/buffer
 * Returns the current in-memory log buffer (REST fallback).
 */
router.get('/buffer', (_req, res) => {
  res.json(logService.getBuffer());
});

module.exports = router;
