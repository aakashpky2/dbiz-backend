const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
    try {
        const now = new Date();
        res.json({ utc_datetime: now.toISOString() });
    } catch (error) {
        console.error('[Time Route] Error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
