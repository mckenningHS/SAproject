// ==========================================================
// UTILITY FUNCTIONS
// ==========================================================

const getInitials = (firstName, lastName) => {
  return `${firstName ? firstName[0].toUpperCase() : ""}${
    lastName ? lastName[0].toUpperCase() : ""
  }`;
};

// Function to create the HTML for a single contact row
const createContactRowHTML = (contact) => {
  const props = contact.properties || {};
  const name =
    `${props.firstname || ""} ${props.lastname || ""}`.trim() || "Unknown";
  const email = props.email || "";

  return `
          <div class="contact-row-wrapper" id="row-${contact.id}">
              <div class="contact-row">
                  <div class="col contact-col">
                      <div class="initials-badge">${getInitials(
                        props.firstname,
                        props.lastname
                      )}</div>
                      <div class="contact-details">
                          <span class="contact-name">
                            ${name}
                            <button id="btn-scan-${contact.id}" 
                                    onclick="checkOpportunity('${
                                      contact.id
                                    }', '${name}')"
                                    style="margin-left:10px; padding:2px 8px; font-size:0.7em; cursor:pointer; border:1px solid #ccc; background:#fff; border-radius:4px;">
                                ✨ Scan for Upsell
                            </button>
                          </span>
                          <span class="contact-title">${
                            props.jobtitle || props.company || ""
                          }</span>
                      </div>
                  </div>
                  <div class="col email-col">${email}</div>
                  <div class="col subscription-col">
                       <button class="btn-small" onclick="toggleDeals('${
                         contact.id
                       }')" style="cursor:pointer; padding:5px;">
                          Manage Subscriptions ▾
                       </button>
                  </div>
              </div>
              
              <div id="deals-${contact.id}" class="deals-container">
                  <strong>Active Subscriptions</strong>
                  <div id="deal-list-${contact.id}">Loading...</div>
                  
                  <form class="inline-form" onsubmit="handleDealSubmit(event, '${
                    contact.id
                  }')" style="display:flex; gap:10px; align-items:center; margin-top:10px;">
                      <select name="productSelect" style="flex:2; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                          <option value="bundle" data-name="Thermostat Hardware + Breezy Trial" data-amount="299">Thermostat HW + Trial ($299)</option>
                          <option value="annual" data-name="Breezy Premium (Annually)" data-amount="99">Breezy Premium (Annually) - $99</option>
                          <option value="monthly" data-name="Breezy Premium (Monthly)" data-amount="9.99">Breezy Premium (Monthly) - $9.99</option>
                      </select>
                      <button type="submit" class="simulate-button" style="margin:0; width:auto; padding: 8px 15px;">Add</button>
                  </form>
              </div>
          </div>
      `;
};

// ==========================================================
// CORE LOGIC
// ==========================================================

// Part 1A: Fetch contacts from your backend and render them
const fetchAndRenderContacts = async () => {
  const contactsListElement = document.getElementById("contactsList");
  const recordCountElement = document.getElementById("recordCount");

  contactsListElement.innerHTML = '<div class="loading-state">Loading...</div>';
  recordCountElement.textContent = "... Records";

  try {
    const response = await fetch("/api/contacts");
    const data = await response.json();
    const contacts = data.results || [];

    if (contacts.length === 0) {
      contactsListElement.innerHTML =
        '<div class="loading-state">No contacts found.</div>';
    } else {
      // Render Rows
      contactsListElement.innerHTML = contacts
        .map(createContactRowHTML)
        .join("");
    }
    recordCountElement.textContent = `${contacts.length} Records`;
  } catch (error) {
    console.error(error);
    contactsListElement.innerHTML = `<div class="loading-state" style="color: red">Error fetching contacts.</div>`;
  }
};

// Handle Manual AI Scan
window.checkOpportunity = async (contactId, contactName) => {
  const btn = document.getElementById(`btn-scan-${contactId}`);
  if (!btn) return;

  btn.textContent = "⏳ Scanning...";
  btn.disabled = true;
  btn.style.background = "#f5f5f5";
  btn.style.cursor = "wait";

  try {
    const response = await fetch("/api/ai/detect-opportunity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId, contactName }),
    });

    const data = await response.json();

    // Replace button with simple Badge (No Spend Amount)
    if (data.verdict === "High") {
      btn.outerHTML = `
                <span style="background:#e8f5e9; color:#2e7d32; padding:2px 6px; border-radius:4px; border:1px solid #a5d6a7; display:inline-flex; align-items:center; gap:4px; font-size:0.8em; margin-left:10px; cursor:help;" title="Insight: ${data.insight}">
                    ⚡ High Opportunity
                </span>
            `;
    } else {
      btn.outerHTML = `
                <span style="background:#f5f5f5; color:#666; padding:2px 6px; border-radius:4px; border:1px solid #ddd; font-size:0.8em; margin-left:10px;">
                    Low Priority
                </span>
            `;
    }
  } catch (error) {
    console.error(error);
    btn.textContent = "❌ Error";
    btn.style.color = "red";
  }
};

// ==========================================================
// DEAL & SYNC LOGIC
// ==========================================================

document.addEventListener("DOMContentLoaded", () => {
  fetchAndRenderContacts();
  document
    .getElementById("refreshButton")
    .addEventListener("click", fetchAndRenderContacts);
  document
    .getElementById("syncForm")
    .addEventListener("submit", handleSyncFormSubmit);
});

window.toggleDeals = (contactId) => {
  const panel = document.getElementById(`deals-${contactId}`);
  document
    .querySelectorAll(".deals-container")
    .forEach((el) => (el.style.display = "none"));
  if (panel.style.display === "none" || !panel.style.display) {
    panel.style.display = "block";
    fetchDeals(contactId);
  } else {
    panel.style.display = "none";
  }
};

const fetchDeals = async (contactId) => {
  const listEl = document.getElementById(`deal-list-${contactId}`);
  listEl.innerHTML = "Loading...";
  try {
    const res = await fetch(`/api/contacts/${contactId}/deals`);
    const data = await res.json();
    const deals = Array.isArray(data) ? data : data.results || [];

    if (deals.length === 0) {
      listEl.innerHTML =
        '<div style="color:#777; margin:5px 0;">No active subscriptions.</div>';
      return;
    }
    listEl.innerHTML = deals
      .map(
        (d) => `
          <div class="deal-card">
              <span>${d.properties.dealname} (${d.properties.dealstage})</span>
              <span style="font-weight:bold; color:green;">$${d.properties.amount}</span>
          </div>
      `
      )
      .join("");
  } catch (e) {
    listEl.innerHTML = "Error loading deals";
  }
};

window.handleDealSubmit = async (e, contactId) => {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector("button");
  const originalText = btn.textContent;
  const select = form.productSelect;
  const selectedOption = select.options[select.selectedIndex];
  const amount = selectedOption.getAttribute("data-amount");
  const dealName = selectedOption.getAttribute("data-name");

  btn.textContent = "Saving...";
  btn.disabled = true;

  try {
    const response = await fetch("/api/deals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId,
        dealProperties: {
          dealname: dealName,
          amount: amount,
          dealstage: "closedwon",
        },
      }),
    });
    if (!response.ok) throw new Error("Failed");
    form.reset();
    fetchDeals(contactId);
  } catch (err) {
    alert("Failed to create deal");
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
};

// Basic Sync Logic
const handleSyncFormSubmit = async (event) => {
  event.preventDefault();
  const form = event.target;
  const syncButton = form.querySelector('button[type="submit"]');
  const messageElement = document.getElementById("syncMessage");

  messageElement.style.display = "none";
  syncButton.disabled = true;
  syncButton.textContent = "Syncing...";

  const formData = new FormData(form);
  const properties = {};
  formData.forEach((value, key) => {
    if (value) properties[key] = value;
  });

  try {
    const response = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ properties }),
    });

    if (!response.ok) throw new Error("Failed to create contact.");

    const newContact = await response.json();
    messageElement.textContent = `Success! Contact ${newContact.properties.email} created.`;
    messageElement.classList.add("success");
    messageElement.style.display = "block";
    await fetchAndRenderContacts();
  } catch (error) {
    messageElement.textContent = `Sync Failed: ${error.message}`;
    messageElement.classList.remove("success");
    messageElement.style.backgroundColor = "#FCDADA";
    messageElement.style.color = "#C53030";
    messageElement.style.display = "block";
  } finally {
    syncButton.disabled = false;
    syncButton.textContent = "Simulate Purchase & Sync";
  }
};
