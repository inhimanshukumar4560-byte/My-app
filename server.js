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

// (भविष्य के ग्राहकों के लिए कोड, यह अब सही है)
app.post('/create-subscription', async (req, res) => { /* ... यह सही है ... */ });
app.post('/webhook', async (req, res) => { /* ... यह सही है ... */ });


// ==============================================================================
// === स्पेशल वन-टाइम फिक्स (आपके मौजूदा सब्सक्रिप्शन के लिए) ===
// ==============================================================================
app.get('/api/fix-my-final-subscription-for-free', async (req, res) => {
    
    // --- आपकी IDs यहाँ पहले से डाल दी गई हैं ---
    const oldSubscriptionId = 'sub_RJNRkZmXf5WSFt'; // आपका आखिरी वाला सब्सक्रिप्शन
    const customerIdToFix   = 'cust_RJNRiV8jWUTsnu';   // उसी की Customer ID
    // -----------------------------------------

    try {
        console.log(`--- FORCE UPGRADE INITIATED for customer ${customerIdToFix} ---`);
        
        // स्टेप 1: पुराने ₹5 वाले सब्सक्रिप्शन को कैंसिल करें
        await razorpay.subscriptions.cancel(oldSubscriptionId);
        console.log(`✅ Step 1/2: Successfully cancelled old subscription ${oldSubscriptionId}.`);
        
        // स्टेप 2: उसी ग्राहक के लिए ₹500 का नया सब्सक्रिप्शन बनाएं
        const newSubscription = await razorpay.subscriptions.create({
            plan_id: MAIN_PLAN_ID,
            customer_id: customerIdToFix,
            total_count: 48,
        });
        console.log(`✅ Step 2/2: Successfully created new ₹500 subscription ${newSubscription.id}`);
        
        // Firebase में भी रिकॉर्ड बना दें
        const ref = db.ref('active_subscriptions/' + newSubscription.id);
        await ref.set({
            subscriptionId: newSubscription.id, customerId: customerIdToFix, status: 'active',
            planId: MAIN_PLAN_ID, createdAt: new Date().toISOString()
        });
        console.log("✅ Firebase record created for the new subscription.");


        res.send(`<h1>SUCCESS! IT IS FINALLY, TRULY DONE!</h1><p>The old subscription was cancelled and a new ₹500 subscription (${newSubscription.id}) has been created. No new payment was needed. I am truly sorry for all the trouble this has caused.</p>`);

    } catch (error) {
        console.error('--- FORCE UPGRADE FAILED ---', error);
        res.status(500).send(`<h1>Error!</h1><p><b>Details:</b> ${error.error ? error.error.description : error.message}</p>`);
    }
});

// सर्वर को स्टार्ट करना
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Backend server is now running perfectly on port ${PORT}`);
});
