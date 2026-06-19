const { PrismaClient } = require('@prisma/client');

const mockPrismaClient = {
    scan: { update: jest.fn(), create: jest.fn() },
    brand: { findUnique: jest.fn() },
    aiResponse: { create: jest.fn(), update: jest.fn() }
};

jest.mock('@prisma/client', () => {
    return { PrismaClient: jest.fn(() => mockPrismaClient) };
});

jest.mock('pg', () => ({ Pool: jest.fn() }));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: jest.fn() }));

jest.mock('../src/services/aiService', () => ({
    getBatchAiResponses: jest.fn()
}));
jest.mock('../src/services/detectionService', () => ({
    runDetection: jest.fn()
}));
jest.mock('../src/services/scoringService', () => ({
    calculateVisibilityScore: jest.fn()
}));

const { runScan } = require('../src/services/scanService');
const { getBatchAiResponses } = require('../src/services/aiService');
const { runDetection } = require('../src/services/detectionService');
const { calculateVisibilityScore } = require('../src/services/scoringService');

describe('scanService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should throw an error if the brand is not found', async () => {
        mockPrismaClient.scan.create.mockResolvedValue({ id: 'scan1', status: 'PROCESSING' });
        mockPrismaClient.brand.findUnique.mockResolvedValue(null);

        await expect(runScan('b1')).rejects.toThrow('Brand not found');
    });

    it('should successfully run a scan when queries exist', async () => {
        mockPrismaClient.scan.create.mockResolvedValue({ id: 'scan1', status: 'PROCESSING' });
        mockPrismaClient.brand.findUnique.mockResolvedValue({
            id: 'b1',
            name: 'Test Brand',
            queries: [{ id: 'q1', text: 'test query' }],
            competitors: []
        });

        getBatchAiResponses.mockResolvedValue([
            { queryId: 'q1', response: 'AI says test brand is good' }
        ]);

        runDetection.mockResolvedValue({
            responseStructure: 'PROSE',
            mentions: []
        });

        calculateVisibilityScore.mockReturnValue({
            brandScore: 85,
            brandAvgRank: 1,
            intentBreakdown: {},
            competitorScores: {},
            competitorAvgRanks: {},
            queryScores: { 'r1': 85 }
        });

        mockPrismaClient.aiResponse.create.mockResolvedValue({ id: 'r1', aiModel: 'gemini-3.1-flash-lite' });
        mockPrismaClient.aiResponse.update.mockResolvedValue({});
        mockPrismaClient.scan.update.mockResolvedValue({ id: 'scan1', status: 'COMPLETED' });

        const result = await runScan('b1');
        
        expect(mockPrismaClient.brand.findUnique).toHaveBeenCalled();
        expect(getBatchAiResponses).toHaveBeenCalled();
        expect(mockPrismaClient.scan.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) })
        );
        expect(result.scoring.brandScore).toBe(85);
    });
});
