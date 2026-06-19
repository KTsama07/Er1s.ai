jest.mock('../src/db', () => ({
    brand: { findUnique: jest.fn() },
    scan: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() }
}));

jest.mock('../src/queue/scanQueue', () => ({
    add: jest.fn()
}));

const request = require('supertest');
const express = require('express');
const scanRoutes = require('../src/routes/scanRoutes');
const prisma = require('../src/db');
const scanQueue = require('../src/queue/scanQueue');

const app = express();
app.use(express.json());
app.use('/scan/:brandId', scanRoutes);

describe('scanRoutes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /scan/:brandId/run', () => {
        it('should return 404 if brand does not exist', async () => {
            prisma.brand.findUnique.mockResolvedValue(null);
            
            const response = await request(app).post('/scan/brand123/run');
            
            expect(response.status).toBe(404);
            expect(response.body.error).toBe('Brand not found');
        });

        it('should return 202 and queue the scan if brand exists', async () => {
            prisma.brand.findUnique.mockResolvedValue({ id: 'brand123', name: 'Test Brand' });
            prisma.scan.findFirst.mockResolvedValue(null); // No active scan
            prisma.scan.create.mockResolvedValue({ id: 'scan123', status: 'PENDING' });
            
            const response = await request(app).post('/scan/brand123/run');
            
            expect(response.status).toBe(202);
            expect(response.body.scanId).toBe('scan123');
            expect(response.body.status).toBe('PENDING');
            expect(scanQueue.add).toHaveBeenCalled();
        });
    });

    describe('GET /scan/:brandId/status/:scanId', () => {
        it('should return 404 if scan not found', async () => {
            prisma.scan.findFirst.mockResolvedValue(null);
            
            const response = await request(app).get('/scan/brand123/status/scan123');
            
            expect(response.status).toBe(404);
        });

        it('should return scan status', async () => {
            prisma.scan.findFirst.mockResolvedValue({
                id: 'scan123',
                status: 'PROCESSING',
                visibilityScore: null,
                failureReason: null,
                createdAt: '2023-01-01T00:00:00.000Z'
            });
            
            const response = await request(app).get('/scan/brand123/status/scan123');
            
            expect(response.status).toBe(200);
            expect(response.body.status).toBe('PROCESSING');
        });
    });
});
