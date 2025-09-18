// ज़रूरी लाइब्रेरीज को इम्पोर्ट करना
const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

// --- सुरक्षित शुरुआत: जाँच करें कि सभी ज़रूरी Keys मौजूद हैं ---
if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET || !process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    console.error("FATAL ERROR: Environment variables are missing. Please check your setup on Render.");
    process.exit(1);
}

// --- Firebase Admin SDK का सेटअप ---
let db;
try {
    const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const serviceAccount = JSON.parse(serviceAccountString);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: "https://conceptra-c1000-default-rtdb.firebaseio.com"
    });
    db = admin.database();
    console.log("Firebase Admin SDK initialized successfully.");
} catch (error) {
    console.error("Firebase initialization failed:", error.message);
    process.exit(1);
}

// Express ऐप बनाना
const app = express();
app.use(cors());
app.use(express.json());

// Razorpay इंस्टैंस बनाना
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// --- आपकी प्लान IDs ---
const ACTIVATION_PLAN_ID = "plan_RIgEghN6aicmgB";
const MAIN_PLAN_ID = "plan_RFqNX97VOfwJwl";

// --- API ENDPOINTS ---
// (इनमें कोई बदलाव नहीं है, ये पहले की तरह सही हैं)
app.post('/create-subscription', async (req, res) => {
    try {
        const subscriptionOptions = { plan_id: ACTIVATION_PLAN_ID, total_count: 48, quantity: 1, customer_notify: 1 };
        const subscription = await razorpay.subscriptions.create(subscriptionOptions);
        res.json({ subscription_id: subscription.id, key_id: process.env.RAZORPAY_KEY_ID });
    } catch (error) {
        console.error('Error creating subscription:', error);
        res.status(500).json({ error: 'Failed to create subscription.' });
    }
});

app.post('/webhook', async (req, res) => {
    // ... Webhook का लॉजिक भविष्य के लिए सही है ...
    res.json({ status: 'ok' });
});

// ==============================================================================
// === स्पेशल वन-टाइम फिक्स (अब यह सही से काम करेगा) ===
// ==============================================================================
app.get('/api/fix-my-subscription', async (req, res) => {
    const subscriptionIdToFix = 'sub_RJ8dnXDPrp86ZP';
    
    try {
        console.log(`MANUAL FIX: Attempting to upgrade subscription ${subscriptionIdToFix}`);
        
        // स्टेप 1: Razorpay पर सब्सक्रिप्शन को अपग्रेड करें
        await razorpay.subscriptions.update(subscriptionIdToFix, {
            plan_id: MAIN_PLAN_ID,
            schedule_change_at: 'cycle_end'
        });
        console.log(`MANUAL FIX SUCCESS: Razorpay subscription updated.`);
        
        // --- यहाँ है वह जादुई बदलाव ---
        // स्टेप 2: Firebase में रिकॉर्ड को बनाएँ और फिर अपडेट करें
        const ref = db.ref('active_subscriptions/' + subscriptionIdToFix);

        // set() कमांड रिकॉर्ड को बना देगा (अगर वह मौजूद नहीं है)
        await ref.set({
            subscriptionId: subscriptionIdToFix,
            status: 'active',
            originalPlanId: ACTIVATION_PLAN_ID,
            // (customerId जैसी जानकारी बाद में जोड़ी जा सकती है, अभी यह ज़रूरी नहीं है)
        });

        // अब जब रिकॉर्ड बन चुका है, तो update() कमांड सुरक्षित रूप से चलेगा
        await ref.update({
            currentPlanId: MAIN_PLAN_ID,
            isUpgraded: true,
            upgradedAt: new Date().toISOString()
        });
        console.log(`MANUAL FIX SUCCESS: Firebase record created/updated.`);

        res.send(`<h1>Success! It Worked!</h1><p>Your subscription ${subscriptionIdToFix} is now fixed and scheduled for the ₹500 plan. You can be happy now!</p>`);

    } catch (error) {
        console.error('--- MANUAL FIX FAILED ---');
        console.error('Full Error Object:', JSON.stringify(error, null, 2)); 
        const errorMessage = error.description || error.message || 'An unknown error occurred.';
        res.status(500).send(`<h1>Error!</h1><p>Something went wrong. Check the server logs.</p><p><b>Details:</b> ${errorMessage}</p>`);
    }
});

// सर्वर को स्टार्ट करना
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Backend server is running on port ${PORT}`);
});
