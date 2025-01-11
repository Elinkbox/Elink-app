let passwordAction = null;
let actionDeviceId = null;
let originalEmail = '';  // This should be the actual fetched email

// Fetch email on page load
window.onload = function() {
  fetch('/api/get-email')  // Make an API call to get the email
  .then(response => response.json())
  .then(data => {
    if (data.email) {
      originalEmail = data.email;
      document.getElementById('emailField').innerText = originalEmail;  // Display the fetched email
    }
  })
  .catch(error => {
    console.error('Error fetching email:', error);
  });
}

// Ask for password before allowing email edit
function askForPasswordToEditEmail() {
  passwordAction = 'editEmail';  // Set action for email edit
  document.getElementById('passwordInput').value = ''; // Clear previous input
  document.getElementById('passwordModal').style.display = 'flex';  // Show the password modal
}

// Show email input when double-clicked on the email field
function editEmail() {
  // Show password modal first before editing email
  askForPasswordToEditEmail();
}

// Handle password submission for email edit
async function submitPassword() {
  const password = document.getElementById('passwordInput').value;

  if (!password) {
    alert('Password cannot be empty!');
    return;
  }

  try {
    const response = await fetch('/validate-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    const data = await response.json();

    if (data.success) {
      // If password is valid, proceed to email editing
      if (passwordAction === 'editEmail') {
        showEmailInput();
      }
      // Close the password modal
      closePasswordModal();
    } else {
      alert('Invalid password. Please try again.');
    }
  } catch (error) {
    console.error('Error validating password:', error);
    alert('An error occurred. Please try again.');
  }
}

// Function to display email input field for editing
function showEmailInput() {
  const emailField = document.getElementById('emailField');
  const emailInput = document.getElementById('emailInput');
  const saveCancelButtons = document.querySelector('.save-cancel-buttons');

  emailField.style.display = 'none';
  emailInput.style.display = 'inline-block';
  saveCancelButtons.style.display = 'inline-block';

  emailInput.value = emailField.innerText;  // Pre-populate with current email
  emailInput.focus();
}

// Save the email after editing
function saveEmail() {
  const emailInput = document.getElementById('emailInput');
  const emailField = document.getElementById('emailField');
  const saveCancelButtons = document.querySelector('.save-cancel-buttons');

  const newEmail = emailInput.value.trim();

  // If email is not empty and has changed
  if (newEmail !== originalEmail && newEmail !== '') {
    // Send API request to save the new email
    fetch('/api/update-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email: newEmail })
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        originalEmail = newEmail;
        emailField.innerText = newEmail;
        alert('Email updated');
      } else {
        alert('Error updating email. Please try again.');
      }
    })
    .catch(err => {
      console.error('Error:', err);
      alert('Error updating email. Please try again.');
    });
  }

  emailInput.style.display = 'none';
  emailField.style.display = 'inline-block';
  saveCancelButtons.style.display = 'none';
}

// Handle the escape or enter key press to save or cancel email editing
function handleKeyUp(event) {
  if (event.key === 'Enter') {
    saveEmail();
  } else if (event.key === 'Escape') {
    cancelEmailEdit();
  }
}

// Revert to original email on cancel
function cancelEmailEdit() {
  const emailInput = document.getElementById('emailInput');
  const emailField = document.getElementById('emailField');
  const saveCancelButtons = document.querySelector('.save-cancel-buttons');

  emailInput.style.display = 'none';
  emailField.style.display = 'inline-block';
  saveCancelButtons.style.display = 'none';

  emailInput.value = originalEmail;
}
function askForPassword(action, deviceId = null) {
  passwordAction = action;
  actionDeviceId = deviceId;
  document.getElementById('passwordInput').value = ''; // Clear previous input
  document.getElementById('passwordModal').style.display = 'flex';
}

// Close the password modal
function closePasswordModal() {
  passwordAction = null;
  actionDeviceId = null;
  document.getElementById('passwordModal').style.display = 'none';
}



async function submitPassword() {
  const password = document.getElementById('passwordInput').value;

  if (!password) {
    alert('Password cannot be empty!');
    return;
  }

  try {
    const response = await fetch('/validate-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    const data = await response.json();

    if (data.success) {

      // Perform the appropriate action based on passwordAction
      switch (passwordAction) {
        case 'editEmail':
          showEmailInput(); // Show the email input for editing
          break;
        case 'add':
          await addDevice();
          break;
        case 'toggle':
          if (actionDeviceId) {
            await toggleLicense(actionDeviceId);
          }
          break;
        case 'delete':
          if (actionDeviceId) {
            await deleteDevice(actionDeviceId);
          }
          break;
        default:
          console.error('Unknown action:', passwordAction); // Log the issue
          alert('An unexpected error occurred. Please try again.');
      }
      // Close the modal after the action is completed
      closePasswordModal();
    } else {
      alert('Invalid password. Please try again.');
    }
  } catch (error) {
    console.error('Error validating password:', error);
    alert('An error occurred. Please try again.');
  }
}

function editName(deviceId) {
  const nameSpan = document.getElementById(`name-${deviceId}`);
  const currentName = nameSpan.textContent.trim();  // Trim the current name to remove extra spaces
  nameSpan.innerHTML = `<input type="text" id="input-${deviceId}"  class="editable-input" value="${currentName}" />`;
  document.getElementById(`save-${deviceId}`).style.display = 'inline';
  document.getElementById(`cancel-${deviceId}`).style.display = 'inline';
}

async function saveName(deviceId) {
  const input = document.getElementById(`input-${deviceId}`);
  const newName = input.value.trim();  // Trim spaces before saving the name

  if (newName === "") {
    alert("Device name cannot be empty!");
    return;
  }

  const response = await fetch(`/devices/${deviceId}/name`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName }),
  });

  if (response.ok) {
    fetchDevices();
  } else {
    alert('Error updating name');
  }
}


function cancelEdit(deviceId, originalName) {
  const nameSpan = document.getElementById(`name-${deviceId}`);
  nameSpan.innerHTML = originalName || 'Unnamed';
  document.getElementById(`save-${deviceId}`).style.display = 'none';
  document.getElementById(`cancel-${deviceId}`).style.display = 'none';
}

async function addDevice() {
  try {
    const response = await fetch(`/devices`, { method: 'POST' });
    if (response.ok) {
      await fetchDevices();
      alert('Device added successfully!');
    } else {
      alert('Failed to add device.');
    }
  } catch (error) {
    console.error('Error adding device:', error);
  }
}

async function toggleLicense(deviceId) {
  try {
    const response = await fetch(`/devices/${deviceId}/toggle`, { method: 'PUT' });
    if (response.ok) {
      const data = await response.json();  // Get the response data
      await fetchDevices();
            // Display the updated device license status with alert
            alert(`ID: ${data.deviceId} is now ${data.license}.`);
    } else {
      alert('Failed to toggle license.');
    }
  } catch (error) {
    console.error('Error toggling license:', error);
  }
}

async function deleteDevice(deviceId) {
  try {
    const response = await fetch(`/devices/${deviceId}`, { method: 'DELETE' });
    if (response.ok) {
      await fetchDevices();
      alert('Device deleted successfully!');
    } else {
      alert('Failed to delete device.');
    }
  } catch (error) {
    console.error('Error deleting device:', error);
  }
}

async function fetchDevices() {
  try {
    const response = await fetch(`/devices`);
    const devices = await response.json();
    const deviceList = document.getElementById('deviceList');
    deviceList.innerHTML = '';

    devices.forEach(device => {
      const createdAt = formatDate(device.timestamp);
      const lastAction = device.license === 'enabled'
        ? `Enabled at: ${formatDate(device.enabledAt)}`
        : `Disabled at: ${formatDate(device.disabledAt)}`;

      const expirationDate = device.expirationDate
        ? formatDate(device.expirationDate)
        : 'N/A';

      const row = document.createElement('tr');
      row.innerHTML = `
        <td>
          <span id="name-${device.deviceId}" class="editable" ondblclick="editName('${device.deviceId}')">
            ${device.name || 'Unnamed'}
          </span>
          <button class="save-btn" style="display:none;" id="save-${device.deviceId}" onclick="saveName('${device.deviceId}')">Save</button>
          <button class="cancel-edit-btn" style="display:none;" id="cancel-${device.deviceId}" onclick="cancelEdit('${device.deviceId}', '${device.name || 'Unnamed'}')">Cancel</button>
        </td>
        <td>${device.deviceId}</td>
        <td>${createdAt}</td>
        <td class="${device.license === 'enabled' ? 'enabled-status' : 'disabled-status'}">${device.license}</td>
        <td>${expirationDate}</td>
        <td>
          <div class="button-container">
            <button class="action-btn ${device.license === 'enabled' ? 'disabled-btn' : 'enabled-btn'}" onclick="askForPassword('toggle', '${device.deviceId}')">
              ${device.license === 'enabled' ? 'Disable' : 'Enable'}
            </button>
            <button class="delete-btn" onclick="askForPassword('delete', '${device.deviceId}')">Delete</button>
          </div>
        </td>
      `;
      deviceList.appendChild(row);
    });
  } catch (error) {
    console.error('Error fetching devices:', error);
  }
}

document.getElementById('addDeviceBtn').addEventListener('click', () => {
  askForPassword('add');
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  try {
    const response = await fetch(`/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (response.ok) {
      await fetch('/');  // This step can be adjusted if needed, but it's an example to trigger the login page fetch
      window.location.href = '/index.html'; // Adjust the URL to your login page
    } else {
      alert('Logout failed');
    }
  } catch (error) {
    console.error('Error logging out:', error);
  }
});

function formatDate(dateString) {
  return dateString; // Adjust this to your preferred date format if needed
}

// Initial fetch of devices
fetchDevices();
