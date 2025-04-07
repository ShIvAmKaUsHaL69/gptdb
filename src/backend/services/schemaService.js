const db = require('../config/db');
const schemaCache = require('./schemaCache');

/**
 * Gets schema information for all tables in a database
 * @param {string} database - Database name
 * @param {boolean} useCache - Whether to use cached schema if available
 * @returns {object} - Object containing table schema information
 */
const getDatabaseSchema = async (database, useCache = true) => {
  try {
    // Try to get from cache first if enabled
    if (useCache) {
      const cachedSchema = await schemaCache.loadCachedSchema();
      if (cachedSchema && cachedSchema[database]) {
        console.log(`Using cached schema for database ${database}`);
        return cachedSchema[database];
      }
    }
    
    // If not in cache or cache disabled, get from database
    // Get all tables in the database
    const tables = await db.getTables(database);
    
    // Get schema for each table
    const schemaInfo = {};
    for (const table of tables) {
      const tableSchema = await db.getTableSchema(database, table);
      schemaInfo[table] = tableSchema;
    }
    
    return schemaInfo;
  } catch (error) {
    console.error(`Error getting schema for database ${database}:`, error.message);
    throw error;
  }
};

/**
 * Gets all available databases
 * @returns {array} - Array of database names
 */
const getAllDatabases = async () => {
  try {
    return await db.getDatabases();
  } catch (error) {
    console.error('Error getting all databases:', error.message);
    throw error;
  }
};

/**
 * Builds a comprehensive schema object containing information about tables, columns and relationships
 * @param {boolean} useCache - Whether to use cached schema if available
 * @returns {object} - Comprehensive schema information
 */
const buildSchemaContext = async (useCache = true) => {
  try {
    // Try to get from cache first if enabled
    if (useCache) {
      const cachedSchema = await schemaCache.loadCachedSchema();
      if (cachedSchema && Object.keys(cachedSchema).length > 0) {
        console.log('Using cached schema context');
        return cachedSchema;
      }
    }
    
    // If not in cache or cache disabled, build from database
    const databases = await getAllDatabases();
    const schemaContext = {};
    
    for (const database of databases) {
      // Skip system databases
      if (['information_schema', 'mysql', 'performance_schema', 'sys'].includes(database)) {
        continue;
      }
      
      try {
        schemaContext[database] = await getDatabaseSchema(database, false);
      } catch (error) {
        console.error(`Skipping database ${database} due to error:`, error.message);
        // Continue with other databases even if one fails
      }
    }
    
    // Save to cache for future use
    await schemaCache.saveSchemaToCache(schemaContext);
    
    return schemaContext;
  } catch (error) {
    console.error('Error building schema context:', error.message);
    throw error;
  }
};

/**
 * Executes a custom SQL query
 * @param {string} sql - SQL query
 * @param {string} database - Database to use
 * @returns {array} - Query results
 */
const executeCustomQuery = async (sql, database) => {
  try {
    // Execute the custom query directly on the specified database
    const results = await db.executeQuery(sql, [], database);
    return results;
  } catch (error) {
    console.error('Error executing custom query:', error.message);
    throw error;
  }
};

module.exports = {
  getDatabaseSchema,
  getAllDatabases,
  buildSchemaContext,
  executeCustomQuery
}; 