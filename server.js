require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Configuration
const HUBSPOT_API_BASE = "https://api.hubapi.com";
const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;

const PIPELINES = {
  HARDWARE: {
    id: "t_e8a621a61c7c37dfce7425e0b9ea755e",
    stage_purchase_completed: "1232748376",
  },
  SUBSCRIPTION: {
    id: "t_9be7681e91998954b36b31b52a29aba6",
    stage_trial_started: "1232706850",
    stage_purchased: "1232706853",
  },
};

const CUSTOM_OBJECTS = {
  DEVICE_TYPE_ID: "2-53614619",
  PROP_MODEL: "model",
  ASSOC_ID: 37,
};

// Validate token
if (!HUBSPOT_TOKEN) {
  console.error("❌ ERROR: HUBSPOT_ACCESS_TOKEN not found in .env file");
  process.exit(1);
}

// Health check
app.get("/health", (req, res) => res.json({ status: "Server is running" }));

// GET endpoint - Fetch contacts
app.get("/api/contacts", async (req, res) => {
  try {
    const response = await axios.post(
      `${HUBSPOT_API_BASE}/crm/v3/objects/contacts/search`,
      {
        filterGroups: [],
        sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
        properties: ["firstname", "lastname", "email", "phone", "address"],
        limit: 100,
      },
      {
        headers: {
          Authorization: `Bearer ${HUBSPOT_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error("Error fetching contacts:", error.message);
    res.status(500).json({ error: "Failed to fetch contacts" });
  }
});

// POST endpoint - Create contact
app.post("/api/contacts", async (req, res) => {
  try {
    const response = await axios.post(
      `${HUBSPOT_API_BASE}/crm/v3/objects/contacts`,
      { properties: req.body.properties },
      {
        headers: {
          Authorization: `Bearer ${HUBSPOT_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error("Error creating contact:", error.message);
    res.status(500).json({ error: "Failed to create contact" });
  }
});

// GET endpoint - Fetch deals for a contact
app.get("/api/contacts/:contactId/deals", async (req, res) => {
  try {
    const { contactId } = req.params;

    // A. Get Associations
    const assocRes = await axios.get(
      `${HUBSPOT_API_BASE}/crm/v3/objects/contacts/${contactId}/associations/deals`,
      { headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` } }
    );

    if (!assocRes.data.results || assocRes.data.results.length === 0) {
      return res.json([]);
    }

    // B. Get Deal Details
    const dealIds = assocRes.data.results.map((r) => ({ id: r.id }));
    const dealsRes = await axios.post(
      `${HUBSPOT_API_BASE}/crm/v3/objects/deals/batch/read`,
      {
        inputs: dealIds,
        properties: [
          "dealname",
          "amount",
          "dealstage",
          "createdate",
          "pipeline",
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${HUBSPOT_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.json(dealsRes.data.results);
  } catch (error) {
    if (error.response && error.response.status === 404) return res.json([]);
    console.error("Error fetching deals:", error.message);
    res.status(500).json({ error: "Failed to fetch deals" });
  }
});

// ==================================================================
// POST endpoint - Create Deals (Smart Routing)
// ==================================================================
app.post("/api/deals", async (req, res) => {
  const { dealProperties, contactId } = req.body;
  const dealName = dealProperties.dealname;

  try {
    // -------------------------------------------------------
    // SCENARIO 1: THE BUNDLE (Hardware + Trial)
    // -------------------------------------------------------
    if (dealName.includes("Thermostat") || dealName.includes("Trial")) {
      console.log("⚡️ Processing Bundle: Hardware + Device + Trial");

      // 1. Create Hardware Deal
      await axios.post(
        `${HUBSPOT_API_BASE}/crm/v3/objects/deals`,
        {
          properties: {
            dealname: "Thermostat Hardware Purchase",
            amount: "299.00",
            pipeline: PIPELINES.HARDWARE.id,
            dealstage: PIPELINES.HARDWARE.stage_purchase_completed,
          },
          associations: [
            {
              to: { id: contactId },
              types: [
                {
                  associationCategory: "HUBSPOT_DEFINED",
                  associationTypeId: 3,
                },
              ],
            },
          ],
        },
        { headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` } }
      );

      // 2. Create Subscription Deal
      await axios.post(
        `${HUBSPOT_API_BASE}/crm/v3/objects/deals`,
        {
          properties: {
            dealname: "Breezy Premium (Free Trial)",
            amount: "0.00",
            pipeline: PIPELINES.SUBSCRIPTION.id,
            dealstage: PIPELINES.SUBSCRIPTION.stage_trial_started,
            closedate: new Date().toISOString(),
          },
          associations: [
            {
              to: { id: contactId },
              types: [
                {
                  associationCategory: "HUBSPOT_DEFINED",
                  associationTypeId: 3,
                },
              ],
            },
          ],
        },
        { headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` } }
      );

      // 3. Create Custom Object (Device)
      const randomSerial = "SN-" + Math.floor(100000 + Math.random() * 900000);
      const deviceResponse = await axios.post(
        `${HUBSPOT_API_BASE}/crm/v3/objects/${CUSTOM_OBJECTS.DEVICE_TYPE_ID}`,
        {
          properties: {
            [CUSTOM_OBJECTS.PROP_MODEL]: "Breezy T-1000",
            thermostat: `Breezy Thermostat (${randomSerial})`,
          },
        },
        { headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` } }
      );

      const newDeviceId = deviceResponse.data.id;

      // 4. Associate Device -> Contact (Reverse Direction)
      // This direction is safer because "contacts" is a standard object type and easier for the API to parse at the end of the URL.
      console.log(
        `... Associating Device ${newDeviceId} to Contact ${contactId}...`
      );

      await axios.put(
        `${HUBSPOT_API_BASE}/crm/v4/objects/${CUSTOM_OBJECTS.DEVICE_TYPE_ID}/${newDeviceId}/associations/contacts/${contactId}`,
        [
          {
            associationCategory: "USER_DEFINED",
            associationTypeId: CUSTOM_OBJECTS.ASSOC_ID, // 37
          },
        ],
        { headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` } }
      );

      console.log("✅ Association Complete!");

      return res.json({ status: "success", message: "Bundle Created" });
    }

    // -------------------------------------------------------
    // SCENARIO 2: SUBSCRIPTION ONLY (Annual/Monthly)
    // -------------------------------------------------------
    else {
      console.log("⚡️ Processing Subscription Upgrade");

      const response = await axios.post(
        `${HUBSPOT_API_BASE}/crm/v3/objects/deals`,
        {
          properties: {
            dealname: dealName,
            amount: dealProperties.amount,
            pipeline: PIPELINES.SUBSCRIPTION.id,
            dealstage: PIPELINES.SUBSCRIPTION.stage_purchased,
          },
          associations: [
            {
              to: { id: contactId },
              types: [
                {
                  associationCategory: "HUBSPOT_DEFINED",
                  associationTypeId: 3,
                },
              ],
            },
          ],
        },
        { headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` } }
      );

      return res.json(response.data);
    }
  } catch (error) {
    console.error(
      "Error creating deal/object:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: "Failed processing transaction" });
  }
});
// ==================================================================
// AI ENDPOINT: DETECT HIGH-VALUE OPPORTUNITY
// ==================================================================
app.post("/api/ai/detect-opportunity", async (req, res) => {
  try {
    const { contactId, contactName } = req.body;

    // 1. SIMULATE TELEMETRY (50/50 High/Low Split)
    const isHighScenario = Math.random() >= 0.5;

    const currentMonthlySpend = isHighScenario
      ? Math.floor(Math.random() * (300 - 150) + 150) // Result: $150 - $300 (High)
      : Math.floor(Math.random() * (120 - 50) + 50); // Result: $50 - $120 (Low)

    // 2. CALL GEMINI
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    const prompt = `
      Act as a Data Analyst. Analyze this customer:
      - Name: ${contactName}
      - Current Spend: $${currentMonthlySpend}/month
      - Subscription: NONE
      
      Logic: If (Spend * 0.30) > $40, verdict is "High". Else "Low".
      
      Output JSON ONLY: { "verdict": "High" or "Low", "reasoning": "short sentence" }
    `;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const cleanJson = text.replace(/```json|```/g, "").trim();
    const analysis = JSON.parse(cleanJson);

    // 3. IF "HIGH", UPDATE HUBSPOT
    if (analysis.verdict === "High") {
      console.log(`💰 High Opportunity: ${contactName}. Updating HubSpot...`);
      await axios.patch(
        `${HUBSPOT_API_BASE}/crm/v3/objects/contacts/${contactId}`,
        { properties: { upsell_opportunity: "High" } },
        { headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` } }
      );
    }

    res.json({
      spend: currentMonthlySpend,
      verdict: analysis.verdict,
      insight: analysis.reasoning,
    });
  } catch (error) {
    console.error("AI Error:", error.message);
    res.status(500).json({ error: "Analysis Failed" });
  }
});
// Start server
app.listen(PORT, () => {
  console.log(`\n✅ Server running on http://localhost:${PORT}`);
});
