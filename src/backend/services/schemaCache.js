const fs = require('fs').promises;
const path = require('path');

/**
 * Service to load and save database schema to/from a file
 * to avoid repeated schema extraction and reduce token usage
 */

// Path to the cached schema file
const SCHEMA_CACHE_FILE = path.join(__dirname, '../../..', 'config', 'db_schema.json');

/**
 * Loads schema from the cache file
 * @returns {Object|null} Cached schema or null if not found
 */
const loadCachedSchema = async () => {
  try {
    const data = await fs.readFile(SCHEMA_CACHE_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.log('No cached schema found or error reading cache:', error.message);
    return null;
  }
};

/**
 * Saves schema to the cache file
 * @param {Object} schema The database schema to cache
 */
const saveSchemaToCache = async (schema) => {
  try {
    await fs.writeFile(SCHEMA_CACHE_FILE, JSON.stringify(schema, null, 2), 'utf8');
    console.log('Schema cached successfully');
  } catch (error) {
    console.error('Error caching schema:', error.message);
  }
};

/**
 * Updates the cached schema with manual entries
 * @param {Object} manualSchemaEntries Manual schema entries to add/update
 */
const updateCachedSchema = async (manualSchemaEntries) => {
  try {
    // Load existing schema
    let existingSchema = await loadCachedSchema() || {};
    
    // Merge with manual entries
    existingSchema = {
      ...existingSchema,
      ...manualSchemaEntries
    };
    
    // Save updated schema
    await saveSchemaToCache(existingSchema);
    return existingSchema;
  } catch (error) {
    console.error('Error updating schema cache:', error.message);
    throw error;
  }
};

/**
 * Loads schema from manual definition file
 * @param {string} filePath Path to the manual schema definition file
 * @returns {Object} Parsed schema
 */
const loadSchemaFromFile = async (filePath) => {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    
    // Handle different formats (JSON or simplified text format)
    if (filePath.endsWith('.json')) {
      return JSON.parse(data);
    } else {
      // Parse simplified text format
      return parseSimplifiedSchemaFormat(data);
    }
  } catch (error) {
    console.error('Error loading schema from file:', error.message);
    throw error;
  }
};

/**
 * Parses a simplified schema format
 * Format: database_name.table_name: column1(type,key), column2(type,key)
 * @param {string} text Simplified schema text
 * @returns {Object} Parsed schema
 */
const parseSimplifiedSchemaFormat = (text) => {
  const schema = {};
  const lines = text.split('\n').filter(line => line.trim());
  
  for (const line of lines) {
    // Skip comments
    if (line.trim().startsWith('#') || line.trim().startsWith('//')) {
      continue;
    }
    
    // Parse database.table: columns
    const match = line.match(/^([^.]+)\.([^:]+):\s*(.+)$/);
    if (match) {
      const [_, database, table, columnsText] = match;
      
      // Create database and table in schema if they don't exist
      schema[database] = schema[database] || {};
      schema[database][table] = [];
      
      // Parse columns
      const columns = columnsText.split(',').map(col => col.trim());
      for (const column of columns) {
        const colMatch = column.match(/^([^\(]+)(?:\(([^\)]+)\))?$/);
        if (colMatch) {
          const [__, fieldName, attributes] = colMatch;
          const columnObj = { Field: fieldName.trim() };
          
          // Parse attributes if present
          if (attributes) {
            const attributeParts = attributes.split(',').map(attr => attr.trim());
            attributeParts.forEach(attr => {
              if (attr.toUpperCase() === 'PK' || attr.toUpperCase() === 'PRIMARY') {
                columnObj.Key = 'PRI';
              } else if (attr.toUpperCase() === 'FK' || attr.toUpperCase() === 'FOREIGN') {
                columnObj.Key = 'MUL';
              } else if (attr.includes('=')) {
                // Handle constraints like rel=other_table.column
                const [key, value] = attr.split('=').map(part => part.trim());
                columnObj[key] = value;
              } else {
                // Assume it's a type
                columnObj.Type = attr;
              }
            });
          }
          
          schema[database][table].push(columnObj);
        }
      }
    }
  }
  
  return schema;
};

module.exports = {
  loadCachedSchema,
  saveSchemaToCache,
  updateCachedSchema,
  loadSchemaFromFile,
}; 