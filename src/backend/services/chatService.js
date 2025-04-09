const openaiService = require('./openaiService');
const schemaService = require('./schemaService');
const schemaCache = require('./schemaCache');

/**
 * Detects which database a query is likely referring to
 * @param {string} query - The natural language query
 * @param {array} availableDatabases - List of available databases
 * @returns {string|null} - Most likely database name or null if can't determine
 */
const detectDatabaseFromQuery = (query, availableDatabases) => {
  if (!availableDatabases || availableDatabases.length === 0) {
    return null;
  }

  // Convert query to lowercase for comparison
  const queryLower = query.toLowerCase();
  
  // Check if the query directly mentions a database name
  for (const db of availableDatabases) {
    // Create variations of the database name to check
    const dbVariations = [
      db.toLowerCase(),                     // exact match
      db.toLowerCase().replace(/_/g, ' '),  // replace underscores with spaces
      db.toLowerCase().replace(/db$/, ''),  // remove 'db' suffix if present
      db.toLowerCase().replace(/_db$/, '')  // remove '_db' suffix if present
    ];
    
    // Check if any variation is mentioned in the query
    if (dbVariations.some(variant => queryLower.includes(variant))) {
      console.log(`Detected database ${db} from query`);
      return db;
    }
  }
  
  return null;
};

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
    // First, get available databases
    const allDatabases = await schemaService.getAllDatabases();
    const userDatabases = allDatabases.filter(db => 
      !['information_schema', 'mysql', 'performance_schema', 'sys'].includes(db)
    );
    
    // If no database specified, try to detect it from the query
    if (!database) {
      const detectedDatabase = detectDatabaseFromQuery(query, userDatabases);
      if (detectedDatabase) {
        database = detectedDatabase;
        console.log(`Automatically detected database: ${database}`);
      }
    }

    // Build schema context for the AI
    let schemaContext;
    
    // Try to get schema from cache first
    const cachedSchema = await schemaCache.loadCachedSchema();
    
    if (database) {
      // If database is specified or detected, get schema for just that database
      if (cachedSchema && cachedSchema[database]) {
        // Use cached schema if available
        schemaContext = { [database]: cachedSchema[database] };
        console.log(`Using cached schema for specific database: ${database}`);
      } else {
        // Fall back to fetching from database
        const databaseSchema = await schemaService.getDatabaseSchema(database);
        schemaContext = { [database]: databaseSchema };
        console.log(`Fetched schema for specific database: ${database}`);
      }
    } else {
      // Otherwise use cached schema if available, or build from all databases
      if (cachedSchema) {
        schemaContext = cachedSchema;
        console.log('Using complete cached schema');
      } else {
        // If no cache, check if query contains clues about possible database
        const possibleDBs = [];
        for (const db of userDatabases) {
          if (query.toLowerCase().includes(db.toLowerCase().replace(/_/g, ' ')) || 
              query.toLowerCase().includes(db.toLowerCase())) {
            possibleDBs.push(db);
          }
        }
        
        if (possibleDBs.length > 0) {
          // Only fetch schemas for databases that might be relevant
          schemaContext = {};
          for (const db of possibleDBs) {
            schemaContext[db] = await schemaService.getDatabaseSchema(db);
          }
          console.log(`Selectively fetched schemas for: ${possibleDBs.join(', ')}`);
        } else {
          // As last resort, build complete schema
          schemaContext = await schemaService.buildSchemaContext();
          console.log('Built complete schema context');
        }
      }
    }
    
    // Further reduce schema to only relevant tables
    const relevantSchema = identifyRelevantTables(query, schemaContext);
    
    // Generate SQL from the natural language query
    const sqlQuery = await openaiService.generateSQLFromNaturalLanguage(
      query, 
      schemaContext, // Pass the full schema instead of the reduced one
      database // Pass the selected database to focus on
    );
    
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
          targetDatabase = userDatabases[0];
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