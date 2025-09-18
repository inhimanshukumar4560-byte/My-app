// ज़रूरी लाइब्रेरीज को इम्पोर्ट करना
const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

console.log("--- Server process started ---");

// --- स्टेप 1: Environment Variables की जाँच ---
if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET || !process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    console.error("❌ FATAL ERROR: One or more environment variables are MISSING.");
    console.error("Please check RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, and FIREBASE_SERVICE_ACCOUNT_JSON on Render.");
    process.exit(1); // सर्वर को यहीं बंद कर दें
}
console.log("✅ Step 1/4: All environment variables found.");

// --- स्टेप 2: Firebase को शुरू करना ---
let db;
try {
    const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const serviceAccount = JSON.parse(serviceAccountString);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: "https://conceptra-c1000-default-rtdb.firebaseio.com"
    });
    db = admin.database();
    console.log("✅ Step 2/4: Firebase Admin SDK initialized successfully.");
} catch (error) {
    console.error("❌ FATAL ERROR during Firebase initialization:", error.message);
    process.exit(1);
}

// --- स्टेप 3: Razorpay को शुरू करना (यह सबसे ज़रूरी जाँच है) ---
let razorpay;
try {
    // हम यहाँ Key ID के आखिरी 4 अक्षर दिखाएंगे ताकि पता चले कि Key लोड हुई है या नहीं
    const keyIdPreview = process.env.RAZORPAY_KEY_ID.slice(-4);
    console.log(`Attempting to initialize Razorpay with Key ID ending in: ...${keyIdPreview}`);
    
    razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
    console.log("✅ Step 3/4: Razorpay instance created successfully.");
} catch (error) {
    console.error("❌ FATAL ERROR during Razorpay initialization. This is likely the problem.");
    console.error("Error Message:", error.message);
    // हम सर्वर को चालू रखेंगे ताकि आप यह एरर देख सकें
}

// Express ऐप बनाना
const app = express();
app.use(cors());
app.use(express.json());
console.log("✅ Step 4/4: Express app created.");


// --- API ENDPOINTS ---
const ACTIVATION_PLAN_ID = "plan_RIgEghN6aicmgB";
const MAIN_PLAN_ID = "plan_RFqNX97VOfwJwl";

// (बाकी के फंक्शन्स वैसे ही रहेंगे, उनमें कोई बदलाव नहीं है)
app.post('/create-subscription', async (req, res) => { /* ... */ });
app.post('/webhook', async (req, res) => { /* ... */ });
app.get('/api/fix-my-subscription', async (req, res) => {
    // पहले जाँच करें कि Razorpay ठीक से शुरू हुआ था या नहीं
    if (!razorpay) {
        return res.status(500).send("<h1>Error!</h1><p>Razorpay failed to initialize. Please check the server logs.</p>");
    }
    const subscriptionIdToFix = 'sub_RJ8dnXDPrp86ZP';
    try {
        await razorpay.subscriptions.update(subscriptionIdToFix, { plan_id: MAIN_PLAN_ID, schedule_change_at: 'cycle_end' });
        const ref = db.ref('active_subscriptions/' + subscriptionIdToFix);
        await ref.set({ subscriptionId: subscriptionIdToFix, status: 'active', originalPlanId: ACTIVATION_PLAN_ID });
        await ref.update({ currentPlanId: MAIN_PLAN_ID, isUpgraded: true, upgradedAt: new Date().toISOString() });
        res.send(`<h1>Success!</h1><p>Subscription ${subscriptionIdToFix} has been fixed.</p>`);
    } catch (error) {
        console.error('--- MANUAL FIX FAILED ---');
        console.error('Full Error Object:', error);
        res.status(500).send(`<h1>Error!</h1><p><b>Details:</b> ${error.error ? error.error.description : error.message}</p>`);
    }
});

// सर्वर को स्टार्ट करना
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Backend server is running and ready on port ${PORT}`);
});
