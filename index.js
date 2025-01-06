

const express = require('express');
const path = require('path');
const { CosmosClient } = require('@azure/cosmos');
const bodyParser = require('body-parser');
const session = require('express-session');
const crypto = require('crypto');
const fs = require('fs');
const cron = require('node-cron');
// Load environment variables from the .env file
require('dotenv').config();

// Replace these values with your actual Cosmos DB account details
const endpoint = process.env.SECRET_API_KEY;;
const key = process.env.AZURE_COSMOSDB_KEY;;
const databaseId = 'linkboxDB';
const containerId = 'devices';

const client = new CosmosClient({ endpoint, key });
const app = express();
const port = 3000;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json()); // To parse JSON requests

async function connectToCosmos() {
  const database = client.database(databaseId);
  const container = database.container(containerId);
  return container;
}

// Generate a random secret key
const secretKey = crypto.randomBytes(64).toString('hex');

// Session middleware with auto-generated secret key
app.use(
  session({
    secret: secretKey, // Use the auto-generated secret key
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // Set to true if using HTTPS
      maxAge: 1000 * 60 * 60, // 1 hour
    },
  })
);
// Middleware to check if user is authenticated
function isAuthenticated(req, res, next) {
  if (req.session.user) {
    return next(); // If user is logged in, proceed to the route
  } else {
    return res.status(401).json({ message: 'Please log in to access this resource' });
  }
}
// Helper function to read JSON data
function readJsonFileSync(filepath) {
  const data = fs.readFileSync(filepath, 'utf-8');
  return JSON.parse(data);
}

// Login API
app.post('/login', async (req, res) => {
  // Run expiration check and disable devices as necessary
  await checkAndDisableExpiredDevices();

  const { username, password } = req.body;

  // Read the JSON file containing user credentials
  const users = readJsonFileSync(path.join(__dirname, 'users.json'));

  // Check if username and password match
  const user = users.find(u => u.username === username && u.password === password);

  if (user) {
    // Set session data
    req.session.user = { username };
    console.log("login");

    // Get updated devices after expiration check
    const container = await connectToCosmos();
    const querySpec = {
      query: 'SELECT * FROM c',
    };

    const { resources: devices } = await container.items.query(querySpec).fetchAll();

    // Send the updated devices along with the login success response
    return res.redirect('/main.html');
  } else {
    res.status(401).json({
      message: 'Invalid username or password',
    });
  }
});


// Logout API
app.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Error destroying session:', err);
      return res.status(500).json({ message: 'Failed to log out' });
    }
    res.clearCookie('connect.sid');
    console.log("logout")
    res.json({ message: 'Logout successful' });
  });
});

// GET all devices
app.get('/devices',isAuthenticated, async (req, res) => {
  try {
    const container = await connectToCosmos();
    const querySpec = {
      query: 'SELECT * FROM c'
    };
    const { resources: devices } = await container.items.query(querySpec).fetchAll();
    res.json(devices);
  } catch (error) {
    console.error('Error fetching devices:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Helper function to get the current date in DD/MM/YYYY format
function getCurrentDate() {
  const date = new Date();
  const day = String(date.getDate()).padStart(2, '0'); // Add leading zero if day is single digit
  const month = String(date.getMonth() + 1).padStart(2, '0'); // Add leading zero if month is single digit
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

// Helper function to get the date one year from now in DD/MM/YYYY format
function getOneYearFromNow() {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1); // Add one year
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

// POST new device
app.post('/devices', isAuthenticated, async (req, res) => {
  try {
    const container = await connectToCosmos();
    const deviceId = `device_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const timestamp = getCurrentDate();
    const device = {
      id: deviceId,
      deviceId: deviceId,
      name: '', // Default empty name
      license: req.body.license || 'disabled',
      timestamp: timestamp,
      enabledAt: req.body.license === 'enabled' ? timestamp : null,
      disabledAt: req.body.license === 'disabled' ? timestamp : null,
      expirationDate: null, // Initially empty expiration date
    };

    const { resource: createdDevice } = await container.items.create(device);
    res.json(createdDevice);
  } catch (error) {
    console.error('Error adding device:', error);
    res.status(500).send('Internal Server Error');
  }
});

// PUT toggle device license
app.put('/devices/:deviceId/toggle', isAuthenticated, async (req, res) => {
  try {
    const container = await connectToCosmos();
    const { deviceId } = req.params;

    // Retrieve the device by deviceId
    const { resource: device } = await container.item(deviceId, deviceId).read();
    if (!device) {
      return res.status(404).send('Device not found');
    }

    // Toggle the license
    const currentDate = getCurrentDate(); // Use the helper function for current date
    if (device.license === 'enabled') {
      device.license = 'disabled';
      device.disabledAt = currentDate; // Set the disabled date
      device.expirationDate = null; // Reset expiration date when disabled
    } else {
      device.license = 'enabled';
      device.enabledAt = currentDate; // Set the enabled date
      device.expirationDate = getOneYearFromNow(); // Set expiration date to one year from now
    }

    await container.item(deviceId, deviceId).replace(device);
    res.json(device);
  } catch (error) {
    console.error('Error toggling license:', error);
    res.status(500).send('Internal Server Error');
  }
});


// PUT update device name
app.put('/devices/:deviceId/name',isAuthenticated, async (req, res) => {
  try {
    const container = await connectToCosmos();
    const { deviceId } = req.params;
    const { name } = req.body;

    // Retrieve the device by deviceId
    const { resource: device } = await container.item(deviceId, deviceId).read();
    if (!device) {
      return res.status(404).send('Device not found');
    }

    // Update the name
    device.name = name;
    
    await container.item(deviceId, deviceId).replace(device);
    res.json(device);
  } catch (error) {
    console.error('Error updating name:', error);
    res.status(500).send('Internal Server Error');
  }
});




// DELETE device
app.delete('/devices/:deviceId',isAuthenticated, async (req, res) => {
  try {
    const container = await connectToCosmos();
    const { deviceId } = req.params;

    // Query to check if the device exists (optional but useful for debugging)
    const querySpec = {
      query: "SELECT * FROM c WHERE c.deviceId = @deviceId",
      parameters: [
        { name: "@deviceId", value: deviceId }
      ]
    };

    const { resources: devices } = await container.items.query(querySpec).fetchAll();

    if (devices.length === 0) {
      return res.status(404).send('Device not found');
    }

    // Assuming the partitionKey is 'deviceId', make sure to use the correct partition key if different
    const partitionKey = deviceId; // Replace with the actual partition key field if different

    // Delete the device using the correct id and partition key
    await container.item(deviceId, partitionKey).delete();

    res.status(204).send(); // No content, successful deletion
  } catch (error) {
    console.error('Error deleting device:', error);
    res.status(500).send('Internal Server Error');
  }
});


// Function to disable devices with expired expiration dates
async function checkAndDisableExpiredDevices() {
  try {
    const container = await connectToCosmos();
    
    // Get the current date in DD/MM/YYYY format
    const currentDate = getCurrentDate();
    
    // Query to find devices where the expirationDate is less than the current date
    const querySpec = {
      query: "SELECT * FROM c WHERE c.expirationDate <= @currentDate AND c.license = 'enabled'",
      parameters: [
        { name: "@currentDate", value: currentDate }
      ]
    };

    const { resources: devices } = await container.items.query(querySpec).fetchAll();

    // Loop through each expired device and disable it
    for (const device of devices) {
      device.license = 'disabled';
      device.disabledAt = currentDate; // Set the disabled date
      device.expirationDate = null; // Reset expiration date

      // Update the device status
      await container.item(device.id, device.id).replace(device);
      console.log(`Device ${device.deviceId} has been disabled due to expiration.`);
    }
  } catch (error) {
    console.error('Error checking and disabling expired devices:', error);
  }
}

// Schedule the task to run once every day at midnight
cron.schedule('0 0 * * *', () => {
  console.log('Checking for expired devices...');
  checkAndDisableExpiredDevices();
});



// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});