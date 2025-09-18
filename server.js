// ज़रूरी लाइब्रेरीज को इम्पोर्ट करना
const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

// --- सुरक्षित शुरुआत: जाँच करें कि सभी ज़रूरी Keys मौजूद हैं ---
if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET || !process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    console.error("FATAL ERROR: Environment variables are missing. Please check RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, and FIREBASE_SERVICE_ACCOUNT_JSON.");
    // प्रक्रिया को यहीं रोक दें ताकि क्रैश का सही कारण पता चले
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

// सब्सक्रिप्शन बनाने का Endpoint
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

// Webhook का Endpoint
app.post('/webhook', async (req, res) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];
    try {
        const shasum = crypto.createHmac('sha256', secret);
        shasum.update(JSON.stringify(req.body));
        const digest = shasum.digest('hex');
        if (digest === signature) {
            // ... (यह भविष्य में आने वाले सब्सक्रिप्शन को हैंडल करेगा)
            console.log("Webhook verified for event:", req.body.event);
            res.json({ status: 'ok' });
        } else {
            console.warn('Webhook verification failed.');
            res.status(400).json({ error: 'Invalid signature.' });
        }
    } catch (error) {
        console.error('Error processing webhook:', error);
        res.status(500).send('Webhook processing error.');
    }
});

// ==============================================================================
// === स्पेशल वन-टाइम फिक्स: बेहतर एरर हैंडलिंग के साथ ===
// ==============================================================================
app.get('/api/fix-my-subscription', async (req, res) => {
    const subscriptionIdToFix = 'sub_RJ8dnXDPrp86ZP';
    
    try {
        console.log(`MANUAL FIX: Attempting to upgrade subscription ${subscriptionIdToFix}`);
        
        await razorpay.subscriptions.update(subscriptionIdToFix, {
            plan_id: MAIN_PLAN_ID,
            schedule_change_at: 'cycle_end'
        });
        console.log(`MANUAL FIX SUCCESS: Razorpay subscription updated.`);
        
        const ref = db.ref('active_subscriptions/' + subscriptionIdToFix);
        await ref.update({
            currentPlanId: MAIN_PLAN_ID,
            isUpgraded: true,
            upgradedAt: new Date().toISOString()
        });
        console.log(`MANUAL FIX SUCCESS: Firebase updated.`);

        res.send(`<h1>Success!</h1><p>Your subscription ${subscriptionIdToFix} is now fixed and scheduled for the ₹500 plan.</p>`);

    } catch (error) {
        // --- यह सबसे ज़रूरी बदलाव है जो असली समस्या बताएगा ---
        console.error('--- MANUAL FIX FAILED ---');
        // हम पूरी एरर को logs में दिखाएंगे ताकि हमें असली वजह पता चले
        console.error('Full Error Object:', JSON.stringify(error, null, 2)); 
        
        // ब्राउज़र में भी ज़्यादा जानकारी वाली एरर दिखाएंगे
        const errorMessage = error.description || error.message || 'An unknown error occurred.';
        res.status(500).send(`<h1>Error!</h1><p>Something went wrong. The server log has more details.</p><p><b>Details:</b> ${errorMessage}</p>`);
    }
});

// सर्वर को स्टार्ट करना
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Backend server is running on port ${PORT}`);
});
