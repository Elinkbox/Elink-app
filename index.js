const express = require('express');
const path = require('path');
const { CosmosClient } = require('@azure/cosmos');
const bodyParser = require('body-parser');
const session = require('express-session');
const crypto = require('crypto');
const fs = require('fs');
const cron = require('node-cron');
const cors = require('cors'); // Import cors
const nodemailer = require("nodemailer");

// Load environment variables from the .env file
require('dotenv').config();

// Replace these values with your actual Cosmos DB account details
const endpoint = process.env.SECRET_API_KEY;
const key = process.env.AZURE_COSMOSDB_KEY;
const databaseId = 'linkboxDB';
const containerId = 'devices';

const client = new CosmosClient({ endpoint, key });
const app = express();
const port = process.env.PORT || 3000;

// CORS middleware configuration
const corsOptions = {
  origin: ['https://elink-ui.azurewebsites.net', 'http://localhost:3000'], // Allow all origins (for more security, specify the allowed origins here)
  methods: 'GET,POST,PUT,DELETE',
  allowedHeaders: 'Content-Type,Authorization',
};

// Apply CORS middleware
app.use(cors(corsOptions));

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
  // await checkAndDisableExpiredDevices();
  // await notifyDevicesExpiringSoon()
  const { username, password } = req.body;

  // Read the JSON file containing user credentials
  const users = readJsonFileSync(path.join(__dirname, 'users.json'));

  // Check if username and password match
  const user = users.find(u => u.username === username && u.password === password);

  if (user) {
    // Set session data
    req.session.user = { username };
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
    res.json({ message: 'Logout successful' });
  });
});

// GET all devices
app.get('/devices', isAuthenticated, async (req, res) => {
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
app.put('/devices/:deviceId/name', isAuthenticated, async (req, res) => {
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
app.delete('/devices/:deviceId', isAuthenticated, async (req, res) => {
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

// Function to disable devices with expired expiration dates and send email notification
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

    // If there are expired devices, gather their data
    const expiredDevices = [];
    
    // Loop through each expired device and disable it
    for (const device of devices) {
      device.license = 'disabled';
      device.disabledAt = currentDate; // Set the disabled date
      device.expirationDate = null; // Reset expiration date

      // Update the device status
      await container.item(device.id, device.id).replace(device);
      console.log(`Device ${device.deviceId} has been disabled due to expiration.`);

      // Add the device to the list for email notification
      expiredDevices.push({
        deviceId: device.deviceId,
        deviceName: device.name || "N/A",
        disabledAt: currentDate,
      });
    }

    // If there are expired devices, send an email
    if (expiredDevices.length > 0) {
      await sendExpiredNotificationEmail(expiredDevices, true); // true indicates it's expired
    } else {
      console.log("No devices expired today.");
    }

  } catch (error) {
    console.error('Error checking and disabling expired devices:', error);
  }
}

// Function to send an email notification with the expired devices
async function sendExpiredNotificationEmail(devices, isExpired = false) {
  try {
    // Ensure you have the required fields in the devices array
    if (!devices || devices.length === 0) {
      console.log("No devices to notify.");
      return;
    }

    // Generate the email subject and table rows
    const subject = isExpired ? "Expired Elinkbox Disabled Notification" : "Elinkbox Expired Notification";

    const tableRows = devices.map(device => `
      <tr>
        <td>${device.deviceName}</td>
        <td>${device.deviceId}</td>
        <td>${device.disabledAt}</td>
      </tr>
    `).join("");

    // Build the email body with a table
    const emailBody = `
      <h2>${subject}</h2>
      <p>The following Elinkbox have been disabled due to expiration:</p>
      <table border="1" style="border-collapse: collapse; width: 100%; text-align: left;">
        <thead>
          <tr>
            <th>Device Name</th>
            <th>Device ID</th>
            <th>Disabled At</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    `;

    // Configure the email transport using nodemailer
    const transporter = nodemailer.createTransport({
      service: "gmail", // Use your email service provider (e.g., Gmail, Outlook)
      auth: {
        user: process.env.EMAIL_USERNAME, // Same email for sending and receiving
        pass: process.env.EMAIL_PASSWORD, // Your email password or app-specific password
      },
    });

    // Email options
    const mailOptions = {
      from: process.env.EMAIL_USERNAME, // Sender's email
      to: process.env.EMAIL_RECEIVE, // Same email for receiving
      subject: subject,
      html: emailBody,
    };

    // Send the email
    await transporter.sendMail(mailOptions);
    console.log("Expiration notification email sent successfully!");
  } catch (error) {
    console.error("Error sending email:", error);
  }
}
// Function to notify devices expiring soon
async function notifyDevicesExpiringSoon() {
  try {
    const container = await connectToCosmos();

    // Calculate the dates 10 days and 3 days from now
    const now = new Date();
    const tenDaysLater = new Date(now);
    const threeDaysLater = new Date(now);
    tenDaysLater.setDate(tenDaysLater.getDate() + 10);
    threeDaysLater.setDate(threeDaysLater.getDate() + 3);
    
    const tenDaysAhead = getCurrentDateFromDateObject(tenDaysLater);
    const threeDaysAhead = getCurrentDateFromDateObject(threeDaysLater);
    console.log(tenDaysAhead, threeDaysAhead);

    // Query to find devices expiring exactly in 10 or 3 days
    const querySpec = {
      query: "SELECT * FROM c WHERE (c.expirationDate = @tenDaysAhead OR c.expirationDate = @threeDaysAhead) AND c.license = 'enabled'",
      parameters: [
        { name: "@tenDaysAhead", value: tenDaysAhead },
        { name: "@threeDaysAhead", value: threeDaysAhead }
      ]
    };

    const { resources: devices } = await container.items.query(querySpec).fetchAll();

    if (devices.length > 0) {
      // Add the `daysLeft` property to each device
      const currentDate = new Date();

      devices.forEach(device => {
        // Parse the expirationDate in DD/MM/YYYY format to a Date object
        const expirationDate = parseDate(device.expirationDate);

        // Ensure expirationDate is valid
        if (expirationDate) {
          const timeDiff = expirationDate.getTime() - currentDate.getTime();
          device.daysLeft = Math.ceil(timeDiff / (1000 * 3600 * 24)); // Days left until expiration
        } else {
          device.daysLeft = "Invalid Expiration Date"; // Handle invalid dates
        }
      });

      console.log(`Devices expiring soon: ${devices.map(device => device.deviceId).join(', ')}`);

      // Call the function to send the email with these device IDs
      await sendExpirationNotificationEmail(devices);
    } else {
      console.log('No devices expiring in 10 or 3 days.');
    }
  } catch (error) {
    console.error('Error notifying devices expiring soon:', error);
  }
}

// Function to parse DD/MM/YYYY date format to a Date object
function parseDate(dateStr) {
  const [day, month, year] = dateStr.split('/').map(Number);
  
  if (isNaN(day) || isNaN(month) || isNaN(year)) {
    return null; // Return null if the date is invalid
  }

  // Note: months in JS are 0-indexed (January is 0, February is 1, etc.)
  return new Date(year, month - 1, day);
}

// Function to send an email notification
async function sendExpirationNotificationEmail(devices) {
  try {
    // Ensure you have the required fields in the devices array
    if (!devices || devices.length === 0) {
      console.log("No devices to notify.");
      return;
    }

    // Generate the email subject and table rows
    const subject = "Elinkbox Expiring Notification";

    const tableRows = devices.map(device => `
      <tr>
        <td>${device.name || "N/A"}</td>
        <td>${device.deviceId}</td>
        <td>${device.expirationDate}</td>
        <td>${device.daysLeft || "N/A"}</td>
      </tr>
    `).join("");

    // Build the email body with a table
    const emailBody = `
      <h2>Elinkbox Expiring Soon</h2>
      <p>The following Elinkbox are nearing their expiration dates:</p>
      <table border="1" style="border-collapse: collapse; width: 100%; text-align: left;">
        <thead>
          <tr>
            <th>Device Name</th>
            <th>Device ID</th>
            <th>Expiration Date</th>
            <th>Days Left</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    `;

    // Configure the email transport using nodemailer
    const transporter = nodemailer.createTransport({
      service: "gmail", // Use your email service provider (e.g., Gmail, Outlook)
      auth: {
        user: process.env.EMAIL_USERNAME, // Same email for sending and receiving
        pass: process.env.EMAIL_PASSWORD, // Your email password or app-specific password
      },
    });

    // Email options
    const mailOptions = {
      from: process.env.EMAIL_USERNAME, // Sender's email
      to: process.env.EMAIL_RECEIVE, // Same email for receiving
      subject: subject,
      html: emailBody,
    };

    // Send the email
    await transporter.sendMail(mailOptions);
    console.log("Expiration notification email sent successfully!");
  } catch (error) {
    console.error("Error sending email:", error);
  }
}

// Utility function to format a Date object to DD/MM/YYYY
function getCurrentDateFromDateObject(dateObj) {
  const day = String(dateObj.getDate()).padStart(2, '0');
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const year = dateObj.getFullYear();
  return `${day}/${month}/${year}`;
}


// Schedule the task to run once every day at midnight UTC
cron.schedule('00 0 * * *', () => {
  console.log('Checking for expired devices...');
  checkAndDisableExpiredDevices();
  notifyDevicesExpiringSoon();
}, {
  scheduled: true,
  timezone: "UTC"  // Specify the timezone as UTC
});

// Endpoint to get the current email
app.get('/api/get-email', isAuthenticated, (req, res) => {
  const email = process.env.EMAIL_RECEIVE;
  if (email) {
    res.json({ email: email });
  } else {
    res.status(404).json({ error: 'Email not found' });
  }
});

// Endpoint to update the email
app.post('/api/update-email', isAuthenticated, (req, res) => {
  const { email } = req.body;

  if (email && validateEmail(email)) {
    // Update the email in the environment variable and .env file
    process.env.EMAIL_RECEIVE = email;

    // Update the .env file with the new email
    updateEnvFile('EMAIL_RECEIVE', email);

    res.json({ success: true, email: email });
  } else {
    res.status(400).json({ error: 'Invalid email address' });
  }
});

// Utility function to validate email
function validateEmail(email) {
  const re = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}$/;
  return re.test(String(email).toLowerCase());
}

// Function to update the .env file
function updateEnvFile(key, value) {
  const envFilePath = './.env';
  const envFile = fs.readFileSync(envFilePath, 'utf-8');

  // Replace the existing key value in the .env file
  const updatedEnvFile = envFile.replace(new RegExp(`^${key}=[^\n]*`, 'm'), `${key}=${value}`);

  // Write the updated .env file back to the filesystem
  fs.writeFileSync(envFilePath, updatedEnvFile, 'utf-8');
}

// Endpoint to validate the password
app.post('/validate-password', isAuthenticated, (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ success: false, message: 'Password is required' });
  }

  const adminPassword = process.env.CONFIRM_PASSWORD;

  if (password === adminPassword) {
    return res.status(200).json({ success: true, message: 'Password validated successfully' });
  } else {
    return res.status(401).json({ success: false, message: 'Invalid password' });
  }
});
// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
