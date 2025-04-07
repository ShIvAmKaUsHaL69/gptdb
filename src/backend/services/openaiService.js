const { OpenAI } = require('openai');
const dotenv = require('dotenv');

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Limits the schema context size to prevent token overflow
 * @param {object} databaseSchema - Full database schema
 * @returns {object} - Reduced schema with only essential information
 */
const limitSchemaContext = (databaseSchema) => {
  const reducedSchema = {};
  
  // Process each database
  for (const dbName in databaseSchema) {
    reducedSchema[dbName] = {};
    
    // Process each table in the database
    for (const tableName in databaseSchema[dbName]) {
      // Extract only essential column information
      const tableColumns = databaseSchema[dbName][tableName].map(col => ({
        Field: col.Field,
        Type: col.Type,
        Key: col.Key
      }));
      
      reducedSchema[dbName][tableName] = tableColumns;
    }
  }
  
  // Check size and further reduce if needed
  const jsonSize = JSON.stringify(reducedSchema).length;
  if (jsonSize > 20000) {
    console.log(`Schema context still too large (${jsonSize} chars), removing column types`);
    
    // Further reduce by keeping only column names and keys
    for (const dbName in reducedSchema) {
      for (const tableName in reducedSchema[dbName]) {
        reducedSchema[dbName][tableName] = reducedSchema[dbName][tableName].map(col => ({
          Field: col.Field,
          Key: col.Key
        }));
      }
    }
  }
  
  return reducedSchema;
};

/**
 * Converts natural language query to SQL using ChatGPT
 * @param {string} query - The natural language query
 * @param {object} databaseSchema - Information about the database schema
 * @returns {string} - The generated SQL query
 */
const generateSQLFromNaturalLanguage = async (query, databaseSchema) => {
  try {
    // Reduce schema size to prevent token limits
    const reducedSchema = limitSchemaContext(databaseSchema);
    
    // Try with GPT-4 first
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: `You are a helpful SQL query generator. Your task is to convert natural language into valid SQL queries.
            
            Here is the database schema information:
            ${JSON.stringify(reducedSchema, null, 2)}
            
            Generate only the SQL query without any explanations. If the query cannot be generated or is ambiguous, explain why.`
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
        for (const dbName in reducedSchema) {
          minimalSchema[dbName] = {};
          for (const tableName in reducedSchema[dbName]) {
            // Only keep primary key columns
            const primaryKeys = reducedSchema[dbName][tableName]
              .filter(col => col.Key === 'PRI')
              .map(col => col.Field);
              
            minimalSchema[dbName][tableName] = primaryKeys.length > 0 
              ? `Primary keys: ${primaryKeys.join(', ')}` 
              : 'No primary keys';
          }
        }
        
        // Try with gpt-3.5-turbo which has higher token limits
        const fallbackCompletion = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "system",
              content: `You are a helpful SQL query generator. Your task is to convert natural language into valid SQL queries.
              
              Here is the minimal database schema information:
              ${JSON.stringify(minimalSchema, null, 2)}
              
              Generate only the SQL query without any explanations. If the query cannot be generated or is ambiguous, explain why.`
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