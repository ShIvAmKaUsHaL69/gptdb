const express = require('express');
const router = express.Router();
const schemaService = require('../services/schemaService');
const schemaCache = require('../services/schemaCache');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;

// Configure multer for file uploads
const upload = multer({
  dest: path.join(__dirname, '../../../tmp/uploads'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// Get all databases
router.get('/databases', async (req, res) => {
  try {
    const databases = await schemaService.getAllDatabases();
    // Filter out system databases
    const userDatabases = databases.filter(db => 
      !['information_schema', 'mysql', 'performance_schema', 'sys'].includes(db)
    );
    res.json(userDatabases);
  } catch (error) {
    console.error('Error getting databases:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get tables for a specific database
router.get('/databases/:database/tables', async (req, res) => {
  try {
    const { database } = req.params;
    const schema = await schemaService.getDatabaseSchema(database);
    res.json(Object.keys(schema));
  } catch (error) {
    console.error(`Error getting tables for database ${req.params.database}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Get schema for a specific table
router.get('/databases/:database/tables/:table', async (req, res) => {
  try {
    const { database, table } = req.params;
    const schema = await schemaService.getDatabaseSchema(database);
    
    if (!schema[table]) {
      return res.status(404).json({ error: `Table ${table} not found in database ${database}` });
    }
    
    res.json(schema[table]);
  } catch (error) {
    console.error(`Error getting schema for ${req.params.database}.${req.params.table}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Execute custom SQL query
router.post('/query', async (req, res) => {
  try {
    const { sql, database } = req.body;
    
    if (!sql) {
      return res.status(400).json({ error: 'SQL query is required' });
    }
    
    if (!database) {
      return res.status(400).json({ error: 'Database name is required' });
    }
    
    // Check if SQL is read-only (SELECT, SHOW, DESCRIBE)
    const isReadOnly = sql.trim().toLowerCase().startsWith('select') || 
                       sql.trim().toLowerCase().startsWith('show') || 
                       sql.trim().toLowerCase().startsWith('describe');
    
    if (!isReadOnly) {
      return res.status(403).json({ error: 'Only read-only queries are permitted' });
    }
    
    const results = await schemaService.executeCustomQuery(sql, database);
    res.json(results);
  } catch (error) {
    console.error('Error executing custom query:', error);
    res.status(500).json({ error: error.message });
  }
});

// Cache database schema
router.post('/schema/cache', async (req, res) => {
  try {
    // Get full schema
    const schema = await schemaService.buildSchemaContext();
    
    // Save to cache file
    await schemaCache.saveSchemaToCache(schema);
    
    res.json({ success: true, message: 'Schema cached successfully' });
  } catch (error) {
    console.error('Error caching schema:', error);
    res.status(500).json({ error: error.message });
  }
});

// Upload and parse schema file
router.post('/schema/upload', upload.single('schemaFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Load schema from uploaded file
    const schema = await schemaCache.loadSchemaFromFile(req.file.path);
    
    // Save to cache
    await schemaCache.saveSchemaToCache(schema);
    
    res.json({ 
      success: true, 
      message: 'Schema file processed successfully',
      databases: Object.keys(schema)
    });
  } catch (error) {
    console.error('Error processing schema file:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get cached schema
router.get('/schema/cache', async (req, res) => {
  try {
    const schema = await schemaCache.loadCachedSchema();
    
    if (!schema) {
      return res.status(404).json({ error: 'No cached schema found' });
    }
    
    res.json(schema);
  } catch (error) {
    console.error('Error loading cached schema:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate simplified schema format
router.get('/schema/simplified', async (req, res) => {
  try {
    // First try from cache
    let schema = await schemaCache.loadCachedSchema();
    
    // If no cache, build the schema
    if (!schema) {
      schema = await schemaService.buildSchemaContext();
    }
    
    // Convert to simplified format
    let simplifiedText = "# Simplified Database Schema\n";
    simplifiedText += "# Format: database_name.table_name: column1(type,key), column2(type)\n";
    simplifiedText += "# PK = Primary Key, FK = Foreign Key\n\n";
    
    for (const dbName in schema) {
      simplifiedText += `# Database: ${dbName}\n`;
      
      for (const tableName in schema[dbName]) {
        const columns = schema[dbName][tableName];
        
        // Start the table line
        simplifiedText += `${dbName}.${tableName}: `;
        
        // Add columns with their types and keys
        const columnTexts = columns.map(column => {
          let columnText = column.Field;
          
          // Add type if available
          if (column.Type) {
            columnText += `(${column.Type}`;
            
            // Add key info if available
            if (column.Key === 'PRI') {
              columnText += ',PK';
            } else if (column.Key === 'MUL') {
              columnText += ',FK';
            } else if (column.Key) {
              columnText += `,${column.Key}`;
            }
            
            columnText += ')';
          }
          
          return columnText;
        });
        
        // Join all column texts and end the line
        simplifiedText += columnTexts.join(', ') + '\n';
      }
      
      simplifiedText += '\n';
    }
    
    // Set content type to plain text
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="db_schema.txt"');
    
    // Send the simplified schema format
    res.send(simplifiedText);
  } catch (error) {
    console.error('Error generating simplified schema:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate schema for specific database(s)
router.post('/schema/generate-for-db', async (req, res) => {
  try {
    const { databases } = req.body;
    
    if (!databases || !Array.isArray(databases) || databases.length === 0) {
      return res.status(400).json({ error: 'Please specify at least one database' });
    }
    
    // Build schema for specified databases
    const schemaContext = {};
    
    for (const database of databases) {
      try {
        const dbSchema = await schemaService.getDatabaseSchema(database, false);
        schemaContext[database] = dbSchema;
      } catch (error) {
        console.error(`Error getting schema for ${database}:`, error.message);
        // Continue with other databases
      }
    }
    
    // Save to cache file
    await schemaCache.saveSchemaToCache(schemaContext);
    
    res.json({ 
      success: true, 
      message: `Schema cached for databases: ${databases.join(', ')}`
    });
  } catch (error) {
    console.error('Error generating schema for specific databases:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router; 