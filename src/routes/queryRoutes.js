const express = require('express');
const prisma = require('../db');
const { autoPopulateQueries } = require('../services/queryService');

const router = express.Router();

// POST /queries/generate -> Auto-generates queries using AI
router.post('/generate', async (req, res) => {
    try {
        const { brandId, industry, generatorModel, perspective } = req.body || {};

        if (!brandId || !industry) {
            return res.status(400).json({ error: "Missing required fields (brandId, industry)" });
        }

        const result = await autoPopulateQueries(brandId, industry, null, generatorModel, perspective);
        res.status(200).json(result);

    } catch (error) {
        console.error("Error generating queries:", error);
        res.status(500).json({ error: error.message || "Internal Server Error" });
    }
});


// POST /queries -> Adds a manual query for a brand
router.post('/', async (req, res) => {
    try {
        const { text, brandId } = req.body || {};

        if (!text || !brandId) return res.status(400).json({ error: "Missing required fields (text, brandId)" });

        const query = await prisma.query.create({
            data: {
                text,
                brandId
            }
        });

        res.status(201).json(query);
    } catch (error) {
        console.error("Error creating query:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// GET /queries/:brandId -> Lists all queries for a brand
router.get('/:brandId', async (req, res) => {
    try {
        const { brandId } = req.params;
        const queries = await prisma.query.findMany({
            where: { brandId },
            orderBy: { createdAt: 'desc' },
            select: { id: true, text: true, batchId: true, createdAt: true }
        });
        res.json(queries);
    } catch (error) {
        console.error("Error fetching queries:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

module.exports = router;
