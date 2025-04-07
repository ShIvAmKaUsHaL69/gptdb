const openaiService = require('./openaiService');
const schemaService = require('./schemaService');
const schemaCache = require('./schemaCache');

/**
 * Identifies potentially relevant tables based on query keywords
 * @param {string} query - The natural language query
 * @param {object} fullSchema - The complete schema context
 * @returns {object} - Reduced schema with only potentially relevant tables
 */
const identifyRelevantTables = (query, fullSchema) => {
  const reducedSchema = {};
  const queryLower = query.toLowerCase();
  const keywords = queryLower.split(/\s+/).filter(word => 
    word.length > 3 && 
    !['what', 'when', 'where', 'which', 'how', 'many', 'much', 'were', 'does', 'have'].includes(word)
  );
  
  console.log('Identifying relevant tables for query keywords:', keywords);
  
  // Check each database and table for keyword matches
  for (const dbName in fullSchema) {
    let dbRelevant = false;
    const relevantTables = {};
    
    // Check if database name matches any keyword
    if (keywords.some(keyword => dbName.toLowerCase().includes(keyword))) {
      dbRelevant = true;
    }
    
    // Check each table and its columns for matches
    for (const tableName in fullSchema[dbName]) {
      let tableRelevant = false;
      
      // Check if table name matches any keyword
      if (keywords.some(keyword => tableName.toLowerCase().includes(keyword))) {
        tableRelevant = true;
      }
      
      // Check if any column matches keywords
      for (const column of fullSchema[dbName][tableName]) {
        if (keywords.some(keyword => column.Field.toLowerCase().includes(keyword))) {
          tableRelevant = true;
          break;
        }
      }
      
      if (tableRelevant) {
        relevantTables[tableName] = fullSchema[dbName][tableName];
        dbRelevant = true;
      }
    }
    
    // If we found relevant tables or db name matches, include in reduced schema
    if (dbRelevant) {
      if (Object.keys(relevantTables).length > 0) {
        reducedSchema[dbName] = relevantTables;
      } else {
        // If no specific tables matched but DB name did, include all tables
        reducedSchema[dbName] = fullSchema[dbName];
      }
    }
  }
  
  // If no relevant tables found, return a sample of the schema
  if (Object.keys(reducedSchema).length === 0) {
    console.log('No specific relevance found, using a sample of the schema');
    
    // Take a sample from each database
    for (const dbName in fullSchema) {
      reducedSchema[dbName] = {};
      const tableNames = Object.keys(fullSchema[dbName]);
      const sampleSize = Math.min(3, tableNames.length);
      
      for (let i = 0; i < sampleSize; i++) {
        const tableName = tableNames[i];
        reducedSchema[dbName][tableName] = fullSchema[dbName][tableName];
      }
    }
  }
  
  return reducedSchema;
};

/**
 * Processes a natural language query to the database
 * @param {string} query - The natural language query
 * @param {string} database - Target database name (optional)
 * @returns {object} - Results and explanation
 */
const processNaturalLanguageQuery = async (query, database = null) => {
  try {
    // Build schema context for the AI
    let schemaContext;
    
    // Try to get schema from cache first
    const cachedSchema = await schemaCache.loadCachedSchema();
    
    if (database) {
      // If database is specified, get schema for just that database
      if (cachedSchema && cachedSchema[database]) {
        // Use cached schema if available
        schemaContext = { [database]: cachedSchema[database] };
      } else {
        // Fall back to fetching from database
        const databaseSchema = await schemaService.getDatabaseSchema(database);
        schemaContext = { [database]: databaseSchema };
      }
    } else {
      // Otherwise use cached schema if available, or build from all databases
      schemaContext = cachedSchema || await schemaService.buildSchemaContext();
    }
    
    // Identify relevant tables to reduce token usage
    const relevantSchema = identifyRelevantTables(query, schemaContext);
    
    // Generate SQL from the natural language query
    const sqlQuery = await openaiService.generateSQLFromNaturalLanguage(query, relevantSchema);
    
    // Check if the response is an error message
    if (!sqlQuery.toLowerCase().startsWith('select') && 
        !sqlQuery.toLowerCase().startsWith('show') &&
        !sqlQuery.toLowerCase().startsWith('describe')) {
      return {
        query: query,
        sql: null,
        results: null,
        explanation: sqlQuery  // Return the error explanation from OpenAI
      };
    }

    // Determine which database to query
    let targetDatabase = database;
    if (!targetDatabase) {
      // Extract database name from the first line of SQL (if using database.table syntax)
      const dbMatch = sqlQuery.match(/from\s+([a-zA-Z0-9_]+)\./i);
      if (dbMatch && dbMatch[1]) {
        targetDatabase = dbMatch[1];
      } else {
        // Use the first available non-system database
        const databases = Object.keys(relevantSchema);
        targetDatabase = databases[0];
        
        if (!targetDatabase) {
          const allDatabases = await schemaService.getAllDatabases();
          targetDatabase = allDatabases.find(db => !['information_schema', 'mysql', 'performance_schema', 'sys'].includes(db));
        }
      }
    }
    
    // Execute the generated SQL query
    const results = await schemaService.executeCustomQuery(sqlQuery, targetDatabase);
    
    // Get explanation of the results in natural language
    const explanation = await openaiService.explainResultsInNaturalLanguage(query, results);
    
    return {
      query: query,
      sql: sqlQuery,
      results: results,
      explanation: explanation
    };
  } catch (error) {
    console.error('Error processing natural language query:', error);
    return {
      query: query,
      sql: null,
      results: null,
      explanation: `I encountered an error: ${error.message}`
    };
  }
};

module.exports = {
  processNaturalLanguageQuery
}; 