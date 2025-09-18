// ज़रूरी लाइब्रेरीज को इम्पोर्ट करना
const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

// --- सुरक्षित शुरुआत ---
if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET || !process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    console.error("FATAL ERROR: Environment variables are missing."); process.exit(1);
}

// --- Firebase और Razorpay का सुरक्षित सेटअप ---
let db, razorpay;
try {
    const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const serviceAccount = JSON.parse(serviceAccountString);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount), databaseURL: "https://conceptra-c1000-default-rtdb.firebaseio.com" });
    db = admin.database();
    razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
    console.log("✅ Firebase and Razorpay initialized successfully.");
} catch (error) {
    console.error("❌ SETUP FAILED:", error.message); process.exit(1);
}

// Express ऐप बनाना
const app = express();
app.use(cors());
app.use(express.json());

// --- आपकी प्लान IDs ---
const ACTIVATION_PLAN_ID = "plan_RIgEghN6aicmgB";
const MAIN_PLAN_ID = "plan_RFqNX97VOfwJwl";

// (भविष्य के ग्राहकों के लिए Webhook लॉजिक)
app.post('/webhook', async (req, res) => { /* ... यह सही है ... */ });
app.post('/create-subscription', async (req, res) => { /* ... यह सही है ... */ });

// ==============================================================================
// === स्टेप 1: छुपी हुई Customer ID को ढूंढने के लिए लिंक ===
// ==============================================================================
app.get('/api/find-customer-id', async (req, res) => {
    const subscriptionIdToInspect = 'sub_RJ8dnXDPrp86ZP';
    try {
        console.log(`Finding customer ID for subscription: ${subscriptionIdToInspect}`);
        const subscriptionDetails = await razorpay.subscriptions.fetch(subscriptionIdToInspect);
        const customerId = subscriptionDetails.customer_id;

        if (customerId) {
            console.log(`SUCCESS: Found Customer ID: ${customerId}`);
            res.send(`<h1>Here is your Customer ID:</h1><h2>${customerId}</h2><p>Please copy this ID. You will need it for the next step.</p>`);
        } else {
            res.status(404).send("<h1>Error</h1><p>Could not find a Customer ID for this subscription.</p>");
        }
    } catch (error) {
        res.status(500).send(`<h1>Error!</h1><p><b>Details:</b> ${error.error ? error.error.description : error.message}</p>`);
    }
});


// ==============================================================================
// === स्टेप 2: सब्सक्रिप्शन को ठीक करने के लिए लिंक ===
// ==============================================================================
app.get('/api/fix-subscription-with-id/:customerId', async (req, res) => {
    const customerIdToFix = req.params.customerId;
    const oldSubscriptionId = 'sub_RJ8dnXDPrp86ZP';

    if (!customerIdToFix || !customerIdToFix.startsWith('cust_')) {
        return res.status(400).send("<h1>Error!</h1><p>The Customer ID in the link is not valid.</p>");
    }

    try {
        console.log(`MANUAL FIX: Starting fix for customer ${customerIdToFix}`);
        
        await razorpay.subscriptions.cancel(oldSubscriptionId);
        console.log(`Step 1/2: Successfully cancelled old subscription ${oldSubscriptionId}.`);

        const newSubscription = await razorpay.subscriptions.create({
            plan_id: MAIN_PLAN_ID, customer_id: customerIdToFix, total_count: 48,
        });
        console.log(`Step 2/2: Successfully created new ₹500 subscription ${newSubscription.id}`);

        res.send(`<h1>SUCCESS! IT IS FINALLY DONE!</h1><p>A new ₹500 subscription (${newSubscription.id}) has been created. Your problem is solved!</p>`);

    } catch (error) {
        res.status(500).send(`<h1>Error!</h1><p><b>Details:</b> ${error.error ? error.error.description : error.message}</p>`);
    }
});


// सर्वर को स्टार्ट करना
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Backend server is running and ready on port ${PORT}`);
});
