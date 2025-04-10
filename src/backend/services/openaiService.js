const { OpenAI } = require('openai');
const dotenv = require('dotenv');

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Limits the schema context size to prevent token overflow
 * @param {object} databaseSchema - Full database schema
 * @param {string|null} selectedDB - Selected database to focus on (optional)
 * @returns {object} - Schema with preserved relationships, focused on selected DB if provided
 */
const limitSchemaContext = (databaseSchema, selectedDB = null) => {
  // If a specific database is selected, only include that one with full details
  if (selectedDB && databaseSchema[selectedDB]) {
    // Return only the selected database with full details
    return { [selectedDB]: databaseSchema[selectedDB] };
  }
  
  // Otherwise, include all databases but check if we need to reduce size
  const reducedSchema = {};
  
  // Process each database
  for (const dbName in databaseSchema) {
    reducedSchema[dbName] = {};
    
    // Process each table in the database
    for (const tableName in databaseSchema[dbName]) {
      // Keep all column information including relationships
      reducedSchema[dbName][tableName] = databaseSchema[dbName][tableName].map(col => {
        const colInfo = {
          Field: col.Field,
          Type: col.Type,
          Key: col.Key
        };
        
        // Preserve References/relationship information
        if (col.References) {
          colInfo.References = col.References;
        }
        
        return colInfo;
      });
    }
  }
  
  // Check size and further reduce if needed, but only for non-relationship fields
  const jsonSize = JSON.stringify(reducedSchema).length;
  if (jsonSize > 50000) { // Increased threshold
    console.log(`Schema context too large (${jsonSize} chars), optimizing large databases`);
    
    // For very large databases, consider keeping only essential columns
    for (const dbName in reducedSchema) {
      const tableCount = Object.keys(reducedSchema[dbName]).length;
      
      // If this database has many tables, we'll be more aggressive in reduction
      if (tableCount > 15) {
        for (const tableName in reducedSchema[dbName]) {
          reducedSchema[dbName][tableName] = reducedSchema[dbName][tableName].map(col => {
            const essentialCol = {
              Field: col.Field,
              Key: col.Key
            };
            
            // Always preserve relationship information
            if (col.References) {
              essentialCol.References = col.References;
            }
            
            return essentialCol;
          });
        }
      }
    }
  }
  
  return reducedSchema;
};

/**
 * Converts natural language query to SQL using ChatGPT
 * @param {string} query - The natural language query
 * @param {object} databaseSchema - Information about the database schema
 * @param {string|null} selectedDB - Selected database to focus on (optional)
 * @returns {string} - The generated SQL query
 */
const generateSQLFromNaturalLanguage = async (query, databaseSchema, selectedDB = null) => {
  try {
    // Pass the selected database to focus on if provided
    const focusedSchema = limitSchemaContext(databaseSchema, selectedDB);

    console.log(focusedSchema);
    
    // Try with GPT-4 first
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: `You are a helpful SQL query generator. Your task is to convert natural language into valid SQL queries.
            
            Here is the database schema information:
            ${JSON.stringify(focusedSchema, null, 2)}
            
            Important instructions:
            1. Generate ONLY the SQL query without ANY explanations or comments.
            2. Even if the query requires joins or subqueries to connect tables, still return ONLY the SQL.
            3. Do not prefix your response with text like "SQL:" or similar.
            4. If a query needs to find information based on a name or other identifier that requires joining tables, always produce a valid SQL query.
            5. For complex queries involving multiple tables, use appropriate JOIN statements.
            6. Do NOT return text explaining why you can't generate a query - if it's possible to write SQL for the request, write it.
            7. Your response must begin with SQL keywords like SELECT, INSERT, UPDATE, etc.`
          },
          {
            role: "user",
            content: query
          }
        ],
        temperature: 0.2,
        max_tokens: 500
      });
  
      return completion.choices[0].message.content.trim();
    } catch (error) {
      // If we hit a token limit error, try with a more efficient model
      if (error.code === 'rate_limit_exceeded' && error.type === 'tokens') {
        console.log('Falling back to more efficient model due to token limits');
        
        // Further reduce schema by keeping only table names and primary key columns
        const minimalSchema = {};
        for (const dbName in focusedSchema) {
          minimalSchema[dbName] = {};
          for (const tableName in focusedSchema[dbName]) {
            // Only keep primary key columns
            const primaryKeys = focusedSchema[dbName][tableName]
              .filter(col => col.Key === 'PRI')
              .map(col => col.Field);
              
            minimalSchema[dbName][tableName] = primaryKeys.length > 0 
              ? `Primary keys: ${primaryKeys.join(', ')}` 
              : 'No primary keys';
          }
        }
        console.log(minimalSchema);
        
        // Try with gpt-3.5-turbo which has higher token limits
        const fallbackCompletion = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "system",
              content: `You are a helpful SQL query generator. Your task is to convert natural language into valid SQL queries.
              
              Here is the minimal database schema information:
              ${JSON.stringify(minimalSchema, null, 2)}
              
              Important instructions:
              1. Generate ONLY the SQL query without ANY explanations or comments.
              2. Even if the query requires joins or subqueries to connect tables, still return ONLY the SQL.
              3. Do not prefix your response with text like "SQL:" or similar.
              4. If a query needs to find information based on a name or other identifier that requires joining tables, always produce a valid SQL query.
              5. For complex queries involving multiple tables, use appropriate JOIN statements.
              6. Do NOT return text explaining why you can't generate a query - if it's possible to write SQL for the request, write it.
              7. Your response must begin with SQL keywords like SELECT, INSERT, UPDATE, etc.`
            },
            {
              role: "user",
              content: query
            }
          ],
          temperature: 0.2,
          max_tokens: 500
        });
        
        return fallbackCompletion.choices[0].message.content.trim();
      } else {
        // Rethrow other errors
        throw error;
      }
    }
  } catch (error) {
    console.error('Error generating SQL from natural language:', error);
    throw new Error('Failed to convert your query to SQL');
  }
};

/**
 * Explains the SQL query results in natural language
 * @param {string} query - The original natural language query
 * @param {array} results - The SQL query results
 * @returns {string} - Natural language explanation of the results
 */
const explainResultsInNaturalLanguage = async (query, results) => {
  try {
    // Limit the number of result rows to prevent token overflow
    const limitedResults = Array.isArray(results) && results.length > 10 
      ? results.slice(0, 10) : results;
    
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: `You are a helpful assistant that explains database query results in natural language.
            Your task is to provide a clear, concise explanation of the query results.`
          },
          {
            role: "user",
            content: `Original question: "${query}"
            
            Query results: ${JSON.stringify(limitedResults, null, 2)}
            ${Array.isArray(results) && results.length > 10 ? `(Showing first 10 of ${results.length} results)` : ''}
            
            Please explain these results in a conversational way.`
          }
        ],
        temperature: 0.7,
        max_tokens: 500
      });
  
      return completion.choices[0].message.content.trim();
    } catch (error) {
      // If we hit a token limit error, try with a more efficient model
      if (error.code === 'rate_limit_exceeded' && error.type === 'tokens') {
        console.log('Falling back to more efficient model for explanation due to token limits');
        
        // Try with gpt-3.5-turbo
        const fallbackCompletion = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "system",
              content: `You are a helpful assistant that explains database query results in natural language.
              Your task is to provide a clear, concise explanation of the query results.`
            },
            {
              role: "user",
              content: `Original question: "${query}"
              
              Query results: ${JSON.stringify(limitedResults, null, 2)}
              ${Array.isArray(results) && results.length > 10 ? `(Showing first 10 of ${results.length} results)` : ''}
              
              Please explain these results in a conversational way.`
            }
          ],
          temperature: 0.7,
          max_tokens: 500
        });
        
        return fallbackCompletion.choices[0].message.content.trim();
      } else {
        // Rethrow other errors
        throw error;
      }
    }
  } catch (error) {
    console.error('Error explaining results in natural language:', error);
    throw new Error('Failed to explain the query results');
  }
};

module.exports = {
  generateSQLFromNaturalLanguage,
  explainResultsInNaturalLanguage
}; 