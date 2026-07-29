const express = require('express');
const router = express.Router();

// Client Workflows table is deprecated. All data has been migrated to Tasks.
const deprecateHandler = (req, res) => {
    res.status(410).json({
        success: false,
        error: 'The /api/client-workflows endpoints are deprecated. Please use /api/tasks instead.'
    });
};

router.get('/', deprecateHandler);
router.post('/', deprecateHandler);
router.patch('/:id', deprecateHandler);
router.delete('/:id', deprecateHandler);

module.exports = router;
