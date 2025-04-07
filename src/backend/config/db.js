const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

// Create connection pools for each database
const pools = {};

// Get or create a pool for a specific database
const getPool = (database) => {
  if (!pools[database]) {
    pools[database] = mysql.createPool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: database,
      port: process.env.DB_PORT || 3306,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
  }
  return pools[database];
};

// Default pool for initial connections
const defaultPool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test database connection
const testConnection = async () => {
  try {
    const connection = await defaultPool.getConnection();
    console.log('Database connection established successfully');
    connection.release();
    return true;
  } catch (error) {
    console.error('Error connecting to database:', error.message);
    return false;
  }
};

// Execute query with parameters on specific database
const executeQuery = async (sql, params = [], database = null) => {
  try {
    // Use the appropriate pool based on the database parameter
    const pool = database ? getPool(database) : defaultPool;
    const [results] = await pool.execute(sql, params);
    return results;
  } catch (error) {
    console.error('Error executing query:', error.message);
    throw error;
  }
};

// Get all available databases
const getDatabases = async () => {
  try {
    const [results] = await defaultPool.execute('SHOW DATABASES');
    return results.map(db => db.Database);
  } catch (error) {
    console.error('Error fetching databases:', error.message);
    throw error;
  }
};

// Get all tables in a database
const getTables = async (database) => {
  try {
    // Create a direct query to the specific database
    const pool = getPool(database);
    const [results] = await pool.execute('SHOW TABLES');
    const tableKey = `Tables_in_${database}`;
    return results.map(table => table[tableKey]);
  } catch (error) {
    console.error(`Error fetching tables from ${database}:`, error.message);
    throw error;
  }
};

// Get table schema
const getTableSchema = async (database, table) => {
  try {
    // Create a direct query to the specific database
    const pool = getPool(database);
    const [results] = await pool.execute(`DESCRIBE ${table}`);
    return results;
  } catch (error) {
    console.error(`Error fetching schema for ${database}.${table}:`, error.message);
    throw error;
  }
};

module.exports = {
  defaultPool,
  getPool,
  testConnection,
  executeQuery,
  getDatabases,
  getTables,
  getTableSchema
}; 