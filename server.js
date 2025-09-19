// ज़रूरी लाइब्रेरीज को इम्पोर्ट करना
const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

// --- सुरक्षित शुरुआत ---
if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET || !process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    console.error("FATAL ERROR: Environment variables are missing.");
    process.exit(1);
}

// --- Firebase और Razorpay का सेटअप ---
let db, razorpay;
try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: "https://conceptra-c1000-default-rtdb.firebaseio.com"
    });
    db = admin.database();
    razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
    console.log("✅ Firebase and Razorpay initialized successfully.");
} catch (error) {
    console.error("❌ SETUP FAILED:", error.message);
    process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

// यहाँ अपनी दोनों TEST PLAN IDs डालें
const ACTIVATION_PLAN_ID = 'plan_RJX1Aq0y6jBERy'; // आपकी ₹5 वाली Test Plan ID
const MAIN_PLAN_ID = 'plan_RJX1CrfJz14iLg';       // मान लेते हैं यह आपकी ₹500 वाली Test Plan ID है

// === सब्सक्रिप्शन बनाना ===
app.post('/create-subscription', async (req, res) => {
    try {
        console.log("Attempting to create subscription with Plan ID:", ACTIVATION_PLAN_ID);
        const subscription = await razorpay.subscriptions.create({
            plan_id: ACTIVATION_PLAN_ID,
            total_count: 48,
            customer_notify: 1,
        });
        console.log("✅ Subscription created successfully:", subscription.id);
        res.json({
            subscription_id: subscription.id,
            key_id: process.env.RAZORPAY_KEY_ID
        });
    } catch (error) {
        // =============================================================
        // ============== यही वह लाइन है जो हमें सच्चाई बताएगी ==========
        // =============================================================
        console.error("❌ Error creating subscription:", JSON.stringify(error, null, 2));
        // =============================================================
        res.status(500).json({ error: 'Failed to create subscription.' });
    }
});

// === WEBHOOK का फाइनल लॉजिक ===
app.post('/webhook', async (req, res) => {
    // ... (बाकी का वेबहुक कोड जैसा था वैसा ही रहेगा) ...
    // ... (इसमें कोई बदलाव की ज़रूरत नहीं है) ...
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Your server is now permanently fixed and running on port ${PORT}`);
});
