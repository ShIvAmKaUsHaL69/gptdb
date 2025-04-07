# Database ChatBot

A conversational interface for querying databases using natural language. This application allows users to ask questions about their database in plain English and receive understandable answers.

## Features

- Ask questions about your database in natural language
- View SQL queries generated from your questions
- See results in a well-formatted table
- Get explanations of query results in conversational language
- Support for multiple databases in phpMyAdmin
- Secure read-only access to databases

## Requirements

- Node.js (v14+)
- MySQL/MariaDB database
- OpenAI API key

## Setup

1. Clone this repository:
```
git clone <repository-url>
cd gptdb
```

2. Install dependencies:
```
npm install
```

3. Create a `.env` file from the example:
```
cp .env.example .env
```

4. Edit the `.env` file with your MySQL and OpenAI API credentials:
```
# Database Configuration
DB_HOST=localhost
DB_USER=your_database_user
DB_PASS=your_database_password
DB_NAME=your_database_name
DB_PORT=3306

# OpenAI API Configuration
OPENAI_API_KEY=your_openai_api_key

# Server Configuration
PORT=3000
NODE_ENV=development
```

5. Start the application:
```
npm start
```

For development with auto-restart:
```
npm run dev
```

6. Open your browser and navigate to `http://localhost:3000`

## Usage

1. Select a specific database from the dropdown menu or leave it as "All Databases" to query across all available databases
2. Type your question in natural language, for example:
   - "How many students were absent this month?"
   - "Show me the total sales by region for the last quarter"
   - "Which products have the highest inventory levels?"
3. Press Enter or click the Send button
4. View the results and explanation

## Security

This application is designed with security in mind:

- Only read-only queries (SELECT, SHOW, DESCRIBE) are allowed
- SQL injection is prevented through proper parameter handling
- Database credentials are stored securely in environment variables
- The OpenAI API calls are structured to prevent prompt injection

## Architecture

- **Backend**: Node.js with Express
- **Database**: MySQL/MariaDB (via phpMyAdmin)
- **Natural Language Processing**: OpenAI GPT API
- **Frontend**: HTML/CSS/JavaScript with Bootstrap 5

## Limitations

- Currently only supports MySQL/MariaDB databases
- Limited to SELECT queries for security reasons
- Requires accurate database schema information for optimal results
- Complex or ambiguous questions might return imprecise results

## License

MIT 