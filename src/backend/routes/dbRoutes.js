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

// Add relationship between tables
router.post('/schema/relationships', async (req, res) => {
  try {
    const { sourceDB, sourceTable, sourceColumn, targetDB, targetTable, targetColumn, relationship } = req.body;
    
    // Validate required fields
    if (!sourceDB || !sourceTable || !sourceColumn || !targetDB || !targetTable || !targetColumn) {
      return res.status(400).json({ error: 'Missing required relationship information' });
    }
    
    // Load current cached schema
    let schema = await schemaCache.loadCachedSchema();
    
    if (!schema) {
      // If no cache exists, create a new schema
      schema = {};
    }
    
    // Ensure database and table objects exist
    schema[sourceDB] = schema[sourceDB] || {};
    schema[sourceDB][sourceTable] = schema[sourceDB][sourceTable] || [];
    
    // Find or create the source column
    let sourceColumnObj = null;
    if (Array.isArray(schema[sourceDB][sourceTable])) {
      sourceColumnObj = schema[sourceDB][sourceTable].find(col => col.Field === sourceColumn);
    }
    
    if (!sourceColumnObj) {
      // If we can't find the column, try fetching from database
      try {
        const dbSchema = await schemaService.getDatabaseSchema(sourceDB);
        if (dbSchema[sourceTable]) {
          schema[sourceDB][sourceTable] = dbSchema[sourceTable];
          sourceColumnObj = schema[sourceDB][sourceTable].find(col => col.Field === sourceColumn);
        }
      } catch (error) {
        console.error(`Error fetching schema for ${sourceDB}.${sourceTable}:`, error.message);
      }
      
      // If still not found, add a basic column definition
      if (!sourceColumnObj) {
        sourceColumnObj = { Field: sourceColumn };
        schema[sourceDB][sourceTable].push(sourceColumnObj);
      }
    }
    
    // Add relationship information to the column
    sourceColumnObj.References = sourceColumnObj.References || [];
    
    // Check if this relationship already exists
    const existingRelIndex = sourceColumnObj.References.findIndex(ref => 
      ref.database === targetDB && ref.table === targetTable && ref.column === targetColumn
    );
    
    if (existingRelIndex >= 0) {
      // Update existing relationship
      sourceColumnObj.References[existingRelIndex] = {
        database: targetDB,
        table: targetTable,
        column: targetColumn,
        type: relationship || 'MANY_TO_ONE' // Default relationship type
      };
    } else {
      // Add new relationship
      sourceColumnObj.References.push({
        database: targetDB,
        table: targetTable,
        column: targetColumn,
        type: relationship || 'MANY_TO_ONE' // Default relationship type
      });
    }
    
    // Ensure target table exists in schema (this fixes the issue when tables don't appear in schema)
    schema[targetDB] = schema[targetDB] || {};
    if (!schema[targetDB][targetTable]) {
      try {
        // Try to fetch the target table schema
        const targetDbSchema = await schemaService.getDatabaseSchema(targetDB);
        if (targetDbSchema && targetDbSchema[targetTable]) {
          schema[targetDB][targetTable] = targetDbSchema[targetTable];
        } else {
          // Create a minimal table structure with the target column
          schema[targetDB][targetTable] = [{ Field: targetColumn }];
        }
      } catch (error) {
        console.error(`Error fetching schema for ${targetDB}.${targetTable}:`, error.message);
        // Create a minimal table structure if fetch fails
        schema[targetDB][targetTable] = [{ Field: targetColumn }];
      }
    }
    
    // Save updated schema to cache
    await schemaCache.saveSchemaToCache(schema);
    
    res.json({ 
      success: true, 
      message: `Relationship added: ${sourceDB}.${sourceTable}.${sourceColumn} -> ${targetDB}.${targetTable}.${targetColumn}`
    });
  } catch (error) {
    console.error('Error adding relationship:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all relationships in the schema
router.get('/schema/relationships', async (req, res) => {
  try {
    const schema = await schemaCache.loadCachedSchema();
    
    if (!schema) {
      return res.status(404).json({ error: 'No cached schema found' });
    }
    
    // Extract all relationships from the schema
    const relationships = [];
    
    for (const dbName in schema) {
      for (const tableName in schema[dbName]) {
        for (const column of schema[dbName][tableName]) {
          if (column.References && column.References.length > 0) {
            column.References.forEach(ref => {
              relationships.push({
                sourceDB: dbName,
                sourceTable: tableName,
                sourceColumn: column.Field,
                targetDB: ref.database,
                targetTable: ref.table,
                targetColumn: ref.column,
                type: ref.type
              });
            });
          }
        }
      }
    }
    
    res.json(relationships);
  } catch (error) {
    console.error('Error getting relationships:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete a relationship
router.delete('/schema/relationships', async (req, res) => {
  try {
    const { sourceDB, sourceTable, sourceColumn, targetDB, targetTable, targetColumn } = req.body;
    
    // Validate required fields
    if (!sourceDB || !sourceTable || !sourceColumn || !targetDB || !targetTable || !targetColumn) {
      return res.status(400).json({ error: 'Missing required relationship information' });
    }
    
    // Load current cached schema
    const schema = await schemaCache.loadCachedSchema();
    
    if (!schema || !schema[sourceDB] || !schema[sourceDB][sourceTable]) {
      return res.status(404).json({ error: 'Source table not found in schema' });
    }
    
    // Find source column
    const sourceColumnObj = schema[sourceDB][sourceTable].find(col => col.Field === sourceColumn);
    
    if (!sourceColumnObj || !sourceColumnObj.References) {
      return res.status(404).json({ error: 'Source column or relationships not found' });
    }
    
    // Remove the relationship
    const initialLength = sourceColumnObj.References.length;
    sourceColumnObj.References = sourceColumnObj.References.filter(ref => 
      !(ref.database === targetDB && ref.table === targetTable && ref.column === targetColumn)
    );
    
    if (sourceColumnObj.References.length === initialLength) {
      return res.status(404).json({ error: 'Relationship not found' });
    }
    
    // If no relationships left, remove the References array
    if (sourceColumnObj.References.length === 0) {
      delete sourceColumnObj.References;
    }
    
    // Save updated schema to cache
    await schemaCache.saveSchemaToCache(schema);
    
    res.json({ 
      success: true, 
      message: `Relationship deleted: ${sourceDB}.${sourceTable}.${sourceColumn} -> ${targetDB}.${targetTable}.${targetColumn}`
    });
  } catch (error) {
    console.error('Error deleting relationship:', error);
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
    simplifiedText += "# PK = Primary Key, FK = Foreign Key\n";
    simplifiedText += "# Relationships can be defined with REF=target_db.target_table.target_column\n\n";
    
    for (const dbName in schema) {
      simplifiedText += `# Database: ${dbName}\n`;
      
      for (const tableName in schema[dbName]) {
        const columns = schema[dbName][tableName];
        
        // Start the table line
        simplifiedText += `${dbName}.${tableName}: `;
        
        // Add columns with their types and keys
        const columnTexts = columns.map(column => {
          let columnText = column.Field;
          
          // Add type and key info
          const attributes = [];
          
          if (column.Type) {
            attributes.push(column.Type);
          }
          
          if (column.Key === 'PRI') {
            attributes.push('PK');
          } else if (column.Key === 'MUL') {
            attributes.push('FK');
          } else if (column.Key) {
            attributes.push(column.Key);
          }
          
          // Add relationship info
          if (column.References && column.References.length > 0) {
            column.References.forEach(ref => {
              attributes.push(`REF=${ref.database}.${ref.table}.${ref.column}`);
            });
          }
          
          if (attributes.length > 0) {
            columnText += `(${attributes.join(',')})`;
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