const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Load environment variables
dotenv.config();

// Import routes
const dbRoutes = require('./routes/dbRoutes');
const chatRoutes = require('./routes/chatRoutes');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Ensure temp directories exist
const tmpUploadsDir = path.join(__dirname, '../../tmp/uploads');
if (!fs.existsSync(tmpUploadsDir)) {
  fs.mkdirSync(tmpUploadsDir, { recursive: true });
  console.log('Created temporary uploads directory');
}

// Ensure config directory exists
const configDir = path.join(__dirname, '../../config');
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
  console.log('Created config directory');
}

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../../public')));

// Routes
app.use('/api/db', dbRoutes);
app.use('/api/chat', chatRoutes);

// Serve the frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 