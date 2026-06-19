require('dotenv').config();

// Install log interceptor BEFORE anything else writes to stdout
const logService = require('./src/services/logService');
logService.install();

// Queue worker has been moved to worker.js

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const brandRoutes = require('./src/routes/brandRoutes');
const queryRoutes = require('./src/routes/queryRoutes');
const scanRoutes = require('./src/routes/scanRoutes');
const analyticsRoutes = require('./src/routes/analyticsRoutes');
const conversionRoutes = require('./src/routes/conversionRoutes');
const logRoutes = require('./src/routes/logRoutes');

const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/brands', brandRoutes);
app.use('/queries', queryRoutes);
app.use('/scan/:brandId', scanRoutes); // Nested route structure
app.use('/api/brands', analyticsRoutes);
app.use('/conversions', conversionRoutes);
app.use('/logs', logRoutes);

// Healthcheck
app.get('/health', (req, res) => {
    res.json({ status: "ok", service: "AI Visibility Tracker MVP" });
});

app.listen(PORT, () => {
    console.log(`🚀 MVP Server running on http://localhost:${PORT}`);
});
