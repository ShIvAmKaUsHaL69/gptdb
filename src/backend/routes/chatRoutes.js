const express = require('express');
const router = express.Router();
const chatService = require('../services/chatService');

// Process natural language query
router.post('/query', async (req, res) => {
  try {
    const { query, database } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    
    const result = await chatService.processNaturalLanguageQuery(query, database);
    res.json(result);
  } catch (error) {
    console.error('Error processing chat query:', error);
    res.status(500).json({ 
      error: error.message,
      query: req.body.query,
      sql: null,
      results: null,
      explanation: `I encountered an error: ${error.message}`
    });
  }
});

module.exports = router; 